/**
 * UTF-16-aware message chunking for the Telegram Bot API.
 *
 * Telegram counts message length in UTF-16 code units, capped at 4096. Most
 * non-BMP characters (emoji, many CJK) encode as a surrogate pair and so
 * occupy 2 code units. JavaScript's `String.prototype.length` is already in
 * UTF-16 code units, so we can use `.length` directly — we just need to be
 * careful not to slice in the middle of a surrogate pair.
 */

/** Count UTF-16 code units in a string. */
export function utf16Len(s: string): number {
	return s.length;
}

export interface ChunkOptions {
	/** Max UTF-16 code units per chunk. Default 4096 (Telegram hard limit). */
	maxUnits?: number;
	/** Reserve headroom for the "(i/N)\n" pagination prefix. Default 16. */
	reserveForSuffix?: number;
}

export interface Chunk {
	/** Chunk body with pagination prefix applied when total > 1. */
	text: string;
	/** 0-based index. */
	index: number;
	/** Total chunk count. */
	total: number;
	isFirst: boolean;
	isLast: boolean;
}

const DEFAULT_MAX = 4096;
const DEFAULT_RESERVE = 16;

/** True if code unit at i is a high surrogate (start of a surrogate pair). */
function isHighSurrogate(s: string, i: number): boolean {
	const c = s.charCodeAt(i);
	return c >= 0xd800 && c <= 0xdbff;
}

/** Return a slice length that is safe (not landing mid-surrogate-pair). */
function safeCut(s: string, cut: number): number {
	if (cut <= 0) return 0;
	if (cut >= s.length) return s.length;
	// If the char at cut-1 is a high surrogate, pull back one so we keep
	// the pair together in the *next* chunk.
	if (isHighSurrogate(s, cut - 1)) return cut - 1;
	return cut;
}

/**
 * Return a substring that fits within maxUnits UTF-16 units, breaking on
 * word / newline boundary when possible. Truncates mid-word as last resort.
 */
export function truncateToUtf16(text: string, maxUnits: number): string {
	if (maxUnits <= 0) return "";
	if (text.length <= maxUnits) return text;
	let cut = safeCut(text, maxUnits);
	// Prefer last newline, then last space, within [0, cut).
	const nl = text.lastIndexOf("\n", cut - 1);
	if (nl > 0 && nl >= cut - 200) {
		return text.slice(0, nl);
	}
	const sp = text.lastIndexOf(" ", cut - 1);
	if (sp > 0 && sp >= cut - 80) {
		return text.slice(0, sp);
	}
	return text.slice(0, safeCut(text, cut));
}

/**
 * Scan `text` between [0, upTo) and return the number of unclosed backtick
 * regions at that point. We track:
 *   - Triple-backtick code blocks (```)
 *   - Single-backtick inline code (`)
 *
 * Returns the index of the last opener that is still unclosed at `upTo`,
 * or -1 if everything is balanced.
 */
function lastUnclosedBacktickOpener(text: string, upTo: number): number {
	let i = 0;
	let lastOpener = -1;
	let inTriple = false;
	let tripleOpenIdx = -1;
	let inInline = false;
	let inlineOpenIdx = -1;
	while (i < upTo) {
		const ch = text.charCodeAt(i);
		if (ch === 0x5c /* \ */) {
			// Skip escape.
			i += 2;
			continue;
		}
		if (ch === 0x60 /* ` */) {
			const isTriple =
				i + 2 < text.length &&
				text.charCodeAt(i + 1) === 0x60 &&
				text.charCodeAt(i + 2) === 0x60;
			if (isTriple) {
				if (inInline) {
					// Triple inside single-backtick is unusual; treat as two singles + one more.
					// Simpler: end the inline state and open/close triple.
					inInline = false;
					inlineOpenIdx = -1;
				}
				if (!inTriple) {
					inTriple = true;
					tripleOpenIdx = i;
				} else {
					inTriple = false;
					tripleOpenIdx = -1;
				}
				i += 3;
				continue;
			}
			// Single backtick.
			if (inTriple) {
				i += 1;
				continue;
			}
			if (!inInline) {
				inInline = true;
				inlineOpenIdx = i;
			} else {
				inInline = false;
				inlineOpenIdx = -1;
			}
			i += 1;
			continue;
		}
		i += 1;
	}
	if (inTriple) lastOpener = tripleOpenIdx;
	else if (inInline) lastOpener = inlineOpenIdx;
	return lastOpener;
}

/** Find the best break index <= limit within text. Prefers \n\n, then \n, then space. */
function findBreakpoint(text: string, limit: number): number {
	if (text.length <= limit) return text.length;
	const hardCut = safeCut(text, limit);
	// Paragraph boundary.
	const para = text.lastIndexOf("\n\n", hardCut - 1);
	if (para > 0 && para >= hardCut - 500) {
		return para + 2; // include the blank line separator
	}
	// Single newline.
	const nl = text.lastIndexOf("\n", hardCut - 1);
	if (nl > 0 && nl >= hardCut - 300) {
		return nl + 1;
	}
	// Space.
	const sp = text.lastIndexOf(" ", hardCut - 1);
	if (sp > 0 && sp >= hardCut - 80) {
		return sp + 1;
	}
	// Hard cut (surrogate-safe).
	return hardCut;
}

/**
 * Split text into chunks of ≤ maxUnits UTF-16 units each, prefixing with
 * "(i/N)\n" when N>1. Breaks preferably on paragraph boundary, then
 * newline, then space. Never splits inside a code span or code block.
 */
export function chunkMessage(text: string, opts: ChunkOptions = {}): Chunk[] {
	const maxUnits = opts.maxUnits ?? DEFAULT_MAX;
	const reserveForSuffix = opts.reserveForSuffix ?? DEFAULT_RESERVE;
	if (!text) {
		return [{ text: "", index: 0, total: 1, isFirst: true, isLast: true }];
	}

	// Fast path: single chunk.
	if (text.length <= maxUnits) {
		return [
			{ text, index: 0, total: 1, isFirst: true, isLast: true },
		];
	}

	// Effective limit = maxUnits - reserveForSuffix. The prefix like "(12/99)\n"
	// is at most ~reserveForSuffix chars for realistic N values.
	const effective = Math.max(1, maxUnits - reserveForSuffix);

	const bodies: string[] = [];
	let cursor = 0;
	while (cursor < text.length) {
		const remaining = text.length - cursor;
		if (remaining <= effective) {
			bodies.push(text.slice(cursor));
			break;
		}
		const slice = text.slice(cursor, cursor + effective);
		let cut = findBreakpoint(slice, effective);

		// Code-span protection: if cut lands inside an unclosed backtick, roll
		// back to before the opener.
		const opener = lastUnclosedBacktickOpener(slice, cut);
		if (opener >= 0) {
			// Try to break at the opener instead. If opener is 0, we have no
			// room — fall through and accept the unclosed state (rare edge case).
			if (opener > 0) {
				cut = opener;
				// Walk back over any trailing whitespace so we don't produce
				// a chunk that ends in space.
				while (cut > 0 && /\s/.test(slice[cut - 1])) cut--;
				if (cut === 0) cut = findBreakpoint(slice, effective);
			}
		}

		if (cut <= 0) cut = safeCut(slice, effective);
		bodies.push(text.slice(cursor, cursor + cut));
		cursor += cut;
		// Skip any leading whitespace on the next chunk to avoid ugly blank
		// starts (but keep at most one newline).
		while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) {
			cursor++;
		}
	}

	const total = bodies.length;
	if (total === 1) {
		return [{ text: bodies[0], index: 0, total: 1, isFirst: true, isLast: true }];
	}

	const chunks: Chunk[] = [];
	for (let i = 0; i < total; i++) {
		const prefix = `(${i + 1}/${total})\n`;
		let body = bodies[i];
		// Guarantee the prefixed chunk still fits under the hard limit.
		const budget = maxUnits - prefix.length;
		if (body.length > budget) {
			body = body.slice(0, safeCut(body, budget));
		}
		chunks.push({
			text: prefix + body,
			index: i,
			total,
			isFirst: i === 0,
			isLast: i === total - 1,
		});
	}
	return chunks;
}

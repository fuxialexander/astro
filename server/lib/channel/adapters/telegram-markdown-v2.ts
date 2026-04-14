/**
 * Telegram MarkdownV2 converter.
 *
 * Spec: https://core.telegram.org/bots/api#markdownv2-style
 *
 * In MarkdownV2, these characters MUST be escaped with a backslash
 * when used literally (not as formatting markers):
 *   _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * Formatting in MdV2 (note: different from standard markdown):
 *   *bold*             (single asterisks, NOT double)
 *   _italic_           (single underscores)
 *   __underline__      (double underscores)
 *   ~strike~           (single tilde)
 *   ||spoiler||        (double pipe)
 *   `inline code`
 *   ```code block```
 *   [text](url)
 *   >blockquote
 *   **>expandable blockquote<**
 */

// eslint-disable-next-line no-useless-escape
const MDV2_SPECIALS = /[_*\[\]()~`>#+\-=|{}.!\\]/g;

/** Escape all MarkdownV2 special chars in a string. Does NOT preserve formatting. */
export function escapeMdv2(text: string): string {
	return text.replace(MDV2_SPECIALS, (ch) => "\\" + ch);
}

/** Escape chars that matter inside a code span / code block body: backslash and backtick. */
function escapeCodeBody(text: string): string {
	return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
}

/** Escape chars inside a link URL: ) and \. */
function escapeLinkUrl(url: string): string {
	return url.replace(/\\/g, "\\\\").replace(/\)/g, "\\)");
}

/**
 * Convert a subset of standard Markdown to Telegram MarkdownV2.
 *
 * Supports: **bold**, *italic* (single-star or _underscore_), ~~strike~~,
 * ||spoiler||, `code`, ```code block```, [link](url), # headers (rendered as bold),
 * > blockquote (single-line and multi-line). Escapes all other special chars.
 *
 * Protects content inside code spans / code blocks from the escape pass.
 */
export function toMarkdownV2(source: string): string {
	if (!source) return "";

	// ---- Pass 1: extract code blocks and code spans into placeholders ----
	// Placeholder format: \x00<index>\x00
	const placeholders: string[] = [];
	const take = (rendered: string): string => {
		const idx = placeholders.length;
		placeholders.push(rendered);
		return `\x00${idx}\x00`;
	};

	// Triple-backtick code blocks first (optionally with a language tag).
	let text = source.replace(
		/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g,
		(_m, lang: string, body: string) => {
			const tag = lang ? lang : "";
			return take("```" + tag + "\n" + escapeCodeBody(body) + "```");
		},
	);

	// Then inline code spans (`...`). Single backticks only; double not supported.
	text = text.replace(/`([^`\n]+)`/g, (_m, body: string) => {
		return take("`" + escapeCodeBody(body) + "`");
	});

	// ---- Pass 2: extract links so their pieces get the right escaping ----
	text = text.replace(
		/\[([^\]\n]+)\]\(([^)\s]+)\)/g,
		(_m, label: string, url: string) => {
			return take("[" + escapeMdv2(label) + "](" + escapeLinkUrl(url) + ")");
		},
	);

	// ---- Pass 3: line-based transforms for headers and blockquotes ----
	// We use sentinel chars directly (not literal placeholder strings) so
	// that the inline-formatting pass below cannot accidentally match them
	// (e.g., `__HDR_OPEN__` would otherwise be eaten by the underline regex).
	const S_EARLY = {
		hdrOpen: "\x0e",
		hdrClose: "\x0f",
		bqOpen: "\x10",
		bqClose: "\x11",
	};
	const lines = text.split("\n");
	const out: string[] = [];
	for (const rawLine of lines) {
		// Header: # foo / ## foo / ### foo → bold line
		const headerMatch = /^(#{1,6})\s+(.*)$/.exec(rawLine);
		if (headerMatch) {
			const body = headerMatch[2];
			out.push(S_EARLY.hdrOpen + body + S_EARLY.hdrClose);
			continue;
		}
		// Blockquote: > foo → >foo (with literal > not escaped)
		const bqMatch = /^>\s?(.*)$/.exec(rawLine);
		if (bqMatch) {
			out.push(S_EARLY.bqOpen + bqMatch[1] + S_EARLY.bqClose);
			continue;
		}
		out.push(rawLine);
	}
	text = out.join("\n");

	// ---- Pass 4: inline formatting markers → sentinels ----
	// Order matters: handle the longer/more specific tokens first.
	//
	// **bold**       → *bold*
	// __underline__  → __underline__  (MdV2 native)
	// ~~strike~~     → ~strike~
	// ||spoiler||    → ||spoiler||    (already MdV2 native)
	// *italic*       → _italic_
	// _italic_       → _italic_       (already MdV2)

	// Use sentinel chars that cannot appear in normal text so the escape pass
	// leaves them alone; then we swap them back at the end.
	const S = {
		bOpen: "\x01",
		bClose: "\x02",
		iOpen: "\x03",
		iClose: "\x04",
		uOpen: "\x05",
		uClose: "\x06",
		sOpen: "\x07",
		sClose: "\x08",
		spOpen: "\x0b",
		spClose: "\x0c",
		hdrOpen: S_EARLY.hdrOpen,
		hdrClose: S_EARLY.hdrClose,
		bqOpen: S_EARLY.bqOpen,
		bqClose: S_EARLY.bqClose,
	};

	// Bold: **text**
	text = text.replace(/\*\*([^\n*][^\n]*?)\*\*/g, (_m, b: string) => S.bOpen + b + S.bClose);
	// Underline: __text__
	text = text.replace(/__([^\n_][^\n]*?)__/g, (_m, u: string) => S.uOpen + u + S.uClose);
	// Strikethrough: ~~text~~
	text = text.replace(/~~([^\n~][^\n]*?)~~/g, (_m, s: string) => S.sOpen + s + S.sClose);
	// Spoiler: ||text||
	text = text.replace(/\|\|([^\n|][^\n]*?)\|\|/g, (_m, sp: string) => S.spOpen + sp + S.spClose);
	// Italic: *text* (single star, but not touching sentinel)
	// eslint-disable-next-line no-control-regex
	text = text.replace(/(^|[^\x01\x02*])\*([^\n*][^\n]*?)\*(?!\*)/g, (_m, lead: string, i: string) => lead + S.iOpen + i + S.iClose);
	// Italic: _text_
	text = text.replace(/(^|[^_])_([^\n_][^\n]*?)_(?!_)/g, (_m, lead: string, i: string) => lead + S.iOpen + i + S.iClose);

	// ---- Pass 5: escape all MdV2 specials in the remaining literal text ----
	// Sentinels are in \x01..\x11 so they won't match MDV2_SPECIALS.
	text = text.replace(MDV2_SPECIALS, (ch) => "\\" + ch);

	// ---- Pass 6: swap sentinels back to real MdV2 markers ----
	text = text
		.replace(new RegExp(S.bOpen, "g"), "*")
		.replace(new RegExp(S.bClose, "g"), "*")
		.replace(new RegExp(S.iOpen, "g"), "_")
		.replace(new RegExp(S.iClose, "g"), "_")
		.replace(new RegExp(S.uOpen, "g"), "__")
		.replace(new RegExp(S.uClose, "g"), "__")
		.replace(new RegExp(S.sOpen, "g"), "~")
		.replace(new RegExp(S.sClose, "g"), "~")
		.replace(new RegExp(S.spOpen, "g"), "||")
		.replace(new RegExp(S.spClose, "g"), "||")
		// Headers render as bold.
		.replace(new RegExp(S.hdrOpen, "g"), "*")
		.replace(new RegExp(S.hdrClose, "g"), "*")
		// Blockquote: literal > at line start, not escaped.
		.replace(new RegExp(S.bqOpen, "g"), ">")
		.replace(new RegExp(S.bqClose, "g"), "");

	// ---- Pass 7: re-insert code placeholders ----
	// eslint-disable-next-line no-control-regex
	text = text.replace(/\x00(\d+)\x00/g, (_m, n: string) => placeholders[Number(n)] ?? "");

	return text;
}

/** Strip all MarkdownV2 formatting and return plain text (for parse-error fallback). */
export function stripMdv2(text: string): string {
	if (!text) return "";
	// Remove backslash escapes: \x → x for MdV2 specials.
	// eslint-disable-next-line no-useless-escape
	let out = text.replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, "$1");
	// Remove code fences (keep body).
	out = out.replace(/```[a-zA-Z0-9_+-]*\n?([\s\S]*?)```/g, "$1");
	// Remove inline code backticks (keep body).
	out = out.replace(/`([^`\n]+)`/g, "$1");
	// Links [text](url) → text.
	out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, "$1");
	// Spoilers ||x|| → x.
	out = out.replace(/\|\|([^\n|]+)\|\|/g, "$1");
	// Strikethrough ~x~ or ~~x~~ → x.
	out = out.replace(/~~?([^\n~]+)~~?/g, "$1");
	// Underline __x__ → x.
	out = out.replace(/__([^\n_]+)__/g, "$1");
	// Bold **x** → x.
	out = out.replace(/\*\*([^\n*]+)\*\*/g, "$1");
	// Bold/italic *x* or _x_ → x.
	out = out.replace(/\*([^\n*]+)\*/g, "$1");
	out = out.replace(/_([^\n_]+)_/g, "$1");
	// Leading blockquote markers.
	out = out.replace(/^>\s?/gm, "");
	// Leading header markers.
	out = out.replace(/^#{1,6}\s+/gm, "");
	return out;
}

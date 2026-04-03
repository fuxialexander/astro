/**
 * Parsers for BibTeX and RIS reference file formats.
 * Lightweight client-side parsing — no external dependencies.
 */

import type { ParsedReference, ReferenceType } from "@/types/reference"

// ---------------------------------------------------------------------------
// BibTeX
// ---------------------------------------------------------------------------

const BIBTEX_TYPE_MAP: Record<string, ReferenceType> = {
  article: 'article',
  inproceedings: 'conference',
  conference: 'conference',
  book: 'book',
  inbook: 'chapter',
  incollection: 'chapter',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  techreport: 'report',
  misc: 'other',
  unpublished: 'preprint',
  online: 'webpage',
}

function stripBraces(s: string): string {
  return s.replace(/^\{+|\}+$/g, '').trim()
}

export function parseBibtex(input: string): ParsedReference[] {
  const entries: ParsedReference[] = []
  // Match each @type{key, ... } block
  const entryRegex = /@(\w+)\s*\{([^,]*),([^@]*)\}/g
  let match: RegExpExecArray | null

  while ((match = entryRegex.exec(input)) !== null) {
    const entryType = match[1].toLowerCase()
    const citationKey = match[2].trim()
    const body = match[3]

    if (entryType === 'string' || entryType === 'preamble' || entryType === 'comment') continue

    const fields: Record<string, string> = {}
    // Parse key = {value} or key = "value" or key = number
    const fieldRegex = /(\w+)\s*=\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|(\d+))/g
    let fieldMatch: RegExpExecArray | null
    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
      const key = fieldMatch[1].toLowerCase()
      const value = fieldMatch[2] ?? fieldMatch[3] ?? fieldMatch[4] ?? ''
      fields[key] = stripBraces(value).replace(/\s+/g, ' ')
    }

    const authors = (fields.author ?? '')
      .split(/\s+and\s+/i)
      .map((a) => a.trim())
      .filter(Boolean)

    entries.push({
      title: fields.title ?? 'Untitled',
      authors,
      year: fields.year ? parseInt(fields.year, 10) : undefined,
      doi: fields.doi,
      isbn: fields.isbn,
      url: fields.url,
      abstract: fields.abstract,
      journal: fields.journal ?? fields.booktitle,
      volume: fields.volume,
      issue: fields.number,
      pages: fields.pages,
      publisher: fields.publisher,
      publicationType: BIBTEX_TYPE_MAP[entryType] ?? 'other',
      bibtex: match[0],
      citationKey,
      selected: true,
    })
  }

  return entries
}

// ---------------------------------------------------------------------------
// RIS
// ---------------------------------------------------------------------------

const RIS_TYPE_MAP: Record<string, ReferenceType> = {
  JOUR: 'article',
  BOOK: 'book',
  CHAP: 'chapter',
  CONF: 'conference',
  CPAPER: 'conference',
  THES: 'thesis',
  RPRT: 'report',
  ELEC: 'webpage',
  DATA: 'dataset',
  COMP: 'software',
  GEN: 'other',
  UNPB: 'preprint',
}

export function parseRIS(input: string): ParsedReference[] {
  const entries: ParsedReference[] = []
  // Split on end-of-record markers
  const records = input.split(/^ER\s*-/m)

  for (const record of records) {
    const lines = record.split('\n')
    const fields: Record<string, string[]> = {}

    for (const line of lines) {
      const tagMatch = line.match(/^([A-Z][A-Z0-9])\s*-\s*(.*)$/)
      if (!tagMatch) continue
      const tag = tagMatch[1]
      const value = tagMatch[2].trim()
      if (!fields[tag]) fields[tag] = []
      fields[tag].push(value)
    }

    if (!fields.TY) continue // No type = not a valid record

    const entryType = fields.TY[0] ?? 'GEN'
    const title = (fields.TI ?? fields.T1 ?? ['Untitled'])[0]
    const authors = (fields.AU ?? fields.A1 ?? []).map((a) => a.trim()).filter(Boolean)
    const yearStr = (fields.PY ?? fields.Y1 ?? [''])[0]
    const year = yearStr ? parseInt(yearStr.split('/')[0], 10) : undefined

    entries.push({
      title,
      authors,
      year: year && !isNaN(year) ? year : undefined,
      doi: (fields.DO ?? fields.DI ?? [''])[0] || undefined,
      url: (fields.UR ?? [''])[0] || undefined,
      abstract: (fields.AB ?? fields.N2 ?? [''])[0] || undefined,
      journal: (fields.JO ?? fields.JF ?? fields.T2 ?? [''])[0] || undefined,
      volume: (fields.VL ?? [''])[0] || undefined,
      issue: (fields.IS ?? [''])[0] || undefined,
      pages: [fields.SP?.[0], fields.EP?.[0]].filter(Boolean).join('-') || undefined,
      publisher: (fields.PB ?? [''])[0] || undefined,
      publicationType: RIS_TYPE_MAP[entryType] ?? 'other',
      isbn: (fields.SN ?? [''])[0] || undefined,
      selected: true,
    })
  }

  return entries
}

// ---------------------------------------------------------------------------
// Auto-detect format and parse
// ---------------------------------------------------------------------------

export function parseReferences(input: string): ParsedReference[] {
  const trimmed = input.trim()
  if (trimmed.startsWith('@') || trimmed.includes('@article') || trimmed.includes('@inproceedings') || trimmed.includes('@book')) {
    return parseBibtex(trimmed)
  }
  if (trimmed.startsWith('TY  -') || trimmed.includes('\nTY  -')) {
    return parseRIS(trimmed)
  }
  // Try BibTeX first, fall back to RIS
  const bibtexResult = parseBibtex(trimmed)
  if (bibtexResult.length > 0) return bibtexResult
  const risResult = parseRIS(trimmed)
  if (risResult.length > 0) return risResult
  return []
}

// ---------------------------------------------------------------------------
// Citation formatter
// ---------------------------------------------------------------------------

export function formatCitation(ref: { title: string; authors: string[]; year?: number; journal?: string; volume?: string; issue?: string; pages?: string; doi?: string }): string {
  const parts: string[] = []

  // Authors
  if (ref.authors.length > 0) {
    if (ref.authors.length <= 3) {
      parts.push(ref.authors.join(', '))
    } else {
      parts.push(`${ref.authors[0]} et al.`)
    }
  }

  // Year
  if (ref.year) parts.push(`(${ref.year})`)

  // Title
  parts.push(ref.title + '.')

  // Journal, volume, pages
  if (ref.journal) {
    let journalPart = ref.journal
    if (ref.volume) {
      journalPart += `, ${ref.volume}`
      if (ref.issue) journalPart += `(${ref.issue})`
    }
    if (ref.pages) journalPart += `, ${ref.pages}`
    parts.push(journalPart + '.')
  }

  // DOI
  if (ref.doi) parts.push(`doi:${ref.doi}`)

  return parts.join(' ')
}

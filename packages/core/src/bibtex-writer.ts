import type { Reference } from './types.js'

const ENTRY_TYPE_MAP: Record<string, string> = {
  article: 'article',
  inproceedings: 'inproceedings',
  conference: 'inproceedings',
  book: 'book',
  incollection: 'incollection',
  phdthesis: 'phdthesis',
  mastersthesis: 'mastersthesis',
  techreport: 'techreport',
  unpublished: 'unpublished',
  misc: 'misc',
  preprint: 'misc',
}

function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}]/g, m => `\\${m}`)
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}')
}

function wrapBraces(s: string): string {
  return `{${s}}`
}

function formatAuthors(authors: string[]): string {
  return authors.join(' and ')
}

/** Serialize a single Reference to a BibTeX entry string */
export function referenceToBibTeX(ref: Reference): string {
  const type = ENTRY_TYPE_MAP[ref.entryType?.toLowerCase() ?? ''] ?? 'misc'
  const key = ref.id

  const fields: [string, string][] = []

  if (ref.title) fields.push(['title', wrapBraces(escapeLatex(ref.title))])
  if (ref.authors?.length) fields.push(['author', wrapBraces(formatAuthors(ref.authors.map(escapeLatex)))])
  if (ref.year) fields.push(['year', String(ref.year)])

  // Venue → journal or booktitle depending on entry type
  const venue = ref.journal ?? ref.venue
  if (venue) {
    const venueField = (type === 'inproceedings' || type === 'incollection') ? 'booktitle' : 'journal'
    fields.push([venueField, wrapBraces(escapeLatex(venue))])
  }

  if (ref.volume) fields.push(['volume', ref.volume])
  if (ref.issue) fields.push(['number', ref.issue])
  if (ref.pages) fields.push(['pages', ref.pages.replace(/–|—/g, '--')])
  if (ref.publisher) fields.push(['publisher', wrapBraces(escapeLatex(ref.publisher))])
  if (ref.doi) fields.push(['doi', wrapBraces(ref.doi)])
  if (ref.url) fields.push(['url', wrapBraces(ref.url)])
  if (ref.abstract) fields.push(['abstract', wrapBraces(escapeLatex(ref.abstract))])
  if (ref.pmid) fields.push(['note', wrapBraces(`PMID: ${ref.pmid}`)])

  const fieldLines = fields.map(([k, v]) => `  ${k} = ${v}`).join(',\n')
  return `@${type}{${key},\n${fieldLines}\n}`
}

/** Serialize an array of References to a complete BibTeX file string */
export function toBibTeX(refs: Reference[]): string {
  return refs.map(referenceToBibTeX).join('\n\n') + '\n'
}

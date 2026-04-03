/**
 * Reference Import Parsers
 *
 * Parses BibTeX, RIS, and EndNote XML into a normalized CSL-JSON-like format
 * for bulk insertion into the references table.
 */

import { parse as parseBibtex } from '@retorquere/bibtex-parser'

// ── CSL-JSON Reference Type ──────────────────────────────────────────

export interface CslReference {
  type: string               // CSL type: article-journal, book, chapter, etc.
  title: string
  authors: CslAuthor[]
  year?: string
  month?: string
  abstract?: string
  doi?: string
  url?: string
  journal?: string
  volume?: string
  issue?: string
  pages?: string
  publisher?: string
  isbn?: string
  issn?: string
  keywords?: string[]
  language?: string
  // Raw fields for anything we didn't map
  extra?: Record<string, string>
}

export interface CslAuthor {
  family?: string
  given?: string
  literal?: string           // For corporate/unknown names
}

export interface ImportResult {
  references: CslReference[]
  errors: string[]
}

// ── BibTeX Type Mapping ──────────────────────────────────────────────

const BIBTEX_TYPE_MAP: Record<string, string> = {
  article: 'article-journal',
  book: 'book',
  booklet: 'pamphlet',
  inbook: 'chapter',
  incollection: 'chapter',
  inproceedings: 'paper-conference',
  conference: 'paper-conference',
  manual: 'book',
  mastersthesis: 'thesis',
  phdthesis: 'thesis',
  proceedings: 'book',
  techreport: 'report',
  unpublished: 'manuscript',
  misc: 'document',
  online: 'webpage',
  patent: 'patent',
  software: 'software',
  dataset: 'dataset',
}

// ── BibTeX Parser ────────────────────────────────────────────────────

export function parseBibtexFile(content: string): ImportResult {
  const errors: string[] = []

  let library
  try {
    library = parseBibtex(content, { sentenceCase: false })
  } catch (err) {
    return { references: [], errors: [`BibTeX parse error: ${err instanceof Error ? err.message : String(err)}`] }
  }

  // Collect parse errors
  for (const e of library.errors) {
    errors.push(`BibTeX warning: ${e.message}`)
  }

  const references: CslReference[] = []

  for (const entry of library.entries) {
    try {
      const f = entry.fields
      const authors: CslAuthor[] = []

      // Authors from parsed creator fields
      // @retorquere/bibtex-parser uses lastName/firstName (not family/given)
      if (f.author && Array.isArray(f.author)) {
        for (const a of f.author as Array<{ lastName?: string; firstName?: string; family?: string; given?: string; literal?: string }>) {
          const family = a.lastName || a.family
          const given = a.firstName || a.given
          authors.push({
            family: family || undefined,
            given: given || undefined,
            literal: (!family && !given) ? (a.literal || undefined) : undefined,
          })
        }
      }

      // Editors as authors if no authors
      if (authors.length === 0 && f.editor && Array.isArray(f.editor)) {
        for (const a of f.editor as Array<{ lastName?: string; firstName?: string; family?: string; given?: string; literal?: string }>) {
          const family = a.lastName || a.family
          const given = a.firstName || a.given
          authors.push({
            family: family || undefined,
            given: given || undefined,
            literal: (!family && !given) ? (a.literal || undefined) : undefined,
          })
        }
      }

      const ref: CslReference = {
        type: BIBTEX_TYPE_MAP[entry.type.toLowerCase()] || 'document',
        title: String(f.title || 'Untitled'),
        authors,
        year: f.year ? String(f.year) : undefined,
        month: f.month ? String(f.month) : undefined,
        abstract: f.abstract ? String(f.abstract) : undefined,
        doi: f.doi ? String(f.doi) : undefined,
        url: f.url ? String(f.url) : undefined,
        journal: f.journal || f.journaltitle ? String(f.journal || f.journaltitle) : undefined,
        volume: f.volume ? String(f.volume) : undefined,
        issue: f.number ? String(f.number) : undefined,
        pages: f.pages ? String(f.pages) : undefined,
        publisher: Array.isArray(f.publisher) ? f.publisher.join('; ') : f.publisher ? String(f.publisher) : undefined,
        isbn: f.isbn ? String(f.isbn) : undefined,
        issn: f.issn ? String(f.issn) : undefined,
        keywords: f.keywords && Array.isArray(f.keywords) ? f.keywords.map(String) : undefined,
        language: f.langid ? String(f.langid) : undefined,
      }

      references.push(ref)
    } catch (err) {
      errors.push(`Failed to convert entry "${entry.key}": ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { references, errors }
}

// ── RIS Parser ───────────────────────────────────────────────────────

const RIS_TYPE_MAP: Record<string, string> = {
  JOUR: 'article-journal',
  JFULL: 'article-journal',
  ABST: 'article-journal',
  BOOK: 'book',
  CHAP: 'chapter',
  CONF: 'paper-conference',
  CPAPER: 'paper-conference',
  THES: 'thesis',
  RPRT: 'report',
  UNPB: 'manuscript',
  ELEC: 'webpage',
  GEN: 'document',
  MGZN: 'article-magazine',
  NEWS: 'article-newspaper',
  PAT: 'patent',
  SER: 'book',
  SOUND: 'song',
  VIDEO: 'motion_picture',
  MAP: 'map',
  COMP: 'software',
  DATA: 'dataset',
  SLIDE: 'document',
  PAMP: 'pamphlet',
  CTLG: 'book',
  CASE: 'legal_case',
  BILL: 'bill',
  STAT: 'legislation',
  HEAR: 'hearing',
}

/**
 * Parse an author name string into family/given parts.
 * Handles "Last, First" and "First Last" formats.
 */
function parseRisAuthor(name: string): CslAuthor {
  const trimmed = name.trim()
  if (!trimmed) return { literal: 'Unknown' }

  if (trimmed.includes(',')) {
    const [family, ...rest] = trimmed.split(',')
    return { family: family.trim(), given: rest.join(',').trim() || undefined }
  }

  // "First Middle Last" format
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { literal: parts[0] }
  const family = parts[parts.length - 1]
  const given = parts.slice(0, -1).join(' ')
  return { family, given }
}

export function parseRisFile(content: string): ImportResult {
  const errors: string[] = []
  const references: CslReference[] = []

  // Normalize line endings
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  let currentEntry: Record<string, string[]> | null = null
  let entryCount = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // RIS tag format: "XX  - value" or "ER  -"
    const match = trimmed.match(/^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/)
    if (!match) {
      // Could be continuation of previous field
      continue
    }

    const [, tag, value] = match

    if (tag === 'TY') {
      currentEntry = { TY: [value.trim()] }
      entryCount++
    } else if (tag === 'ER') {
      if (currentEntry) {
        try {
          const ref = convertRisEntry(currentEntry)
          references.push(ref)
        } catch (err) {
          errors.push(`Failed to convert RIS entry #${entryCount}: ${err instanceof Error ? err.message : String(err)}`)
        }
        currentEntry = null
      }
    } else if (currentEntry) {
      if (!currentEntry[tag]) currentEntry[tag] = []
      currentEntry[tag].push(value.trim())
    }
  }

  // Handle entry without closing ER tag
  if (currentEntry) {
    try {
      const ref = convertRisEntry(currentEntry)
      references.push(ref)
    } catch (err) {
      errors.push(`Failed to convert last RIS entry: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (references.length === 0 && errors.length === 0) {
    errors.push('No valid RIS entries found in file')
  }

  return { references, errors }
}

function convertRisEntry(entry: Record<string, string[]>): CslReference {
  const type = entry.TY?.[0] || 'GEN'
  const authors: CslAuthor[] = []

  // AU = primary authors, A1 = first author (alternative)
  const authorTags = ['AU', 'A1', 'A2', 'A3', 'A4']
  for (const tag of authorTags) {
    if (entry[tag]) {
      for (const name of entry[tag]) {
        authors.push(parseRisAuthor(name))
      }
    }
    if (authors.length > 0) break // Only use first tag that has authors
  }

  // Year from PY (primary year) or Y1 (year), or DA (date)
  let year = entry.PY?.[0] || entry.Y1?.[0] || entry.DA?.[0]
  if (year && year.includes('/')) {
    year = year.split('/')[0] // "2023/01/15" → "2023"
  }

  return {
    type: RIS_TYPE_MAP[type] || 'document',
    title: entry.TI?.[0] || entry.T1?.[0] || entry.CT?.[0] || 'Untitled',
    authors,
    year,
    abstract: entry.AB?.[0] || entry.N2?.[0],
    doi: entry.DO?.[0] || entry.M3?.[0], // M3 sometimes holds DOI
    url: entry.UR?.[0] || entry.L1?.[0],
    journal: entry.JO?.[0] || entry.JF?.[0] || entry.JA?.[0] || entry.T2?.[0],
    volume: entry.VL?.[0],
    issue: entry.IS?.[0],
    pages: entry.SP?.[0] && entry.EP?.[0]
      ? `${entry.SP[0]}-${entry.EP[0]}`
      : entry.SP?.[0],
    publisher: entry.PB?.[0],
    isbn: entry.SN?.[0],
    keywords: entry.KW,
    language: entry.LA?.[0],
  }
}

// ── EndNote XML Parser ───────────────────────────────────────────────

const ENDNOTE_TYPE_MAP: Record<string, string> = {
  'Journal Article': 'article-journal',
  'Book': 'book',
  'Book Section': 'chapter',
  'Conference Paper': 'paper-conference',
  'Conference Proceedings': 'paper-conference',
  'Thesis': 'thesis',
  'Report': 'report',
  'Manuscript': 'manuscript',
  'Web Page': 'webpage',
  'Electronic Article': 'article-journal',
  'Patent': 'patent',
  'Newspaper Article': 'article-newspaper',
  'Magazine Article': 'article-magazine',
  'Computer Program': 'software',
  'Map': 'map',
  'Film or Broadcast': 'motion_picture',
  'Generic': 'document',
}

/**
 * Simple XML text extraction — gets text content of named elements.
 * This is intentionally simple and doesn't need a full XML parser dependency.
 */
function getXmlText(xml: string, tagName: string): string[] {
  const results: string[] = []
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'gi')
  let match
  while ((match = regex.exec(xml)) !== null) {
    // Strip nested XML tags and decode basic entities
    const text = match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
      .trim()
    if (text) results.push(text)
  }
  return results
}

function getXmlBlocks(xml: string, tagName: string): string[] {
  const results: string[] = []
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'gi')
  let match
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1])
  }
  return results
}

export function parseEndnoteXml(content: string): ImportResult {
  const errors: string[] = []
  const references: CslReference[] = []

  // Find all <record> blocks
  const records = getXmlBlocks(content, 'record')

  if (records.length === 0) {
    // Try <xml><records><record> pattern (common in EndNoteXML)
    const recordsBlock = getXmlBlocks(content, 'records')
    if (recordsBlock.length > 0) {
      for (const block of recordsBlock) {
        records.push(...getXmlBlocks(block, 'record'))
      }
    }
  }

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    try {
      const refType = getXmlText(record, 'ref-type')[0] || 'Generic'
      // ref-type might have a name attribute
      const refTypeMatch = record.match(/<ref-type[^>]*name="([^"]*)"/)
      const typeName = refTypeMatch ? refTypeMatch[1] : refType

      const authors: CslAuthor[] = []
      const authorBlock = getXmlBlocks(record, 'authors')[0]
      if (authorBlock) {
        const authorNames = getXmlText(authorBlock, 'author')
        for (const name of authorNames) {
          authors.push(parseRisAuthor(name)) // Same name parsing logic works
        }
      }

      // Alternative: contributors > authors path
      if (authors.length === 0) {
        const contribBlock = getXmlBlocks(record, 'contributors')[0]
        if (contribBlock) {
          const authBlock = getXmlBlocks(contribBlock, 'authors')[0]
          if (authBlock) {
            const authorNames = getXmlText(authBlock, 'author')
            for (const name of authorNames) {
              authors.push(parseRisAuthor(name))
            }
          }
        }
      }

      const titles = getXmlText(record, 'title')
      const secondaryTitles = getXmlText(record, 'secondary-title')

      // Year from dates > year or just year
      let year = getXmlText(record, 'year')[0]
      if (!year) {
        const datesBlock = getXmlBlocks(record, 'dates')[0]
        if (datesBlock) {
          year = getXmlText(datesBlock, 'year')[0]
        }
      }

      // Keywords
      const keywordsBlock = getXmlBlocks(record, 'keywords')[0]
      const keywords = keywordsBlock ? getXmlText(keywordsBlock, 'keyword') : undefined

      // URLs
      const urlsBlock = getXmlBlocks(record, 'urls')[0] || getXmlBlocks(record, 'related-urls')[0]
      const urls = urlsBlock ? getXmlText(urlsBlock, 'url') : []

      // Electronic resource number (usually DOI)
      const ern = getXmlText(record, 'electronic-resource-num')[0]

      const ref: CslReference = {
        type: ENDNOTE_TYPE_MAP[typeName] || 'document',
        title: titles[0] || 'Untitled',
        authors,
        year,
        abstract: getXmlText(record, 'abstract')[0],
        doi: ern || undefined,
        url: urls[0],
        journal: secondaryTitles[0],
        volume: getXmlText(record, 'volume')[0],
        issue: getXmlText(record, 'number')[0],
        pages: getXmlText(record, 'pages')[0],
        publisher: getXmlText(record, 'publisher')[0],
        isbn: getXmlText(record, 'isbn')[0],
        keywords: keywords && keywords.length > 0 ? keywords : undefined,
        language: getXmlText(record, 'language')[0],
      }

      references.push(ref)
    } catch (err) {
      errors.push(`Failed to convert EndNote record #${i + 1}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (references.length === 0 && errors.length === 0) {
    errors.push('No valid EndNote XML records found in file')
  }

  return { references, errors }
}

// ── Format Detection & Unified Import ────────────────────────────────

export type ImportFormat = 'bibtex' | 'ris' | 'endnote-xml'

/**
 * Detect the format of a reference file from its extension and/or content.
 */
export function detectFormat(filename: string, content: string): ImportFormat | null {
  const ext = filename.toLowerCase().split('.').pop()

  // Extension-based detection
  if (ext === 'bib' || ext === 'bibtex') return 'bibtex'
  if (ext === 'ris') return 'ris'
  if (ext === 'xml' || ext === 'enw') return 'endnote-xml'

  // Content-based detection
  const trimmed = content.trim()
  if (trimmed.startsWith('@') && /^@\w+\s*\{/m.test(trimmed)) return 'bibtex'
  if (/^TY\s{2}-\s/m.test(trimmed)) return 'ris'
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<xml') || /<records?[\s>]/i.test(trimmed)) return 'endnote-xml'

  return null
}

/**
 * Parse a reference file in any supported format.
 */
export function parseReferences(content: string, format: ImportFormat): ImportResult {
  switch (format) {
    case 'bibtex':
      return parseBibtexFile(content)
    case 'ris':
      return parseRisFile(content)
    case 'endnote-xml':
      return parseEndnoteXml(content)
  }
}

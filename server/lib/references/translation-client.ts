/**
 * Zotero Translation Server client with fallback to direct API calls.
 *
 * Two modes:
 *   1. Self-hosted — user runs the translation-server Docker container,
 *      configured via TRANSLATION_SERVER_URL env var.
 *   2. Fallback — direct HTTP calls to CrossRef (DOIs), PubMed (PMIDs),
 *      arXiv (arXiv IDs).
 *
 * Returns CSL-JSON for any supported identifier.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch with timeout (default 15s). Prevents hanging requests to external APIs. */
function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeoutId))
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** CSL-JSON item (subset of fields we care about) */
export interface CslJsonItem {
  type: string
  id?: string
  title?: string
  author?: Array<{ family?: string; given?: string; literal?: string }>
  issued?: { 'date-parts'?: number[][] }
  'container-title'?: string
  volume?: string
  issue?: string
  page?: string
  DOI?: string
  URL?: string
  PMID?: string
  ISSN?: string
  ISBN?: string
  abstract?: string
  publisher?: string
  [key: string]: unknown
}

export type IdentifierType = 'doi' | 'pmid' | 'arxiv' | 'isbn' | 'url'

export interface ParsedIdentifier {
  type: IdentifierType
  value: string
}

// ---------------------------------------------------------------------------
// Identifier parsing (based on Zotero's extractIdentifiers logic)
// ---------------------------------------------------------------------------

const DOI_RE = /10\.\d{4,}\/[^\s]+/i
const PMID_RE = /^(?:pmid[:\s]*)(\d+)$/i
const PMID_BARE_RE = /^\d{5,}$/ // bare number ≥5 digits treated as PMID
const ARXIV_RE = /(?:arxiv[:\s]*)?((?:\d{4}\.\d{4,5}(?:v\d+)?)|(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?))/i
const ISBN_RE = /(?:isbn[:\s]*)?(97[89][\d-]{10,}|\d{9}[\dXx])/i
const URL_RE = /^https?:\/\/.+/i

export function parseIdentifier(raw: string): ParsedIdentifier | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // DOI — also accept "doi:" prefix or full dx.doi.org / doi.org URLs
  const doiCleaned = trimmed
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
  const doiMatch = doiCleaned.match(DOI_RE)
  if (doiMatch) {
    // Strip trailing punctuation that's often copy-pasted
    const doi = doiMatch[0].replace(/[.,;)\]}>]+$/, '')
    return { type: 'doi', value: doi }
  }

  // PMID
  const pmidMatch = trimmed.match(PMID_RE)
  if (pmidMatch) return { type: 'pmid', value: pmidMatch[1] }
  if (PMID_BARE_RE.test(trimmed)) return { type: 'pmid', value: trimmed }

  // arXiv
  const arxivMatch = trimmed.replace(/^https?:\/\/arxiv\.org\/abs\//i, '').match(ARXIV_RE)
  if (arxivMatch) return { type: 'arxiv', value: arxivMatch[1] }

  // ISBN
  const isbnMatch = trimmed.match(ISBN_RE)
  if (isbnMatch) return { type: 'isbn', value: isbnMatch[1].replace(/-/g, '') }

  // URL
  if (URL_RE.test(trimmed)) return { type: 'url', value: trimmed }

  return null
}

// ---------------------------------------------------------------------------
// Translation server mode
// ---------------------------------------------------------------------------

async function lookupViaTranslationServer(
  serverUrl: string,
  identifier: ParsedIdentifier,
): Promise<CslJsonItem[]> {
  // The translation-server /search endpoint accepts a query string
  const searchUrl = `${serverUrl.replace(/\/$/, '')}/search`

  let query: string
  switch (identifier.type) {
    case 'doi':
      query = `https://doi.org/${identifier.value}`
      break
    case 'pmid':
      query = `https://pubmed.ncbi.nlm.nih.gov/${identifier.value}`
      break
    case 'arxiv':
      query = `https://arxiv.org/abs/${identifier.value}`
      break
    case 'isbn':
      query = identifier.value
      break
    case 'url':
      query = identifier.value
      break
  }

  const resp = await fetchWithTimeout(searchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: query,
  }, 30_000)

  if (!resp.ok) {
    throw new Error(`Translation server returned ${resp.status}: ${await resp.text()}`)
  }

  // Translation server returns Zotero item JSON; convert to CSL-JSON via /export
  const items = await resp.json()

  // Use the export endpoint to get CSL-JSON
  const exportUrl = `${serverUrl.replace(/\/$/, '')}/export?format=csljson`
  const exportResp = await fetchWithTimeout(exportUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  }, 30_000)

  if (!exportResp.ok) {
    throw new Error(`Translation server export returned ${exportResp.status}: ${await exportResp.text()}`)
  }

  const csl = await exportResp.json()
  return Array.isArray(csl) ? csl : csl.items ?? [csl]
}

// ---------------------------------------------------------------------------
// Fallback: direct API calls
// ---------------------------------------------------------------------------

/**
 * CrossRef API → CSL-JSON for DOIs.
 * The CrossRef /works/{doi} endpoint returns a "message" that is essentially
 * CSL-JSON already (with a few extra fields).
 */
async function lookupDoi(doi: string): Promise<CslJsonItem[]> {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`
  const resp = await fetchWithTimeout(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Astro/1.0 (https://astroanywhere.com; mailto:support@astroanywhere.com)',
    },
  })

  if (!resp.ok) {
    throw new Error(`CrossRef returned ${resp.status} for DOI ${doi}`)
  }

  const data = await resp.json()
  const msg = data.message
  if (!msg) throw new Error('CrossRef response missing message field')

  const item: CslJsonItem = {
    type: crossrefTypeToCsl(msg.type),
    id: doi,
    title: Array.isArray(msg.title) ? msg.title[0] : msg.title,
    author: (msg.author ?? []).map((a: Record<string, string>) => ({
      family: a.family,
      given: a.given,
    })),
    issued: msg.issued,
    'container-title': Array.isArray(msg['container-title'])
      ? msg['container-title'][0]
      : msg['container-title'],
    volume: msg.volume,
    issue: msg.issue,
    page: msg.page,
    DOI: doi,
    URL: msg.URL,
    ISSN: Array.isArray(msg.ISSN) ? msg.ISSN[0] : msg.ISSN,
    ISBN: Array.isArray(msg.ISBN) ? msg.ISBN[0] : msg.ISBN,
    abstract: msg.abstract,
    publisher: msg.publisher,
  }
  return [item]
}

function crossrefTypeToCsl(crType: string): string {
  const map: Record<string, string> = {
    'journal-article': 'article-journal',
    'book-chapter': 'chapter',
    'proceedings-article': 'paper-conference',
    'posted-content': 'article',
    monograph: 'book',
    book: 'book',
    report: 'report',
    dataset: 'dataset',
    dissertation: 'thesis',
  }
  return map[crType] ?? 'article'
}

/**
 * PubMed E-utilities → CSL-JSON for PMIDs.
 * Uses efetch with rettype=xml (PubMed's most complete format) then converts.
 */
async function lookupPmid(pmid: string): Promise<CslJsonItem[]> {
  // Use ESummary JSON API for cleaner parsing
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`
  const resp = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Astro/1.0 (https://astroanywhere.com; mailto:support@astroanywhere.com)',
    },
  })

  if (!resp.ok) {
    throw new Error(`PubMed returned ${resp.status} for PMID ${pmid}`)
  }

  const data = await resp.json()
  const result = data?.result?.[pmid]
  if (!result) throw new Error(`PubMed returned no result for PMID ${pmid}`)

  const authors = (result.authors ?? []).map(
    (a: { name: string; authtype?: string }) => {
      const parts = a.name.split(/\s+/)
      const family = parts[0]
      const given = parts.slice(1).join(' ')
      return { family, given }
    },
  )

  // Parse date: PubMed returns "pubdate" like "2024 Jan 15" or "2024 Jan"
  const dateParts = parsePubmedDate(result.pubdate ?? result.sortpubdate ?? '')

  const item: CslJsonItem = {
    type: 'article-journal',
    id: pmid,
    title: result.title,
    author: authors,
    issued: dateParts ? { 'date-parts': [dateParts] } : undefined,
    'container-title': result.fulljournalname || result.source,
    volume: result.volume || undefined,
    issue: result.issue || undefined,
    page: result.pages || undefined,
    PMID: pmid,
    DOI: result.elocationid?.replace(/^doi:\s*/i, '') || undefined,
  }
  return [item]
}

function parsePubmedDate(dateStr: string): number[] | null {
  if (!dateStr) return null
  const months: Record<string, number> = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
  }
  const parts = dateStr.split(/[\s/]+/)
  const year = parseInt(parts[0], 10)
  if (isNaN(year)) return null
  const month = months[parts[1]] ?? undefined
  const day = parts[2] ? parseInt(parts[2], 10) : undefined
  const result = [year]
  if (month) result.push(month)
  if (day && !isNaN(day)) result.push(day)
  return result
}

/**
 * arXiv API → CSL-JSON for arXiv IDs.
 * Uses the Atom feed API and parses the XML response.
 */
async function lookupArxiv(arxivId: string): Promise<CslJsonItem[]> {
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`
  const resp = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Astro/1.0 (https://astroanywhere.com; mailto:support@astroanywhere.com)',
    },
  })

  if (!resp.ok) {
    throw new Error(`arXiv API returned ${resp.status} for ${arxivId}`)
  }

  const xml = await resp.text()

  // Simple XML extraction (no external parser needed)
  const title = extractXmlText(xml, 'title', 1) // skip feed title (index 0)
  const summary = extractXmlText(xml, 'summary')
  const published = extractXmlText(xml, 'published')
  const authors = extractAllXmlText(xml, 'name')
  const doi = extractXmlAttr(xml, 'link', 'title', 'doi', 'href')

  if (!title) {
    throw new Error(`arXiv returned no entry for ${arxivId}`)
  }

  const parsedAuthors = authors.map((name) => {
    const parts = name.trim().split(/\s+/)
    const family = parts.pop() ?? ''
    const given = parts.join(' ')
    return { family, given }
  })

  const dateParts = published
    ? published.slice(0, 10).split('-').map(Number)
    : undefined

  const item: CslJsonItem = {
    type: 'article',
    id: arxivId,
    title: title.trim().replace(/\s+/g, ' '),
    author: parsedAuthors,
    issued: dateParts ? { 'date-parts': [dateParts] } : undefined,
    URL: `https://arxiv.org/abs/${arxivId}`,
    abstract: summary?.trim().replace(/\s+/g, ' '),
    DOI: doi || undefined,
    publisher: 'arXiv',
  }
  return [item]
}

/** Extract text content from an XML tag. `skip` skips the first N matches. */
function extractXmlText(xml: string, tag: string, skip = 0): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g')
  let match: RegExpExecArray | null
  let i = 0
  while ((match = re.exec(xml)) !== null) {
    if (i === skip) return match[1]
    i++
  }
  return null
}

/** Extract all text occurrences of a tag. */
function extractAllXmlText(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g')
  const results: string[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) {
    results.push(match[1])
  }
  return results
}

/** Extract an attribute from a tag that has a specific attribute value. */
function extractXmlAttr(
  xml: string,
  tag: string,
  filterAttr: string,
  filterValue: string,
  targetAttr: string,
): string | null {
  const re = new RegExp(`<${tag}[^>]*${filterAttr}="${filterValue}"[^>]*>`, 'g')
  const match = re.exec(xml)
  if (!match) return null
  const attrRe = new RegExp(`${targetAttr}="([^"]*)"`)
  const attrMatch = match[0].match(attrRe)
  return attrMatch?.[1] ?? null
}

// ---------------------------------------------------------------------------
// ISBN fallback — use Open Library as a free ISBN lookup
// ---------------------------------------------------------------------------

async function lookupIsbn(isbn: string): Promise<CslJsonItem[]> {
  // Open Library Books API
  const url = `https://openlibrary.org/isbn/${isbn}.json`
  const resp = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Astro/1.0 (https://astroanywhere.com; mailto:support@astroanywhere.com)',
    },
  })

  if (!resp.ok) {
    throw new Error(`Open Library returned ${resp.status} for ISBN ${isbn}`)
  }

  const data = await resp.json()

  // Resolve authors in parallel (capped at 10 to avoid excessive requests)
  const authors: CslJsonItem['author'] = []
  if (data.authors) {
    const authorKeys = data.authors
      .map((a: { key?: string }) => a.key)
      .filter(Boolean)
      .slice(0, 10) as string[]

    const results = await Promise.allSettled(
      authorKeys.map(async (key) => {
        const authorResp = await fetchWithTimeout(`https://openlibrary.org${key}.json`, undefined, 10_000)
        if (!authorResp.ok) return null
        const authorData = await authorResp.json()
        const name = (authorData.name as string) ?? ''
        const parts = name.split(/\s+/)
        const family = parts.pop() ?? ''
        const given = parts.join(' ')
        return { family, given }
      }),
    )
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        authors.push(result.value)
      }
    }
  }

  const item: CslJsonItem = {
    type: 'book',
    id: isbn,
    title: data.title,
    author: authors,
    issued: data.publish_date
      ? { 'date-parts': [parseLooseDate(data.publish_date)] }
      : undefined,
    publisher: Array.isArray(data.publishers) ? data.publishers[0] : data.publisher,
    ISBN: isbn,
    URL: `https://openlibrary.org/isbn/${isbn}`,
  }
  return [item]
}

function parseLooseDate(dateStr: string): number[] {
  // Try "YYYY" or "Month DD, YYYY" or "YYYY-MM-DD"
  const yearMatch = dateStr.match(/(\d{4})/)
  if (!yearMatch) return []
  return [parseInt(yearMatch[1], 10)]
}

// ---------------------------------------------------------------------------
// URL fallback — try to get metadata from the page via Zotero or CrossRef
// ---------------------------------------------------------------------------

async function lookupUrl(url: string): Promise<CslJsonItem[]> {
  // For URLs, check if it contains a DOI we can extract
  const doiMatch = url.match(DOI_RE)
  if (doiMatch) {
    return lookupDoi(doiMatch[0].replace(/[.,;)\]}>]+$/, ''))
  }

  // For arXiv URLs
  const arxivMatch = url.match(/arxiv\.org\/abs\/([\d.]+(?:v\d+)?)/i)
  if (arxivMatch) {
    return lookupArxiv(arxivMatch[1])
  }

  // For PubMed URLs
  const pmidMatch = url.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i)
  if (pmidMatch) {
    return lookupPmid(pmidMatch[1])
  }

  // Generic URL — return a basic webpage item
  const item: CslJsonItem = {
    type: 'webpage',
    id: url,
    title: url,
    URL: url,
  }
  return [item]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LookupResult {
  success: boolean
  identifier: ParsedIdentifier | null
  items: CslJsonItem[]
  source: 'translation-server' | 'fallback'
  error?: string
}

/**
 * Look up bibliographic metadata for a given identifier string.
 * Tries the Zotero translation server first (if configured), falls back to
 * direct API calls.
 */
export async function lookupIdentifier(raw: string): Promise<LookupResult> {
  const identifier = parseIdentifier(raw)
  if (!identifier) {
    return {
      success: false,
      identifier: null,
      items: [],
      source: 'fallback',
      error: `Could not parse identifier: "${raw}"`,
    }
  }

  const translationServerUrl = process.env.TRANSLATION_SERVER_URL

  // Try translation server first if configured
  if (translationServerUrl) {
    try {
      const items = await lookupViaTranslationServer(translationServerUrl, identifier)
      return { success: true, identifier, items, source: 'translation-server' }
    } catch (err) {
      // Fall through to direct API calls
      console.warn(
        `Translation server failed for ${identifier.type}:${identifier.value}, falling back to direct APIs:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  // Fallback: direct API calls
  try {
    let items: CslJsonItem[]
    switch (identifier.type) {
      case 'doi':
        items = await lookupDoi(identifier.value)
        break
      case 'pmid':
        items = await lookupPmid(identifier.value)
        break
      case 'arxiv':
        items = await lookupArxiv(identifier.value)
        break
      case 'isbn':
        items = await lookupIsbn(identifier.value)
        break
      case 'url':
        items = await lookupUrl(identifier.value)
        break
    }
    return { success: true, identifier, items, source: 'fallback' }
  } catch (err) {
    return {
      success: false,
      identifier,
      items: [],
      source: 'fallback',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

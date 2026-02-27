/**
 * arXiv API Client
 *
 * Fetches paper metadata from the arXiv API (Atom feed format).
 * https://info.arxiv.org/help/api/basics.html
 */

import { parseArxivId, getArxivUrls } from './parser.js'

export interface ArxivAuthor {
  name: string
  affiliation?: string
}

export interface ArxivCategory {
  term: string
  scheme?: string
  isPrimary: boolean
}

export interface ArxivLink {
  href: string
  type?: string
  title?: string
  rel?: string
}

export interface ArxivPaperMetadata {
  /** The arXiv paper ID */
  id: string
  /** Paper title */
  title: string
  /** Paper abstract */
  abstract: string
  /** List of authors */
  authors: ArxivAuthor[]
  /** Publication date */
  published: Date
  /** Last update date */
  updated: Date
  /** Paper categories */
  categories: ArxivCategory[]
  /** Primary category */
  primaryCategory: string
  /** DOI if available */
  doi?: string
  /** Journal reference if available */
  journalRef?: string
  /** Comment (often contains page count, figure count) */
  comment?: string
  /** Links to various formats */
  links: ArxivLink[]
  /** Direct URLs */
  urls: ReturnType<typeof getArxivUrls>
}

/**
 * Parse XML string using regex (Node.js compatible)
 */
function extractXmlTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const match = xml.match(regex)
  return match ? match[1].trim() : null
}

// Unused but kept for future extensions
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _extractXmlTags(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi')
  const matches: string[] = []
  let match
  while ((match = regex.exec(xml)) !== null) {
    matches.push(match[1].trim())
  }
  return matches
}

// Unused but kept for future extensions
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _extractXmlAttribute(xml: string, tag: string, attr: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']*?)["'][^>]*>`, 'i')
  const match = xml.match(regex)
  return match ? match[1] : null
}

function extractLinksFromXml(
  xml: string
): Array<{ href: string; type?: string; title?: string; rel?: string }> {
  const linkRegex = /<link\s+([^>]*)\/>/gi
  const links: Array<{ href: string; type?: string; title?: string; rel?: string }> = []
  let match

  while ((match = linkRegex.exec(xml)) !== null) {
    const attrs = match[1]
    const href = attrs.match(/href=["']([^"']+)["']/)?.[1]
    if (href) {
      links.push({
        href,
        type: attrs.match(/type=["']([^"']+)["']/)?.[1],
        title: attrs.match(/title=["']([^"']+)["']/)?.[1],
        rel: attrs.match(/rel=["']([^"']+)["']/)?.[1],
      })
    }
  }

  return links
}

function extractCategoriesFromXml(xml: string): ArxivCategory[] {
  const categoryRegex = /<category\s+([^>]*)\/>/gi
  const categories: ArxivCategory[] = []
  let match
  let isFirst = true

  while ((match = categoryRegex.exec(xml)) !== null) {
    const attrs = match[1]
    const term = attrs.match(/term=["']([^"']+)["']/)?.[1]
    if (term) {
      categories.push({
        term,
        scheme: attrs.match(/scheme=["']([^"']+)["']/)?.[1],
        isPrimary: isFirst,
      })
      isFirst = false
    }
  }

  return categories
}

function extractAuthorsFromXml(xml: string): ArxivAuthor[] {
  const authorRegex = /<author[^>]*>([\s\S]*?)<\/author>/gi
  const authors: ArxivAuthor[] = []
  let match

  while ((match = authorRegex.exec(xml)) !== null) {
    const authorXml = match[1]
    const name = extractXmlTag(authorXml, 'name')
    if (name) {
      const affiliation = extractXmlTag(authorXml, 'arxiv:affiliation')
      authors.push({
        name,
        affiliation: affiliation || undefined,
      })
    }
  }

  return authors
}

/**
 * Clean text by removing extra whitespace and newlines
 */
function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Parse arXiv API response XML to extract paper metadata
 */
function parseArxivApiResponse(xml: string): ArxivPaperMetadata | null {
  // Extract the entry element
  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/i)
  if (!entryMatch) {
    return null
  }

  const entry = entryMatch[1]

  // Extract ID and clean it
  const idRaw = extractXmlTag(entry, 'id')
  if (!idRaw) return null

  // ID format: http://arxiv.org/abs/2401.12345v1
  const idMatch = idRaw.match(/arxiv\.org\/abs\/(.+)$/i)
  const arxivId = idMatch ? idMatch[1].replace(/v\d+$/, '') : idRaw

  // Extract other fields
  const title = cleanText(extractXmlTag(entry, 'title') || '')
  const abstract = cleanText(extractXmlTag(entry, 'summary') || '')
  const published = extractXmlTag(entry, 'published')
  const updated = extractXmlTag(entry, 'updated')

  // Extract authors
  const authors = extractAuthorsFromXml(entry)

  // Extract categories
  const categories = extractCategoriesFromXml(entry)
  const primaryCategory = categories.find((c) => c.isPrimary)?.term || categories[0]?.term || ''

  // Extract links
  const links = extractLinksFromXml(entry)

  // Extract optional fields
  const doi = extractXmlTag(entry, 'arxiv:doi')
  const journalRef = extractXmlTag(entry, 'arxiv:journal_ref')
  const comment = extractXmlTag(entry, 'arxiv:comment')

  return {
    id: arxivId,
    title,
    abstract,
    authors,
    published: published ? new Date(published) : new Date(),
    updated: updated ? new Date(updated) : new Date(),
    categories,
    primaryCategory,
    doi: doi || undefined,
    journalRef: journalRef || undefined,
    comment: comment || undefined,
    links,
    urls: getArxivUrls(arxivId),
  }
}

/**
 * Fetch paper metadata from arXiv API
 * @param paperIdOrUrl - arXiv paper ID or URL
 * @returns Paper metadata or null if not found
 */
export async function fetchArxivMetadata(paperIdOrUrl: string): Promise<ArxivPaperMetadata | null> {
  const parsed = parseArxivId(paperIdOrUrl)
  if (!parsed) {
    throw new Error(`Invalid arXiv ID or URL: ${paperIdOrUrl}`)
  }

  const apiUrl = `http://export.arxiv.org/api/query?id_list=${parsed.paperId}`

  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Astro-arXiv-Tool/1.0 (https://github.com/astro-platform)',
    },
  })

  if (!response.ok) {
    throw new Error(`arXiv API request failed: ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()

  // Check if paper was found
  if (xml.includes('<opensearch:totalResults>0</opensearch:totalResults>')) {
    return null
  }

  return parseArxivApiResponse(xml)
}

/**
 * Search arXiv for papers matching a query
 * @param query - Search query
 * @param options - Search options
 * @returns List of matching papers
 */
export async function searchArxiv(
  query: string,
  options: {
    maxResults?: number
    start?: number
    sortBy?: 'relevance' | 'lastUpdatedDate' | 'submittedDate'
    sortOrder?: 'ascending' | 'descending'
  } = {}
): Promise<ArxivPaperMetadata[]> {
  const { maxResults = 10, start = 0, sortBy = 'relevance', sortOrder = 'descending' } = options

  const params = new URLSearchParams({
    search_query: query,
    start: start.toString(),
    max_results: maxResults.toString(),
    sortBy,
    sortOrder,
  })

  const apiUrl = `http://export.arxiv.org/api/query?${params}`

  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Astro-arXiv-Tool/1.0',
    },
  })

  if (!response.ok) {
    throw new Error(`arXiv API request failed: ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()

  // Extract all entries
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi
  const entries: ArxivPaperMetadata[] = []
  let match

  while ((match = entryRegex.exec(xml)) !== null) {
    const result = parseArxivApiResponse(`<feed><entry>${match[1]}</entry></feed>`)
    if (result) {
      entries.push(result)
    }
  }

  return entries
}

/**
 * Check if a paper has LaTeX source available
 * Most CS papers have source, but some don't
 * @param paperId - arXiv paper ID
 * @returns true if source is likely available
 */
export async function hasLatexSource(paperId: string): Promise<boolean> {
  const urls = getArxivUrls(paperId)

  try {
    // Do a HEAD request to check if source exists
    const response = await fetch(urls.source, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Astro-arXiv-Tool/1.0',
      },
    })

    // If we get a 200, source exists
    // Note: arXiv may return 200 even for PDFs, but with different content-type
    if (!response.ok) return false

    const contentType = response.headers.get('content-type') || ''
    // Source is usually gzip or application/x-eprint
    return (
      contentType.includes('gzip') ||
      contentType.includes('tar') ||
      contentType.includes('x-eprint') ||
      contentType.includes('application/pdf') === false
    )
  } catch {
    return false
  }
}

/**
 * arXiv Paper Fetcher — Pure parsing utilities
 *
 * URL parsing, ID extraction, and Atom XML metadata parsing.
 * No I/O operations — all functions are pure.
 */

import type {
  ArxivPaperId,
  ArxivPaperMetadata,
  ArxivAuthor,
  ArxivCategory,
  ArxivLink,
  LatexFigureRef,
} from './types.js'

// ────────────────────────────────────────────────────────────────────────────
// arXiv URL/ID Parsing
// ────────────────────────────────────────────────────────────────────────────

/**
 * Regex patterns for matching arXiv paper IDs.
 *
 * New format (post-2007): YYMM.NNNNN (optionally with vN version suffix)
 * Old format (pre-2007):  archive/YYMMNNN (e.g., cs/0601078)
 */
const NEW_ARXIV_ID_RE = /(\d{4}\.\d{4,5})(v(\d+))?/
const OLD_ARXIV_ID_RE = /([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v(\d+))?/

/**
 * URL patterns for extracting arXiv paper IDs from various URL formats:
 * - https://arxiv.org/abs/2301.07041
 * - https://arxiv.org/abs/2301.07041v2
 * - https://arxiv.org/pdf/2301.07041.pdf
 * - https://arxiv.org/pdf/2301.07041v2
 * - https://arxiv.org/e-print/2301.07041
 * - http://arxiv.org/abs/cs/0601078
 * - https://export.arxiv.org/abs/2301.07041
 * - https://ar5iv.labs.arxiv.org/html/2301.07041
 */
const ARXIV_URL_PATTERNS = [
  // New format URLs
  /(?:https?:\/\/)?(?:export\.)?(?:ar5iv\.labs\.)?arxiv\.org\/(?:abs|pdf|e-print|html|src|format)\/(\d{4}\.\d{4,5})(v(\d+))?(?:\.pdf)?/,
  // Old format URLs
  /(?:https?:\/\/)?(?:export\.)?arxiv\.org\/(?:abs|pdf|e-print|src|format)\/([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v(\d+))?(?:\.pdf)?/,
]

/**
 * Parse an arXiv paper ID from a URL or raw ID string.
 *
 * Accepts:
 * - Raw IDs: "2301.07041", "2301.07041v2", "cs/0601078"
 * - Full URLs: "https://arxiv.org/abs/2301.07041v2"
 * - PDF URLs: "https://arxiv.org/pdf/2301.07041.pdf"
 * - ar5iv URLs: "https://ar5iv.labs.arxiv.org/html/2301.07041"
 *
 * @throws Error if the input cannot be parsed as an arXiv ID
 */
export function parseArxivId(input: string): ArxivPaperId {
  const trimmed = input.trim()

  // Try URL patterns first
  for (const pattern of ARXIV_URL_PATTERNS) {
    const match = trimmed.match(pattern)
    if (match) {
      return {
        id: match[3] ? `${match[1]}v${match[3]}` : match[1],
        baseId: match[1],
        version: match[3] ? parseInt(match[3], 10) : null,
      }
    }
  }

  // Try raw new-format ID
  const newMatch = trimmed.match(new RegExp(`^${NEW_ARXIV_ID_RE.source}$`))
  if (newMatch) {
    return {
      id: newMatch[3] ? `${newMatch[1]}v${newMatch[3]}` : newMatch[1],
      baseId: newMatch[1],
      version: newMatch[3] ? parseInt(newMatch[3], 10) : null,
    }
  }

  // Try raw old-format ID
  const oldMatch = trimmed.match(new RegExp(`^${OLD_ARXIV_ID_RE.source}$`))
  if (oldMatch) {
    return {
      id: oldMatch[3] ? `${oldMatch[1]}v${oldMatch[3]}` : oldMatch[1],
      baseId: oldMatch[1],
      version: oldMatch[3] ? parseInt(oldMatch[3], 10) : null,
    }
  }

  throw new Error(
    `Cannot parse arXiv ID from: "${trimmed}". ` +
    'Expected format: "2301.07041", "2301.07041v2", or a full arXiv URL.'
  )
}

/**
 * Check if a string looks like it could be an arXiv reference.
 */
export function isArxivReference(input: string): boolean {
  try {
    parseArxivId(input)
    return true
  } catch {
    return false
  }
}

/**
 * Build arXiv API URL for fetching metadata.
 */
export function buildMetadataUrl(paperId: ArxivPaperId): string {
  return `https://export.arxiv.org/api/query?id_list=${paperId.baseId}`
}

/**
 * Build arXiv e-print (source) download URL.
 */
export function buildSourceUrl(paperId: ArxivPaperId): string {
  const id = paperId.version ? `${paperId.baseId}v${paperId.version}` : paperId.baseId
  return `https://arxiv.org/e-print/${id}`
}

/**
 * Build arXiv PDF download URL.
 */
export function buildPdfUrl(paperId: ArxivPaperId): string {
  const id = paperId.version ? `${paperId.baseId}v${paperId.version}` : paperId.baseId
  return `https://arxiv.org/pdf/${id}`
}

/**
 * Build arXiv abstract page URL.
 */
export function buildAbstractUrl(paperId: ArxivPaperId): string {
  const id = paperId.version ? `${paperId.baseId}v${paperId.version}` : paperId.baseId
  return `https://arxiv.org/abs/${id}`
}

// ────────────────────────────────────────────────────────────────────────────
// Atom XML Metadata Parsing
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract text content from an XML element by tag name.
 * Simple regex-based extraction for well-structured Atom XML.
 */
function extractXmlText(xml: string, tag: string): string | undefined {
  // Handle namespaced and non-namespaced tags
  const patterns = [
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'),
    new RegExp(`<[^:]+:${tag}[^>]*>([\\s\\S]*?)</[^:]+:${tag}>`, 'i'),
  ]

  for (const pattern of patterns) {
    const match = xml.match(pattern)
    if (match) {
      return decodeXmlEntities(match[1].trim())
    }
  }
  return undefined
}

/**
 * Extract all XML elements matching a tag.
 */
function extractAllXmlElements(xml: string, tag: string): string[] {
  const results: string[] = []
  const pattern = new RegExp(`<${tag}[^>]*(?:>([\\s\\S]*?)</${tag}>|/>)`, 'gi')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) {
    results.push(match[0])
  }
  return results
}

/**
 * Extract an XML attribute value.
 */
function extractXmlAttr(element: string, attr: string): string | undefined {
  const match = element.match(new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, 'i'))
  return match ? decodeXmlEntities(match[1]) : undefined
}

/**
 * Decode basic XML entities.
 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
}

/**
 * Parse arXiv Atom API response XML into structured metadata.
 *
 * The arXiv API returns Atom 1.0 XML. This parser extracts the first entry
 * (single paper query) into a typed ArxivPaperMetadata object.
 *
 * @throws Error if the XML contains no entries or indicates an error
 */
export function parseArxivAtomResponse(xml: string): ArxivPaperMetadata {
  // Check for API errors
  const totalResults = extractXmlText(xml, 'opensearch:totalResults')
  if (totalResults === '0') {
    throw new Error('Paper not found on arXiv. Check the paper ID and try again.')
  }

  // Extract the first <entry> element
  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/)
  if (!entryMatch) {
    throw new Error('No entry found in arXiv API response. The paper may not exist.')
  }
  const entry = entryMatch[1]

  // Extract the arXiv ID from the entry's <id> tag
  // Format: http://arxiv.org/abs/2301.07041v2
  const rawId = extractXmlText(entry, 'id') || ''
  const idMatch = rawId.match(/(\d{4}\.\d{4,5})(v(\d+))?/) ||
                  rawId.match(/([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v(\d+))/)
  if (!idMatch) {
    throw new Error(`Cannot parse paper ID from arXiv response: ${rawId}`)
  }

  const baseId = idMatch[1]
  const version = idMatch[3] ? parseInt(idMatch[3], 10) : 1
  const fullId = idMatch[3] ? `${baseId}v${idMatch[3]}` : `${baseId}v1`

  // Extract title (may contain newlines that need collapsing)
  const title = (extractXmlText(entry, 'title') || 'Untitled')
    .replace(/\s+/g, ' ')
    .trim()

  // Extract abstract (summary)
  const abstract = (extractXmlText(entry, 'summary') || '')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Extract authors
  const authorElements = extractAllXmlElements(entry, 'author')
  const authors: ArxivAuthor[] = authorElements.map((el) => ({
    name: extractXmlText(el, 'name') || 'Unknown',
    affiliation: extractXmlText(el, 'arxiv:affiliation'),
  }))

  // Extract categories
  const categoryElements = extractAllXmlElements(entry, 'category')
  const categories: ArxivCategory[] = categoryElements.map((el) => ({
    term: extractXmlAttr(el, 'term') || '',
    isPrimary: false, // Will set primary below
  })).filter((c) => c.term)

  // Extract primary category
  const primaryCategoryEl = entry.match(/<arxiv:primary_category[^>]*\/?>/)
  const primaryCategory = primaryCategoryEl
    ? extractXmlAttr(primaryCategoryEl[0], 'term') || (categories[0]?.term ?? '')
    : (categories[0]?.term ?? '')

  // Mark primary category
  for (const cat of categories) {
    if (cat.term === primaryCategory) {
      cat.isPrimary = true
    }
  }

  // Extract links
  const linkElements = extractAllXmlElements(entry, 'link')
  const links: ArxivLink[] = linkElements.map((el) => ({
    href: extractXmlAttr(el, 'href') || '',
    rel: extractXmlAttr(el, 'rel'),
    type: extractXmlAttr(el, 'type'),
    title: extractXmlAttr(el, 'title'),
  })).filter((l) => l.href)

  // Extract dates
  const published = extractXmlText(entry, 'published') || ''
  const updated = extractXmlText(entry, 'updated') || ''

  // Extract optional fields
  const doi = extractXmlText(entry, 'arxiv:doi')
  const journalRef = extractXmlText(entry, 'arxiv:journal_ref')
  const comment = extractXmlText(entry, 'arxiv:comment')

  return {
    id: fullId,
    baseId,
    version,
    title,
    abstract,
    authors,
    categories,
    primaryCategory,
    published,
    updated,
    doi,
    journalRef,
    comment,
    links,
    abstractUrl: `https://arxiv.org/abs/${fullId}`,
    pdfUrl: `https://arxiv.org/pdf/${fullId}`,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// LaTeX Figure Parsing
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse LaTeX source to find \includegraphics references and their captions.
 * Pure function — does not access the filesystem.
 */
export function parseLatexFigures(texContent: string): LatexFigureRef[] {
  const figures: LatexFigureRef[] = []

  // Match \includegraphics with optional options and required path
  // Handles: \includegraphics{path}, \includegraphics[opts]{path}
  const includePattern = /\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g
  let match: RegExpExecArray | null

  while ((match = includePattern.exec(texContent)) !== null) {
    const options = match[1] || undefined
    const includePath = match[2].trim()

    // Look backwards for enclosing figure environment to find caption/label
    const beforeInclude = texContent.substring(0, match.index)
    const afterInclude = texContent.substring(match.index)

    // Find the enclosing figure environment
    const figureEnvStart = beforeInclude.lastIndexOf('\\begin{figure')
    const figureEnvEnd = afterInclude.indexOf('\\end{figure}')

    let caption: string | undefined
    let label: string | undefined

    if (figureEnvStart !== -1 && figureEnvEnd !== -1) {
      const figureBlock = texContent.substring(
        figureEnvStart,
        match.index + figureEnvEnd + '\\end{figure}'.length
      )

      // Extract caption (handles multi-line and nested braces)
      const captionMatch = figureBlock.match(/\\caption\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/)
      if (captionMatch) {
        caption = captionMatch[1]
          .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1') // Strip simple LaTeX commands
          .replace(/\s+/g, ' ')
          .trim()
      }

      // Extract label
      const labelMatch = figureBlock.match(/\\label\s*\{([^}]+)\}/)
      if (labelMatch) {
        label = labelMatch[1].trim()
      }
    }

    figures.push({
      includePath,
      caption,
      label,
      options,
    })
  }

  return figures
}

/**
 * Extract plain text from LaTeX source by stripping commands and environments.
 * Useful for indexing or summarization.
 */
export function extractLatexText(texContent: string): string {
  let text = texContent

  // Remove comments
  text = text.replace(/%.*$/gm, '')

  // Remove common preamble commands
  text = text.replace(/\\(?:documentclass|usepackage|newcommand|renewcommand|def|let|setlength|setcounter)\s*(?:\[[^\]]*\])?\s*\{[^}]*\}(?:\{[^}]*\})*/g, '')

  // Remove figure/table environments entirely (they are non-text) — must run BEFORE general begin/end stripping
  text = text.replace(/\\begin\{(?:figure|table)\*?\}(?:\[[^\]]*\])?[\s\S]*?\\end\{(?:figure|table)\*?\}/g, '')

  // Remove begin/end environment tags (but keep content)
  text = text.replace(/\\(?:begin|end)\s*\{[^}]*\}(?:\[[^\]]*\])?/g, '')

  // Replace section commands with their titles
  text = text.replace(/\\(?:section|subsection|subsubsection|paragraph|chapter)\*?\s*\{([^}]*)\}/g, '\n\n$1\n\n')

  // Replace common formatting commands with their content
  text = text.replace(/\\(?:textbf|textit|emph|underline|texttt|textsf|textrm|textsc)\s*\{([^}]*)\}/g, '$1')

  // Replace citations and references
  text = text.replace(/\\(?:cite|ref|eqref|cref|Cref|autoref|nameref)\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, '')

  // Remove remaining simple commands
  text = text.replace(/\\[a-zA-Z]+\s*/g, ' ')

  // Remove braces
  text = text.replace(/[{}]/g, '')

  // Clean up math delimiters
  text = text.replace(/\$\$[\s\S]*?\$\$/g, '[equation]')
  text = text.replace(/\$[^$]*\$/g, '[math]')

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.trim()

  return text
}

/**
 * arXiv URL Parser
 *
 * Parses various arXiv URL formats and extracts paper IDs.
 * Supports:
 * - Abstract URLs: https://arxiv.org/abs/2401.12345
 * - PDF URLs: https://arxiv.org/pdf/2401.12345.pdf
 * - HTML URLs: https://arxiv.org/html/2401.12345
 * - Old format: https://arxiv.org/abs/hep-th/9901001
 * - Direct paper IDs: 2401.12345, hep-th/9901001
 */

export interface ParsedArxivId {
  /** The normalized paper ID (e.g., "2401.12345" or "hep-th/9901001") */
  paperId: string
  /** Whether this is the old format with category prefix */
  isOldFormat: boolean
  /** The version number if specified (e.g., "v1", "v2") */
  version?: string
  /** The category for old format papers */
  category?: string
}

/** Regex patterns for different arXiv formats */
const ARXIV_PATTERNS = {
  // New format: 2401.12345 or 2401.12345v2
  newFormat: /^(\d{4}\.\d{4,5})(v\d+)?$/,
  // Old format: category/yymmnnn (e.g., hep-th/9901001)
  oldFormat: /^([a-z-]+)\/(\d{7})(v\d+)?$/i,
  // URL with abs, pdf, html, or e-print
  urlPath:
    /arxiv\.org\/(?:abs|pdf|html|e-print|format)\/([a-z-]+\/\d{7}|\d{4}\.\d{4,5})(v\d+)?(\.pdf)?/i,
  // DOI format
  doi: /10\.48550\/arXiv\.(\d{4}\.\d{4,5})(v\d+)?/i,
}

/**
 * Parse an arXiv URL or paper ID and extract the paper identifier
 * @param input - arXiv URL or paper ID string
 * @returns Parsed paper ID information or null if invalid
 */
export function parseArxivId(input: string): ParsedArxivId | null {
  const trimmed = input.trim()

  // Try to match as a direct new format ID
  const newMatch = trimmed.match(ARXIV_PATTERNS.newFormat)
  if (newMatch) {
    return {
      paperId: newMatch[1],
      isOldFormat: false,
      version: newMatch[2]?.replace('v', ''),
    }
  }

  // Try to match as a direct old format ID
  const oldMatch = trimmed.match(ARXIV_PATTERNS.oldFormat)
  if (oldMatch) {
    return {
      paperId: `${oldMatch[1]}/${oldMatch[2]}`,
      isOldFormat: true,
      category: oldMatch[1],
      version: oldMatch[3]?.replace('v', ''),
    }
  }

  // Try to extract from URL
  const urlMatch = trimmed.match(ARXIV_PATTERNS.urlPath)
  if (urlMatch) {
    const idPart = urlMatch[1]
    const versionPart = urlMatch[2]

    // Check if it's old format
    if (idPart.includes('/')) {
      const [category] = idPart.split('/')
      return {
        paperId: idPart,
        isOldFormat: true,
        category,
        version: versionPart?.replace('v', ''),
      }
    }

    return {
      paperId: idPart,
      isOldFormat: false,
      version: versionPart?.replace('v', ''),
    }
  }

  // Try DOI format
  const doiMatch = trimmed.match(ARXIV_PATTERNS.doi)
  if (doiMatch) {
    return {
      paperId: doiMatch[1],
      isOldFormat: false,
      version: doiMatch[2]?.replace('v', ''),
    }
  }

  return null
}

/**
 * Normalize an arXiv paper ID to a consistent format
 * @param paperId - The paper ID to normalize
 * @returns Normalized paper ID
 */
export function normalizeArxivId(paperId: string): string {
  const parsed = parseArxivId(paperId)
  return parsed?.paperId ?? paperId
}

/**
 * Construct various arXiv URLs from a paper ID
 */
export function getArxivUrls(paperId: string, version?: string) {
  const versionSuffix = version ? `v${version}` : ''
  const normalizedId = normalizeArxivId(paperId)

  return {
    /** Abstract page URL */
    abstract: `https://arxiv.org/abs/${normalizedId}${versionSuffix}`,
    /** PDF download URL */
    pdf: `https://arxiv.org/pdf/${normalizedId}${versionSuffix}.pdf`,
    /** HTML view URL */
    html: `https://arxiv.org/html/${normalizedId}${versionSuffix}`,
    /** LaTeX source tarball URL */
    source: `https://arxiv.org/e-print/${normalizedId}${versionSuffix}`,
    /** API URL for metadata */
    api: `http://export.arxiv.org/api/query?id_list=${normalizedId}${versionSuffix}`,
  }
}

/**
 * Validate if a string is a valid arXiv paper ID or URL
 */
export function isValidArxivInput(input: string): boolean {
  return parseArxivId(input) !== null
}

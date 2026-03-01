/**
 * @astro/core arXiv module — Pure types and parsing utilities
 *
 * This module exports types and pure functions for arXiv paper ID parsing,
 * Atom XML response parsing, and LaTeX source analysis.
 *
 * For I/O operations (HTTP fetching, file downloads, figure extraction),
 * use `server/lib/arxiv/` which builds on these primitives.
 */

// Types
export type {
  ArxivPaperId,
  ArxivAuthor,
  ArxivCategory,
  ArxivLink,
  ArxivPaperMetadata,
  ArxivSourceType,
  ArxivDownloadResult,
  ArxivFigure,
  ArxivFetchOptions,
  LatexFigureRef,
} from './types.js'

export { DEFAULT_FETCH_OPTIONS } from './types.js'

// URL/ID parsing
export {
  parseArxivId,
  isArxivReference,
  buildMetadataUrl,
  buildSourceUrl,
  buildPdfUrl,
  buildAbstractUrl,
} from './parser.js'

// Atom XML parsing
export { parseArxivAtomResponse } from './parser.js'

// LaTeX parsing
export { parseLatexFigures, extractLatexText } from './parser.js'

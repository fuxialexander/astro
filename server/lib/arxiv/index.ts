/**
 * arXiv Paper Fetcher — Server-side module
 *
 * Re-exports the full arXiv fetcher API, combining pure parsing utilities
 * from @astro/core with I/O operations from this module.
 */

// Re-export types and pure functions from core
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
} from '@astro/core/arxiv'

export {
  parseArxivId,
  isArxivReference,
  buildMetadataUrl,
  buildSourceUrl,
  buildPdfUrl,
  buildAbstractUrl,
  parseArxivAtomResponse,
  parseLatexFigures,
  extractLatexText,
  DEFAULT_FETCH_OPTIONS,
} from '@astro/core/arxiv'

// Server-side operations (I/O)
export {
  fetchArxivMetadata,
  fetchArxivPaper,
  formatPaperSummary,
  formatDownloadReport,
} from './arxiv-client.js'

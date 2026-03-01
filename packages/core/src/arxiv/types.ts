/**
 * arXiv Paper Fetcher — Type definitions
 *
 * Pure type definitions for arXiv paper metadata, download results,
 * and configuration options.
 */

// ────────────────────────────────────────────────────────────────────────────
// Paper Metadata
// ────────────────────────────────────────────────────────────────────────────

/** Parsed arXiv paper identifier */
export interface ArxivPaperId {
  /** The raw ID string, e.g. "2301.07041" or "cs/0601078" */
  id: string
  /** Version number if specified (e.g., 2 from "2301.07041v2"), null if unspecified */
  version: number | null
  /** The base ID without version, e.g. "2301.07041" */
  baseId: string
}

/** Author of an arXiv paper */
export interface ArxivAuthor {
  name: string
  affiliation?: string
}

/** arXiv paper category/subject */
export interface ArxivCategory {
  /** Primary category (e.g., "cs.AI") */
  term: string
  /** Whether this is the primary category */
  isPrimary: boolean
}

/** Link associated with an arXiv paper */
export interface ArxivLink {
  href: string
  rel?: string
  type?: string
  title?: string
}

/** Complete metadata for an arXiv paper */
export interface ArxivPaperMetadata {
  /** arXiv paper ID (e.g., "2301.07041v2") */
  id: string
  /** Base ID without version */
  baseId: string
  /** Version number */
  version: number
  /** Paper title */
  title: string
  /** Paper abstract */
  abstract: string
  /** List of authors */
  authors: ArxivAuthor[]
  /** Categories/subjects */
  categories: ArxivCategory[]
  /** Primary category */
  primaryCategory: string
  /** Publication date (first submitted) */
  published: string
  /** Last updated date */
  updated: string
  /** DOI if available */
  doi?: string
  /** Journal reference if available */
  journalRef?: string
  /** Comment field (page count, figures, etc.) */
  comment?: string
  /** Links (abs, pdf, doi) */
  links: ArxivLink[]
  /** Direct URL to abstract page */
  abstractUrl: string
  /** Direct URL to PDF */
  pdfUrl: string
}

// ────────────────────────────────────────────────────────────────────────────
// Download & Extraction Results
// ────────────────────────────────────────────────────────────────────────────

/** Type of source downloaded */
export type ArxivSourceType = 'latex' | 'pdf' | 'html'

/** Result of downloading paper source */
export interface ArxivDownloadResult {
  /** Paper metadata */
  metadata: ArxivPaperMetadata
  /** Type of source that was downloaded */
  sourceType: ArxivSourceType
  /** Path to the downloaded/extracted source directory */
  sourcePath: string
  /** Path to the PDF file (either downloaded or found in source) */
  pdfPath?: string
  /** List of extracted figure paths */
  figures: ArxivFigure[]
  /** Main .tex file path (if LaTeX source) */
  mainTexFile?: string
  /** All .tex file paths */
  texFiles: string[]
  /** Raw text content of the paper (extracted from LaTeX or PDF) */
  textContent?: string
}

/** An extracted figure from a paper */
export interface ArxivFigure {
  /** Path to the figure file */
  path: string
  /** Original filename */
  filename: string
  /** Figure label from LaTeX (e.g., "fig:overview") */
  label?: string
  /** Caption text from LaTeX */
  caption?: string
  /** File format (png, jpg, pdf, eps, svg) */
  format: string
  /** The \includegraphics path as written in LaTeX */
  texReference?: string
}

/** LaTeX figure reference found during parsing */
export interface LatexFigureRef {
  /** The path as written in \includegraphics */
  includePath: string
  /** Caption text if found */
  caption?: string
  /** Label if found */
  label?: string
  /** Options passed to \includegraphics (e.g., "width=0.5\textwidth") */
  options?: string
}

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

/** Options for fetching an arXiv paper */
export interface ArxivFetchOptions {
  /** Output directory for downloaded files (default: temp directory) */
  outputDir?: string
  /** Whether to download LaTeX source (default: true) */
  downloadSource?: boolean
  /** Whether to download PDF (default: true, always tries if no source) */
  downloadPdf?: boolean
  /** Whether to extract figures from LaTeX (default: true) */
  extractFigures?: boolean
  /** Whether to extract text content from LaTeX (default: true) */
  extractText?: boolean
  /** Timeout in milliseconds for HTTP requests (default: 30000) */
  timeout?: number
  /** Maximum file size to download in bytes (default: 50MB) */
  maxFileSize?: number
}

/** Default fetch options */
export const DEFAULT_FETCH_OPTIONS: Required<ArxivFetchOptions> = {
  outputDir: '',
  downloadSource: true,
  downloadPdf: true,
  extractFigures: true,
  extractText: true,
  timeout: 30000,
  maxFileSize: 50 * 1024 * 1024, // 50 MB
}

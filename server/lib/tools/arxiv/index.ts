/**
 * arXiv Paper Fetcher Tool
 *
 * A comprehensive tool for fetching and processing arXiv papers.
 *
 * Features:
 * - Parse arXiv URLs and paper IDs
 * - Fetch paper metadata (title, authors, abstract)
 * - Download LaTeX source tarballs
 * - Fallback to PDF if source unavailable
 * - Extract and organize figures from source
 *
 * Usage as library:
 * ```typescript
 * import { fetchArxivMetadata, downloadAndExtractSource, extractFigures } from './arxiv'
 *
 * const metadata = await fetchArxivMetadata('2401.12345')
 * const { extractedDir, extractedFiles } = await downloadAndExtractSource('2401.12345')
 * const figures = await extractFigures(extractedDir)
 * ```
 */

// Parser exports
export {
  parseArxivId,
  normalizeArxivId,
  getArxivUrls,
  isValidArxivInput,
  type ParsedArxivId,
} from './parser.js'

// API exports
export {
  fetchArxivMetadata,
  searchArxiv,
  hasLatexSource,
  type ArxivAuthor,
  type ArxivCategory,
  type ArxivLink,
  type ArxivPaperMetadata,
} from './api.js'

// Downloader exports
export {
  downloadArxivPaper,
  downloadArxivPdf,
  downloadArxivSource,
  downloadAndExtractSource,
  extractTarball,
  type DownloadResult,
  type DownloadOptions,
} from './downloader.js'

// Figure extraction exports
export {
  parseFigureReferences,
  extractFigures,
  summarizeFigures,
  type FigureReference,
  type ExtractedFigure,
  type FigureExtractionResult,
} from './figures.js'

/**
 * High-level function to fetch a paper and all its resources
 */
export async function fetchArxivPaper(
  paperIdOrUrl: string,
  options: {
    outputDir?: string
    extractFigures?: boolean
  } = {}
) {
  const { fetchArxivMetadata } = await import('./api.js')
  const { downloadAndExtractSource, downloadArxivPdf } = await import('./downloader.js')
  const { extractFigures: extractFiguresFromDir, summarizeFigures } = await import('./figures.js')

  const { outputDir = '.', extractFigures: shouldExtractFigures = true } = options

  // Fetch metadata
  const metadata = await fetchArxivMetadata(paperIdOrUrl)
  if (!metadata) {
    throw new Error(`Paper not found: ${paperIdOrUrl}`)
  }

  // Try to download source
  let downloadResult
  let extractedDir: string | undefined
  let extractedFiles: string[] = []
  let figuresResult

  try {
    const result = await downloadAndExtractSource(paperIdOrUrl, { outputDir })
    downloadResult = result.download
    extractedDir = result.extractedDir
    extractedFiles = result.extractedFiles

    // Extract figures if requested
    if (shouldExtractFigures && extractedDir) {
      const figuresOutputDir = `${extractedDir}/figures_extracted`
      figuresResult = await extractFiguresFromDir(extractedDir, {
        outputDir: figuresOutputDir,
        organize: true,
      })
    }
  } catch {
    // Fallback to PDF
    downloadResult = await downloadArxivPdf(paperIdOrUrl, { outputDir })
  }

  return {
    metadata,
    download: downloadResult,
    extractedDir,
    extractedFiles,
    figures: figuresResult,
    figuresSummary: figuresResult ? summarizeFigures(figuresResult) : undefined,
  }
}

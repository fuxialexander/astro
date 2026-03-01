/**
 * arXiv Paper Fetcher — API Client & Downloader
 *
 * Handles HTTP communication with arXiv APIs:
 * - Fetching paper metadata via Atom API
 * - Downloading LaTeX source tarballs
 * - Downloading PDFs as fallback
 * - Extracting and organizing figures from LaTeX source
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join, resolve } from 'path'
import { tmpdir } from 'os'

import {
  parseArxivId,
  buildMetadataUrl,
  buildSourceUrl,
  buildPdfUrl,
  parseArxivAtomResponse,
  parseLatexFigures,
  extractLatexText,
  DEFAULT_FETCH_OPTIONS,
} from '@astro/core/arxiv'

import type {
  ArxivPaperId,
  ArxivPaperMetadata,
  ArxivDownloadResult,
  ArxivFigure,
  ArxivFetchOptions,
  ArxivSourceType,
} from '@astro/core/arxiv'

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/** Image file extensions we recognize as figures */
const FIGURE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf', '.eps', '.tif', '.tiff', '.bmp'])

/** Maximum number of retries for arXiv API requests (they rate-limit aggressively) */
const MAX_RETRIES = 3

/** Delay between retries in ms */
const RETRY_DELAY_MS = 3000

// ────────────────────────────────────────────────────────────────────────────
// Main API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fetch metadata for an arXiv paper.
 *
 * @param input - arXiv URL or paper ID (e.g., "2301.07041", "https://arxiv.org/abs/2301.07041v2")
 * @returns Parsed paper metadata
 * @throws Error if the paper is not found or the API is unavailable
 */
export async function fetchArxivMetadata(input: string): Promise<ArxivPaperMetadata> {
  const paperId = parseArxivId(input)
  const url = buildMetadataUrl(paperId)

  const xml = await fetchWithRetry(url, 'text/xml')
  return parseArxivAtomResponse(xml)
}

/**
 * Fetch an arXiv paper: metadata, source/PDF download, and figure extraction.
 *
 * This is the main entry point for the arXiv fetcher. It:
 * 1. Fetches paper metadata from the arXiv API
 * 2. Attempts to download LaTeX source (tar.gz)
 * 3. Falls back to PDF if no LaTeX source is available
 * 4. Extracts and catalogs figures from LaTeX source
 * 5. Optionally extracts text content from LaTeX
 *
 * @param input - arXiv URL or paper ID
 * @param options - Fetch options (output directory, what to download, etc.)
 * @returns Complete download result with paths and metadata
 */
export async function fetchArxivPaper(
  input: string,
  options: ArxivFetchOptions = {}
): Promise<ArxivDownloadResult> {
  const opts = { ...DEFAULT_FETCH_OPTIONS, ...options }
  const paperId = parseArxivId(input)

  // 1. Fetch metadata
  const metadata = await fetchArxivMetadata(input)

  // 2. Set up output directory
  const outputDir = opts.outputDir || join(tmpdir(), `arxiv-${paperId.baseId.replace('/', '-')}`)
  mkdirSync(outputDir, { recursive: true })

  // Write metadata to JSON for reference
  writeFileSync(
    join(outputDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf-8'
  )

  let sourceType: ArxivSourceType = 'pdf'
  let sourcePath = outputDir
  let pdfPath: string | undefined
  let mainTexFile: string | undefined
  let texFiles: string[] = []
  let figures: ArxivFigure[] = []
  let textContent: string | undefined

  // 3. Try to download LaTeX source
  if (opts.downloadSource) {
    try {
      const sourceResult = await downloadAndExtractSource(paperId, outputDir, opts.timeout)
      sourceType = 'latex'
      sourcePath = sourceResult.extractDir

      // Find .tex files
      texFiles = findFilesByExtension(sourcePath, '.tex')

      // Find main .tex file
      mainTexFile = findMainTexFile(texFiles, sourcePath)

      // 4. Extract figures
      if (opts.extractFigures && mainTexFile) {
        figures = extractFigures(texFiles, sourcePath)
      }

      // 5. Extract text content
      if (opts.extractText && mainTexFile) {
        const mainContent = readFileSync(mainTexFile, 'utf-8')
        textContent = extractLatexText(mainContent)
      }
    } catch (err) {
      // Source download failed — fall through to PDF
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`LaTeX source download failed (${message}), falling back to PDF`)
    }
  }

  // 4. Download PDF if needed
  if (opts.downloadPdf && (sourceType !== 'latex' || !pdfPath)) {
    try {
      pdfPath = await downloadPdf(paperId, outputDir, opts.timeout)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`PDF download failed: ${message}`)
    }
  }

  return {
    metadata,
    sourceType,
    sourcePath,
    pdfPath,
    figures,
    mainTexFile,
    texFiles,
    textContent,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// HTTP Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a URL with retry logic for arXiv's rate limiting.
 */
async function fetchWithRetry(url: string, accept: string, timeoutMs = 30000): Promise<string> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      const response = await fetch(url, {
        headers: {
          'Accept': accept,
          'User-Agent': 'Astro/1.0 (arXiv paper fetcher; https://github.com/fuxialexander/astro)',
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (response.status === 429) {
        // Rate limited — wait and retry
        const retryAfter = response.headers.get('retry-after')
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : RETRY_DELAY_MS * (attempt + 1)
        await sleep(waitMs)
        continue
      }

      if (!response.ok) {
        throw new Error(`arXiv API returned HTTP ${response.status}: ${response.statusText}`)
      }

      return await response.text()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (lastError.name === 'AbortError') {
        throw new Error(`arXiv API request timed out after ${timeoutMs}ms`)
      }
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * (attempt + 1))
      }
    }
  }

  throw lastError || new Error('arXiv API request failed after retries')
}

/**
 * Fetch binary data from a URL.
 */
async function fetchBinary(url: string, timeoutMs = 30000): Promise<Buffer> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Astro/1.0 (arXiv paper fetcher; https://github.com/fuxialexander/astro)',
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : RETRY_DELAY_MS * (attempt + 1)
        await sleep(waitMs)
        continue
      }

      if (!response.ok) {
        throw new Error(`Download failed with HTTP ${response.status}: ${response.statusText}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      return Buffer.from(arrayBuffer)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (lastError.name === 'AbortError') {
        throw new Error(`Download timed out after ${timeoutMs}ms`)
      }
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * (attempt + 1))
      }
    }
  }

  throw lastError || new Error('Download failed after retries')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ────────────────────────────────────────────────────────────────────────────
// Source Download & Extraction
// ────────────────────────────────────────────────────────────────────────────

interface SourceDownloadResult {
  /** Directory where source was extracted */
  extractDir: string
  /** Content-Type of the downloaded file */
  contentType: string
}

/**
 * Download and extract LaTeX source tarball from arXiv.
 *
 * arXiv's e-print endpoint returns:
 * - tar.gz for multi-file submissions (most common)
 * - Single .tex file for single-file submissions
 * - PDF if only PDF is available (rare, we treat as error here)
 */
async function downloadAndExtractSource(
  paperId: ArxivPaperId,
  outputDir: string,
  timeoutMs: number
): Promise<SourceDownloadResult> {
  const sourceUrl = buildSourceUrl(paperId)
  const extractDir = join(outputDir, 'source')
  mkdirSync(extractDir, { recursive: true })

  // Download the source file
  const data = await fetchBinary(sourceUrl, timeoutMs)

  if (data.length === 0) {
    throw new Error('Empty response from arXiv e-print endpoint')
  }

  // Detect file type by magic bytes
  const contentType = detectContentType(data)

  if (contentType === 'application/gzip' || contentType === 'application/x-tar') {
    // tar.gz or tar — extract with system tar
    const tarballPath = join(outputDir, 'source.tar.gz')
    writeFileSync(tarballPath, data)

    try {
      execSync(`tar xzf "${tarballPath}" -C "${extractDir}"`, {
        timeout: 30000,
        stdio: 'pipe',
      })
    } catch {
      // Maybe it's just gzipped, not tar
      try {
        execSync(`gunzip -c "${tarballPath}" > "${join(extractDir, 'paper.tex')}"`, {
          timeout: 30000,
          stdio: 'pipe',
        })
      } catch {
        throw new Error('Failed to extract arXiv source archive')
      }
    }
  } else if (contentType === 'application/pdf') {
    // Only PDF available, no LaTeX source
    throw new Error('arXiv returned PDF instead of LaTeX source — no LaTeX available for this paper')
  } else {
    // Likely a single .tex file (uncompressed)
    const texPath = join(extractDir, 'paper.tex')
    writeFileSync(texPath, data)
  }

  return { extractDir, contentType }
}

/**
 * Download the PDF of a paper.
 */
async function downloadPdf(
  paperId: ArxivPaperId,
  outputDir: string,
  timeoutMs: number
): Promise<string> {
  const pdfUrl = buildPdfUrl(paperId)
  const data = await fetchBinary(pdfUrl, timeoutMs)

  if (data.length === 0) {
    throw new Error('Empty response from arXiv PDF endpoint')
  }

  const safeId = paperId.baseId.replace('/', '-')
  const pdfPath = join(outputDir, `${safeId}.pdf`)
  writeFileSync(pdfPath, data)

  return pdfPath
}

/**
 * Detect content type by magic bytes.
 */
function detectContentType(data: Buffer): string {
  // gzip: 1f 8b
  if (data[0] === 0x1f && data[1] === 0x8b) {
    return 'application/gzip'
  }
  // PDF: %PDF
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
    return 'application/pdf'
  }
  // tar: "ustar" at offset 257
  if (data.length > 262 && data.toString('ascii', 257, 262) === 'ustar') {
    return 'application/x-tar'
  }
  // Default: assume text (single .tex file)
  return 'text/plain'
}

// ────────────────────────────────────────────────────────────────────────────
// File Discovery
// ────────────────────────────────────────────────────────────────────────────

/**
 * Recursively find files with a given extension in a directory.
 */
function findFilesByExtension(dir: string, ext: string): string[] {
  const results: string[] = []

  if (!existsSync(dir)) return results

  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findFilesByExtension(fullPath, ext))
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(fullPath)
    }
  }

  return results
}

/**
 * Find the main .tex file in a LaTeX project.
 *
 * Heuristics (in priority order):
 * 1. File containing \documentclass
 * 2. File named main.tex, paper.tex, or manuscript.tex
 * 3. The largest .tex file
 */
function findMainTexFile(texFiles: string[], sourceDir: string): string | undefined {
  if (texFiles.length === 0) return undefined
  if (texFiles.length === 1) return texFiles[0]

  // 1. Look for \documentclass
  for (const file of texFiles) {
    try {
      const content = readFileSync(file, 'utf-8')
      if (/\\documentclass/i.test(content)) {
        return file
      }
    } catch {
      // Skip unreadable files
    }
  }

  // 2. Common main file names
  const commonNames = ['main.tex', 'paper.tex', 'manuscript.tex', 'article.tex']
  for (const name of commonNames) {
    const match = texFiles.find((f) => basename(f).toLowerCase() === name)
    if (match) return match
  }

  // 3. Prefer files in the root directory, then largest
  const rootFiles = texFiles.filter((f) => dirname(f) === sourceDir)
  if (rootFiles.length > 0) {
    // Sort by file size descending
    rootFiles.sort((a, b) => {
      try {
        return statSync(b).size - statSync(a).size
      } catch {
        return 0
      }
    })
    return rootFiles[0]
  }

  // Fallback: largest file
  texFiles.sort((a, b) => {
    try {
      return statSync(b).size - statSync(a).size
    } catch {
      return 0
    }
  })
  return texFiles[0]
}

// ────────────────────────────────────────────────────────────────────────────
// Figure Extraction
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract figures from LaTeX source by:
 * 1. Parsing \includegraphics references from all .tex files
 * 2. Resolving file paths to actual image files
 * 3. Cataloging standalone image files in the source tree
 */
function extractFigures(texFiles: string[], sourceDir: string): ArxivFigure[] {
  const figures: ArxivFigure[] = []
  const seen = new Set<string>()

  // 1. Parse \includegraphics references from .tex files
  for (const texFile of texFiles) {
    try {
      const content = readFileSync(texFile, 'utf-8')
      const refs = parseLatexFigures(content)

      for (const ref of refs) {
        const resolvedPath = resolveImagePath(ref.includePath, dirname(texFile), sourceDir)
        if (resolvedPath && !seen.has(resolvedPath)) {
          seen.add(resolvedPath)
          figures.push({
            path: resolvedPath,
            filename: basename(resolvedPath),
            label: ref.label,
            caption: ref.caption,
            format: extname(resolvedPath).slice(1).toLowerCase(),
            texReference: ref.includePath,
          })
        }
      }
    } catch {
      // Skip unreadable .tex files
    }
  }

  // 2. Find additional image files not referenced in LaTeX
  const allImages = findAllImages(sourceDir)
  for (const imagePath of allImages) {
    if (!seen.has(imagePath)) {
      seen.add(imagePath)
      figures.push({
        path: imagePath,
        filename: basename(imagePath),
        format: extname(imagePath).slice(1).toLowerCase(),
      })
    }
  }

  return figures
}

/**
 * Resolve an \includegraphics path to an actual file.
 *
 * LaTeX often omits file extensions in \includegraphics; we try common
 * extensions. Also handles relative paths from the .tex file's directory.
 */
function resolveImagePath(
  includePath: string,
  texDir: string,
  sourceDir: string
): string | undefined {
  // Normalize the path (remove leading ./)
  const cleanPath = includePath.replace(/^\.\//, '')

  // Directories to search (tex file's dir, then source root)
  const searchDirs = [texDir]
  if (texDir !== sourceDir) {
    searchDirs.push(sourceDir)
  }

  // Extensions to try (including empty for when extension is already present)
  const extensions = ['', '.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg', '.gif', '.tif', '.tiff', '.bmp']

  for (const dir of searchDirs) {
    for (const ext of extensions) {
      const candidate = resolve(dir, cleanPath + ext)
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate
      }
    }
  }

  return undefined
}

/**
 * Recursively find all image files in a directory.
 */
function findAllImages(dir: string): string[] {
  const results: string[] = []

  if (!existsSync(dir)) return results

  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findAllImages(fullPath))
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase()
      if (FIGURE_EXTENSIONS.has(ext)) {
        results.push(fullPath)
      }
    }
  }

  return results
}

// ────────────────────────────────────────────────────────────────────────────
// Formatting
// ────────────────────────────────────────────────────────────────────────────

/**
 * Format paper metadata as a human-readable summary.
 */
export function formatPaperSummary(metadata: ArxivPaperMetadata): string {
  const authors = metadata.authors.map((a) => a.name).join(', ')
  const categories = metadata.categories.map((c) => c.term).join(', ')

  let summary = `# ${metadata.title}\n\n`
  summary += `**Authors:** ${authors}\n`
  summary += `**arXiv ID:** ${metadata.id}\n`
  summary += `**Categories:** ${categories}\n`
  summary += `**Published:** ${metadata.published}\n`

  if (metadata.doi) {
    summary += `**DOI:** ${metadata.doi}\n`
  }
  if (metadata.journalRef) {
    summary += `**Journal:** ${metadata.journalRef}\n`
  }
  if (metadata.comment) {
    summary += `**Comment:** ${metadata.comment}\n`
  }

  summary += `\n**Abstract:**\n${metadata.abstract}\n`
  summary += `\n**Links:**\n`
  summary += `- Abstract: ${metadata.abstractUrl}\n`
  summary += `- PDF: ${metadata.pdfUrl}\n`

  return summary
}

/**
 * Format a complete download result as a human-readable report.
 */
export function formatDownloadReport(result: ArxivDownloadResult): string {
  let report = formatPaperSummary(result.metadata)

  report += `\n---\n\n## Download Details\n\n`
  report += `- **Source type:** ${result.sourceType}\n`
  report += `- **Source path:** ${result.sourcePath}\n`

  if (result.pdfPath) {
    report += `- **PDF path:** ${result.pdfPath}\n`
  }
  if (result.mainTexFile) {
    report += `- **Main TeX file:** ${result.mainTexFile}\n`
  }
  if (result.texFiles.length > 0) {
    report += `- **TeX files:** ${result.texFiles.length}\n`
  }

  if (result.figures.length > 0) {
    report += `\n## Figures (${result.figures.length})\n\n`
    for (const fig of result.figures) {
      report += `- **${fig.filename}** (${fig.format})`
      if (fig.label) report += ` [${fig.label}]`
      if (fig.caption) report += `\n  Caption: ${fig.caption.substring(0, 200)}`
      report += '\n'
    }
  }

  return report
}

/**
 * arXiv Paper Downloader
 *
 * Downloads LaTeX source tarballs and PDFs from arXiv.
 * Supports automatic fallback to PDF if source is not available.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import * as zlib from 'zlib'
import { parseArxivId, getArxivUrls } from './parser.js'
import { fetchArxivMetadata, type ArxivPaperMetadata } from './api.js'

export interface DownloadResult {
  /** Type of download (source or pdf) */
  type: 'source' | 'pdf'
  /** Path to the downloaded file */
  filePath: string
  /** Size in bytes */
  size: number
  /** Paper metadata */
  metadata: ArxivPaperMetadata
  /** Whether this was a fallback (source not available) */
  isFallback: boolean
}

export interface DownloadOptions {
  /** Output directory (default: current directory) */
  outputDir?: string
  /** Prefer PDF even if source is available */
  preferPdf?: boolean
  /** Custom filename (without extension) */
  filename?: string
  /** Timeout in milliseconds */
  timeout?: number
}

/**
 * Create a sanitized filename from paper metadata
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .substring(0, 100) // Limit length
}

/**
 * Download a file from URL to a local path
 */
async function downloadFile(
  url: string,
  destPath: string,
  timeout: number = 60000
): Promise<number> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Astro-arXiv-Tool/1.0 (https://github.com/astro-platform)',
      },
    })

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`)
    }

    const body = response.body
    if (!body) {
      throw new Error('Response body is null')
    }

    // Create write stream
    const fileStream = createWriteStream(destPath)

    // Convert web stream to node stream and pipe
    const nodeStream = Readable.fromWeb(body as import('stream/web').ReadableStream<Uint8Array>)
    await pipeline(nodeStream, fileStream)

    // Get file size
    const stats = await fs.stat(destPath)
    return stats.size
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Check if arXiv source is available for a paper
 */
async function checkSourceAvailability(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Astro-arXiv-Tool/1.0',
      },
    })

    if (!response.ok) return false

    // Check content type - source is usually gzip/tar
    const contentType = response.headers.get('content-type') || ''
    // If it's PDF, source is not available
    if (contentType.includes('application/pdf')) {
      return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * Download an arXiv paper (source or PDF)
 *
 * @param paperIdOrUrl - arXiv paper ID or URL
 * @param options - Download options
 * @returns Download result
 */
export async function downloadArxivPaper(
  paperIdOrUrl: string,
  options: DownloadOptions = {}
): Promise<DownloadResult> {
  const { outputDir = '.', preferPdf = false, filename, timeout = 120000 } = options

  // Parse and validate paper ID
  const parsed = parseArxivId(paperIdOrUrl)
  if (!parsed) {
    throw new Error(`Invalid arXiv ID or URL: ${paperIdOrUrl}`)
  }

  // Fetch metadata
  const metadata = await fetchArxivMetadata(parsed.paperId)
  if (!metadata) {
    throw new Error(`Paper not found: ${parsed.paperId}`)
  }

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true })

  // Generate filename
  const baseName = filename || sanitizeFilename(`${parsed.paperId}_${metadata.title}`)
  const urls = getArxivUrls(parsed.paperId, parsed.version)

  // Try to download source first (unless preferPdf is set)
  let isFallback = false
  let downloadType: 'source' | 'pdf' = 'source'
  let downloadUrl = urls.source
  let extension = '.tar.gz'

  if (preferPdf) {
    downloadType = 'pdf'
    downloadUrl = urls.pdf
    extension = '.pdf'
  } else {
    // Check if source is available
    const sourceAvailable = await checkSourceAvailability(urls.source)
    if (!sourceAvailable) {
      downloadType = 'pdf'
      downloadUrl = urls.pdf
      extension = '.pdf'
      isFallback = true
    }
  }

  const filePath = path.join(outputDir, `${baseName}${extension}`)

  // Download the file
  const size = await downloadFile(downloadUrl, filePath, timeout)

  return {
    type: downloadType,
    filePath,
    size,
    metadata,
    isFallback,
  }
}

/**
 * Download only the PDF of an arXiv paper
 */
export async function downloadArxivPdf(
  paperIdOrUrl: string,
  options: Omit<DownloadOptions, 'preferPdf'> = {}
): Promise<DownloadResult> {
  return downloadArxivPaper(paperIdOrUrl, { ...options, preferPdf: true })
}

/**
 * Download the LaTeX source of an arXiv paper
 * Throws if source is not available
 */
export async function downloadArxivSource(
  paperIdOrUrl: string,
  options: Omit<DownloadOptions, 'preferPdf'> = {}
): Promise<DownloadResult> {
  const parsed = parseArxivId(paperIdOrUrl)
  if (!parsed) {
    throw new Error(`Invalid arXiv ID or URL: ${paperIdOrUrl}`)
  }

  const urls = getArxivUrls(parsed.paperId, parsed.version)

  // Check if source is available
  const sourceAvailable = await checkSourceAvailability(urls.source)
  if (!sourceAvailable) {
    throw new Error(`LaTeX source not available for ${parsed.paperId}. Try downloadArxivPaper() for automatic PDF fallback.`)
  }

  const result = await downloadArxivPaper(paperIdOrUrl, options)
  return result
}

/**
 * Extract a gzipped tarball
 * @param tarPath - Path to the .tar.gz file
 * @param destDir - Destination directory
 * @returns List of extracted file paths
 */
export async function extractTarball(tarPath: string, destDir: string): Promise<string[]> {
  // Read the gzipped file
  const compressedData = await fs.readFile(tarPath)

  // Decompress
  const decompressedData = await new Promise<Buffer>((resolve, reject) => {
    zlib.gunzip(compressedData, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
  })

  // Parse tar format (simplified - handles most arXiv tarballs)
  const extractedFiles: string[] = []
  let offset = 0

  await fs.mkdir(destDir, { recursive: true })

  while (offset < decompressedData.length) {
    // TAR header is 512 bytes
    const header = decompressedData.subarray(offset, offset + 512)

    // Check for end of archive (two empty 512-byte blocks)
    if (header.every((b) => b === 0)) {
      break
    }

    // Extract filename (first 100 bytes, null-terminated)
    const filenameBytes = header.subarray(0, 100)
    const nullIndex = filenameBytes.indexOf(0)
    const filename = filenameBytes.subarray(0, nullIndex > 0 ? nullIndex : 100).toString('utf8')

    if (!filename) {
      break
    }

    // Extract file size (octal, bytes 124-135)
    const sizeStr = header.subarray(124, 136).toString('utf8').trim()
    const size = parseInt(sizeStr, 8) || 0

    // Extract file type (byte 156)
    const fileType = header[156]

    offset += 512

    // File content follows header
    if (size > 0 && (fileType === 0 || fileType === 48 || fileType === 0x30)) {
      // Regular file
      const content = decompressedData.subarray(offset, offset + size)

      // Create directory structure if needed
      const filePath = path.join(destDir, filename)
      const fileDir = path.dirname(filePath)
      await fs.mkdir(fileDir, { recursive: true })

      await fs.writeFile(filePath, content)
      extractedFiles.push(filePath)
    }

    // Move to next file (size rounded up to 512-byte boundary)
    offset += Math.ceil(size / 512) * 512
  }

  return extractedFiles
}

/**
 * Download and extract arXiv source
 * @param paperIdOrUrl - arXiv paper ID or URL
 * @param options - Download options
 * @returns Object with download result and extracted files
 */
export async function downloadAndExtractSource(
  paperIdOrUrl: string,
  options: DownloadOptions = {}
): Promise<{
  download: DownloadResult
  extractedDir: string
  extractedFiles: string[]
}> {
  const result = await downloadArxivPaper(paperIdOrUrl, options)

  if (result.type !== 'source') {
    throw new Error(
      `Cannot extract: downloaded file is PDF, not source. Paper ${result.metadata.id} may not have LaTeX source available.`
    )
  }

  // Extract the tarball
  const extractedDir = result.filePath.replace(/\.tar\.gz$/, '')
  const extractedFiles = await extractTarball(result.filePath, extractedDir)

  return {
    download: result,
    extractedDir,
    extractedFiles,
  }
}

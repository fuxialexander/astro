/**
 * PDF download manager — bridges between web and Tauri desktop modes.
 *
 * Tauri mode: Uses Rust `download_pdf` command for local filesystem storage.
 * Web mode: Stores PDF URL only, displays in-browser via iframe.
 */

import type { Reference, PdfDownloadStatus } from '@/types'
import { isTauri } from '@/lib/skill-provider'
import { autoResolvePdf } from '@/lib/pdf-resolver'

// ── Types ────────────────────────────────────────────────────────────

export interface PdfDownloadProgress {
  referenceId: string
  status: PdfDownloadStatus
  error?: string
  pdfUrl?: string
  pdfPath?: string
}

interface TauriPdfResult {
  path: string
  size: number
  source_url: string
}

// ── Tauri IPC wrappers ───────────────────────────────────────────────
//
// @tauri-apps/api is an optional dependency — only present in the Tauri
// desktop build. We use dynamic import() and cast to avoid type errors
// in the web-only build.

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

async function getTauriInvoke(): Promise<TauriInvoke> {
  // Dynamic import with variable path to avoid TS module resolution on web builds
  const modulePath = '@tauri-apps/api/core'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(/* @vite-ignore */ modulePath)
  return mod.invoke as TauriInvoke
}

async function tauriDownloadPdf(url: string, destPath: string): Promise<TauriPdfResult> {
  if (!isTauri()) throw new Error('download_pdf is only available in Tauri desktop mode')
  const invoke = await getTauriInvoke()
  return invoke<TauriPdfResult>('download_pdf', { url, destPath })
}

async function tauriGetReferencesDir(): Promise<string> {
  if (!isTauri()) throw new Error('get_references_dir is only available in Tauri desktop mode')
  const invoke = await getTauriInvoke()
  return invoke<string>('get_references_dir')
}

async function tauriListDownloadedPdfs(): Promise<TauriPdfResult[]> {
  if (!isTauri()) throw new Error('list_downloaded_pdfs is only available in Tauri desktop mode')
  const invoke = await getTauriInvoke()
  return invoke<TauriPdfResult[]>('list_downloaded_pdfs')
}

async function tauriDeletePdf(path: string): Promise<void> {
  if (!isTauri()) throw new Error('delete_downloaded_pdf is only available in Tauri desktop mode')
  const invoke = await getTauriInvoke()
  return invoke<void>('delete_downloaded_pdf', { path })
}

// ── PDF Download Manager ─────────────────────────────────────────────

/**
 * Download a PDF for a reference.
 *
 * In Tauri mode: downloads to ~/.astro/references/pdfs/ and returns the local path.
 * In web mode: resolves the PDF URL and returns it for in-browser display.
 *
 * @param reference - The reference to download a PDF for
 * @param onProgress - Optional callback for download progress updates
 * @returns Updated reference with pdfUrl/pdfPath populated
 */
export async function downloadPdfForReference(
  reference: Reference,
  onProgress?: (progress: PdfDownloadProgress) => void,
  zoteroConfig?: { libraryType: 'users' | 'groups'; libraryId: string; apiKey: string },
): Promise<Partial<Reference>> {
  const progress = (status: PdfDownloadStatus, extra?: Partial<PdfDownloadProgress>) => {
    onProgress?.({ referenceId: reference.id, status, ...extra })
  }

  // Step 1: Resolve PDF URL if not already known
  let pdfUrl = reference.pdfUrl
  if (!pdfUrl) {
    progress('resolving')
    const resolved = await autoResolvePdf(reference, zoteroConfig)
    pdfUrl = resolved.pdfUrl ?? undefined

    if (!pdfUrl) {
      progress('error', { error: 'No open-access PDF found for this reference' })
      return {
        isOpenAccess: resolved.isOpenAccess,
        oaSource: resolved.oaSource ?? undefined,
      }
    }

    // Return early updates for OA metadata
    const updates: Partial<Reference> = {
      pdfUrl,
      isOpenAccess: resolved.isOpenAccess,
      oaSource: resolved.oaSource ?? undefined,
    }

    // In web mode, we just store the URL — no local download
    if (!isTauri()) {
      progress('complete', { pdfUrl })
      return updates
    }
  }

  // Step 2: In web mode, we're done — just return the URL
  if (!isTauri()) {
    progress('complete', { pdfUrl })
    return { pdfUrl }
  }

  // Step 3: In Tauri mode, download the PDF locally
  progress('downloading')
  try {
    // Build a meaningful filename: "AuthorYear_Title.pdf"
    const firstAuthor = reference.authors?.[0]?.split(' ').pop() ?? 'Unknown'
    const year = reference.year ?? 'undated'
    const titleSlug = (reference.title ?? 'paper')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 50)
      .replace(/_+$/, '')
    const filename = `${firstAuthor}${year}_${titleSlug}.pdf`

    const refsDir = await tauriGetReferencesDir()
    const destPath = `${refsDir}/${filename}`

    const result = await tauriDownloadPdf(pdfUrl, destPath)

    progress('complete', { pdfUrl, pdfPath: result.path })
    return {
      pdfUrl,
      pdfPath: result.path,
      pdfDownloaded: true,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    progress('error', { error: errorMsg })
    // Even if download fails, preserve the URL
    return { pdfUrl }
  }
}

/**
 * Open a PDF for viewing.
 *
 * Tauri mode: Opens local file if downloaded, otherwise opens URL in browser.
 * Web mode: Returns the URL for iframe/embed display.
 */
export function getPdfViewUrl(reference: Reference): string | null {
  // Tauri: prefer local path
  if (isTauri() && reference.pdfPath) {
    // Tauri can load local files via asset protocol
    return `asset://localhost/${reference.pdfPath}`
  }

  // Fallback to URL
  return reference.pdfUrl ?? null
}

/**
 * Check if a PDF is available for a reference.
 */
export function isPdfAvailable(reference: Reference): boolean {
  if (isTauri()) {
    return !!reference.pdfPath || !!reference.pdfUrl
  }
  return !!reference.pdfUrl
}

/**
 * List all locally downloaded PDFs (Tauri only).
 */
export async function listLocalPdfs(): Promise<TauriPdfResult[]> {
  if (!isTauri()) return []
  return tauriListDownloadedPdfs()
}

/**
 * Delete a locally downloaded PDF (Tauri only).
 */
export async function deleteLocalPdf(path: string): Promise<void> {
  if (!isTauri()) throw new Error('PDF deletion only available in Tauri mode')
  return tauriDeletePdf(path)
}

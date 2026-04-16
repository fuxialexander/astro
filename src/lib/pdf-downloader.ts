/**
 * PDF download manager — bridges between web and Electron desktop modes.
 *
 * Desktop mode: uses `desktopBridge.pdf.download` (routes to `pdf:download`
 * IPC → main-process fetch → fs write under `app.getPath('userData')`).
 * Web mode: stores the resolved PDF URL only and displays via iframe.
 *
 * Historical note: this module previously called the Tauri `download_pdf`
 * command via `@tauri-apps/api/core`. The Tauri path was removed during the
 * Electron migration — `isDesktop()` now means "running inside the Electron
 * shell", and Tauri builds no longer ship.
 */

import type { Reference, PdfDownloadStatus } from '@/types'
import { isDesktop } from '@/lib/desktop-detect'
import { desktopBridge } from '@/lib/desktop-bridge'
import { autoResolvePdf } from '@/lib/pdf-resolver'

// ── Types ────────────────────────────────────────────────────────────

export interface PdfDownloadProgress {
  referenceId: string
  status: PdfDownloadStatus
  error?: string
  pdfUrl?: string
  pdfPath?: string
}

interface DesktopPdfResult {
  path: string
  size: number
}

/**
 * Download a PDF for a reference.
 *
 * Desktop: downloads to the Electron userData PDFs subdir and returns the path.
 * Web: resolves the PDF URL and returns it for in-browser display.
 */
export async function downloadPdfForReference(
  reference: Reference,
  onProgress?: (progress: PdfDownloadProgress) => void,
  zoteroConfig?: { libraryType: 'users' | 'groups'; libraryId: string; apiKey: string },
): Promise<Partial<Reference>> {
  const progress = (status: PdfDownloadStatus, extra?: Partial<PdfDownloadProgress>) => {
    onProgress?.({ referenceId: reference.id, status, ...extra })
  }

  // Step 1: resolve the PDF URL if not already known.
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

    if (!isDesktop()) {
      progress('complete', { pdfUrl })
      return {
        pdfUrl,
        isOpenAccess: resolved.isOpenAccess,
        oaSource: resolved.oaSource ?? undefined,
      }
    }
  }

  // Step 2: web mode — done.
  if (!isDesktop()) {
    progress('complete', { pdfUrl })
    return { pdfUrl }
  }

  // Step 3: desktop mode — download via the IPC channel.
  progress('downloading')
  try {
    const firstAuthor = reference.authors?.[0]?.split(' ').pop() ?? 'Unknown'
    const year = reference.year ?? 'undated'
    const titleSlug = (reference.title ?? 'paper')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 50)
      .replace(/_+$/, '')
    const filename = `${firstAuthor}${year}_${titleSlug}.pdf`

    const result: DesktopPdfResult = await desktopBridge.pdf
      .download({ url: pdfUrl, filename, subdir: 'pdfs' })
      .then((r) => ({ path: r.path, size: r.bytes }))

    progress('complete', { pdfUrl, pdfPath: result.path })
    return {
      pdfUrl,
      pdfPath: result.path,
      pdfDownloaded: true,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    progress('error', { error: errorMsg })
    return { pdfUrl }
  }
}

/**
 * Open a PDF for viewing.
 *
 * Desktop: prefer the local file path via the `file://` URL; the renderer
 * has webSecurity:true but local files served from `userData` are accessible
 * to `<iframe>` once we wire a custom `astro://` protocol (Phase 5).
 * Web: returns the PDF URL.
 *
 * NOTE: until the `astro://` protocol lands, the local-path branch returns
 * the URL fallback so the iframe still loads something.
 */
export function getPdfViewUrl(reference: Reference): string | null {
  if (isDesktop() && reference.pdfPath) {
    // TODO(phase-5): register an astro:// protocol handler to serve files
    // out of userData. For now, fall through to the URL.
  }
  return reference.pdfUrl ?? null
}

/**
 * Check if a PDF is available for a reference.
 */
export function isPdfAvailable(reference: Reference): boolean {
  if (isDesktop()) {
    return !!reference.pdfPath || !!reference.pdfUrl
  }
  return !!reference.pdfUrl
}

/**
 * List all locally downloaded PDFs. Desktop only. Phase 3A: returns []
 * because there is no `pdf:list` IPC channel yet — gallery views should
 * derive availability from the per-reference `pdfPath` field instead.
 */
export async function listLocalPdfs(): Promise<DesktopPdfResult[]> {
  return []
}

/**
 * Delete a locally downloaded PDF. Desktop only. Phase 3A: not implemented
 * (no `pdf:delete` channel yet). Throws so callers know to upgrade.
 */
export async function deleteLocalPdf(path: string): Promise<void> {
  throw new Error(`deleteLocalPdf is not implemented in the Electron shell yet (path=${path})`)
}

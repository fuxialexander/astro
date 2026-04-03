/**
 * PDF resolution utilities for fetching open-access PDFs.
 *
 * Supports:
 * - Unpaywall API (primary, for DOI-based lookup)
 * - Zotero file attachments (for synced libraries)
 *
 * In Tauri mode: downloads are handled via Rust `download_pdf` command.
 * In web mode: only stores the PDF URL for in-browser viewing.
 */

import type { PdfResolution, Reference } from '@/types'

const UNPAYWALL_EMAIL = 'team@astroanywhere.com'

// ── Unpaywall API ────────────────────────────────────────────────────

/**
 * Resolve a DOI to an open-access PDF URL via the Unpaywall API.
 *
 * @see https://unpaywall.org/products/api
 */
export async function resolveDoiPdf(doi: string): Promise<PdfResolution> {
  const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//, '').trim()
  if (!cleanDoi) {
    return { pdfUrl: null, isOa: false, oaSource: null }
  }

  try {
    const url = `https://api.unpaywall.org/v2/${encodeURIComponent(cleanDoi)}?email=${encodeURIComponent(UNPAYWALL_EMAIL)}`
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    })

    if (!response.ok) {
      return { pdfUrl: null, isOa: false, oaSource: null }
    }

    const data = await response.json()
    const isOa = data.is_oa ?? false

    // Try best_oa_location first, then iterate oa_locations
    const pdfUrl =
      data.best_oa_location?.url_for_pdf ??
      data.oa_locations?.find((loc: { url_for_pdf?: string }) => loc.url_for_pdf)?.url_for_pdf ??
      null

    const oaSource = data.best_oa_location?.host_type ?? null

    return { pdfUrl, isOa, oaSource }
  } catch (err) {
    console.warn('[pdf-resolver] Unpaywall lookup failed:', err)
    return { pdfUrl: null, isOa: false, oaSource: null }
  }
}

// ── Zotero API ───────────────────────────────────────────────────────

/**
 * Fetch PDF attachment URL from a Zotero library.
 * Requires a Zotero API key and user/group library ID.
 */
export async function resolveZoteroPdf(
  zoteroKey: string,
  libraryType: 'users' | 'groups',
  libraryId: string,
  apiKey: string,
): Promise<string | null> {
  try {
    // Get children (attachments) of the Zotero item
    const url = `https://api.zotero.org/${libraryType}/${libraryId}/items/${zoteroKey}/children`
    const response = await fetch(url, {
      headers: {
        'Zotero-API-Key': apiKey,
        'Accept': 'application/json',
      },
    })

    if (!response.ok) return null

    const children = await response.json()

    // Find PDF attachment
    const pdfAttachment = children.find(
      (child: { data?: { contentType?: string; linkMode?: string } }) =>
        child.data?.contentType === 'application/pdf'
    )

    if (!pdfAttachment) return null

    // For linked/imported files, return the file download URL
    if (pdfAttachment.data?.linkMode === 'imported_file' || pdfAttachment.data?.linkMode === 'imported_url') {
      return `https://api.zotero.org/${libraryType}/${libraryId}/items/${pdfAttachment.key}/file`
    }

    // For linked URLs, return the URL directly
    if (pdfAttachment.data?.url) {
      return pdfAttachment.data.url
    }

    return null
  } catch (err) {
    console.warn('[pdf-resolver] Zotero lookup failed:', err)
    return null
  }
}

// ── DOI Metadata ─────────────────────────────────────────────────────

/**
 * Fetch basic metadata for a DOI from CrossRef.
 */
export async function fetchDoiMetadata(doi: string): Promise<Partial<Reference> | null> {
  const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//, '').trim()
  if (!cleanDoi) return null

  try {
    const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Astro/0.1 (mailto:team@astroanywhere.com)',
      },
    })

    if (!response.ok) return null

    const data = await response.json()
    const work = data.message

    const authors = work.author?.map(
      (a: { given?: string; family?: string }) =>
        [a.given, a.family].filter(Boolean).join(' ')
    ) ?? []

    return {
      title: work.title?.[0] ?? '',
      authors,
      year: work['published-print']?.['date-parts']?.[0]?.[0] ??
            work['published-online']?.['date-parts']?.[0]?.[0] ??
            work.created?.['date-parts']?.[0]?.[0],
      journal: work['container-title']?.[0],
      doi: cleanDoi,
      abstract: work.abstract,
      url: work.URL,
      source: 'crossref' as const,
    }
  } catch (err) {
    console.warn('[pdf-resolver] CrossRef lookup failed:', err)
    return null
  }
}

// ── Auto-resolve Pipeline ────────────────────────────────────────────

/**
 * Attempt to auto-resolve a PDF URL for a reference.
 * Tries Unpaywall first, then Zotero if a key is present.
 */
export async function autoResolvePdf(
  reference: Reference,
  zoteroConfig?: { libraryType: 'users' | 'groups'; libraryId: string; apiKey: string },
): Promise<{ pdfUrl: string | null; isOpenAccess: boolean; oaSource: string | null }> {
  // 1. Try Unpaywall if DOI is available
  if (reference.doi) {
    const result = await resolveDoiPdf(reference.doi)
    if (result.pdfUrl) {
      return {
        pdfUrl: result.pdfUrl,
        isOpenAccess: result.isOa,
        oaSource: result.oaSource,
      }
    }
  }

  // 2. Try Zotero if key + config available
  if (reference.zoteroKey && zoteroConfig) {
    const pdfUrl = await resolveZoteroPdf(
      reference.zoteroKey,
      zoteroConfig.libraryType,
      zoteroConfig.libraryId,
      zoteroConfig.apiKey,
    )
    if (pdfUrl) {
      return { pdfUrl, isOpenAccess: false, oaSource: 'zotero' }
    }
  }

  // 3. Check if the reference already has a PDF URL
  if (reference.pdfUrl) {
    return { pdfUrl: reference.pdfUrl, isOpenAccess: reference.isOpenAccess ?? false, oaSource: reference.oaSource ?? null }
  }

  return { pdfUrl: null, isOpenAccess: false, oaSource: null }
}

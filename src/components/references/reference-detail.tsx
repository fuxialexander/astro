/**
 * Reference detail view — shows metadata and provides PDF download/view.
 *
 * Tauri: downloads PDF to local filesystem, shows local viewer.
 * Web: shows PDF URL with in-browser iframe viewer.
 */

import { useState, useCallback, useRef } from 'react'
import {
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Check,
  AlertCircle,
  Trash2,
  BookOpen,
  Calendar,
  User,
  Tag,
  Globe,
  ScanText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Reference, PdfDownloadStatus } from '@/types'
import {
  downloadPdfForReference,
  getPdfViewUrl,
  isPdfAvailable,
  deleteLocalPdf,
  type PdfDownloadProgress,
} from '@/lib/pdf-downloader'
import { isDesktop } from '@/lib/desktop-detect'
import { PdfExtractPanel } from './pdf-extract-panel'

// ── Props ────────────────────────────────────────────────────────────

interface ReferenceDetailProps {
  reference: Reference
  onUpdate?: (updates: Partial<Reference>) => void
  onDelete?: () => void
  className?: string
}

// ── Component ────────────────────────────────────────────────────────

export function ReferenceDetail({
  reference,
  onUpdate,
  onDelete,
  className,
}: ReferenceDetailProps) {
  const [downloadStatus, setDownloadStatus] = useState<PdfDownloadStatus>('idle')
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [showPdf, setShowPdf] = useState(false)
  const [showExtract, setShowExtract] = useState(false)
  const [notesDraft, setNotesDraft] = useState(reference.notes ?? '')
  const notesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleProgress = useCallback((progress: PdfDownloadProgress) => {
    setDownloadStatus(progress.status)
    if (progress.error) setDownloadError(progress.error)
  }, [])

  const handleDownloadPdf = useCallback(async () => {
    setDownloadError(null)
    setDownloadStatus('resolving')

    try {
      const updates = await downloadPdfForReference(reference, handleProgress)
      onUpdate?.(updates)
    } catch (err) {
      setDownloadStatus('error')
      setDownloadError(err instanceof Error ? err.message : 'Download failed')
    }
  }, [reference, onUpdate, handleProgress])

  const handleDeletePdf = useCallback(async () => {
    if (!reference.pdfPath) return
    try {
      await deleteLocalPdf(reference.pdfPath)
      onUpdate?.({ pdfPath: undefined, pdfDownloaded: false })
    } catch (err) {
      console.error('Failed to delete PDF:', err)
    }
  }, [reference.pdfPath, onUpdate])

  const handleNotesChange = useCallback((val: string) => {
    setNotesDraft(val)
    if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current)
    notesDebounceRef.current = setTimeout(() => onUpdate?.({ notes: val }), 600)
  }, [onUpdate])

  const pdfViewUrl = getPdfViewUrl(reference)
  const hasPdf = isPdfAvailable(reference)
  const isDownloading = downloadStatus === 'resolving' || downloadStatus === 'downloading'

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Header */}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-base font-semibold leading-tight">{reference.title}</h3>

        {reference.authors && reference.authors.length > 0 && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <User className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {reference.authors.length <= 3
                ? reference.authors.join(', ')
                : `${reference.authors.slice(0, 3).join(', ')} et al.`}
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {reference.year && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {reference.year}
            </span>
          )}
          {reference.journal && (
            <span className="flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5" />
              {reference.journal}
            </span>
          )}
          {reference.isOpenAccess && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
              <Globe className="h-3 w-3" />
              Open Access
            </span>
          )}
        </div>
      </div>

      {/* Identifiers */}
      <div className="flex flex-wrap gap-2">
        {reference.doi && (
          <a
            href={`https://doi.org/${reference.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-mono hover:bg-muted/80"
          >
            DOI: {reference.doi}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {reference.pmid && (
          <a
            href={`https://pubmed.ncbi.nlm.nih.gov/${reference.pmid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-mono hover:bg-muted/80"
          >
            PMID: {reference.pmid}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {reference.arxivId && (
          <a
            href={`https://arxiv.org/abs/${reference.arxivId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-mono hover:bg-muted/80"
          >
            arXiv: {reference.arxivId}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* Tags */}
      {reference.tags && reference.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {reference.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs"
            >
              <Tag className="h-3 w-3" />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Abstract */}
      {reference.abstract && (
        <div className="text-sm text-muted-foreground leading-relaxed">
          <p className="font-medium text-foreground mb-1">Abstract</p>
          <p className="line-clamp-6">{reference.abstract}</p>
        </div>
      )}

      {/* Notes — editable, included in LLM citation context */}
      <div className="text-sm">
        <p className="font-medium mb-1.5">Notes</p>
        <textarea
          value={notesDraft}
          onChange={e => handleNotesChange(e.target.value)}
          placeholder="Add reading notes, key findings, or relevant excerpts… these will be injected into the prompt when you cite this paper with [@"
          rows={3}
          className="w-full rounded-md border border-input bg-muted/30 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">Included in prompt when cited with <code className="bg-muted px-0.5 rounded">[@{reference.id}]</code></p>
      </div>

      {/* PDF Actions */}
      <div className="flex flex-col gap-2 pt-2 border-t">
        <div className="flex items-center gap-2">
          {/* Download/View PDF Button */}
          {hasPdf ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPdf(!showPdf)}
              className="gap-1.5"
            >
              <FileText className="h-3.5 w-3.5" />
              {showPdf ? 'Hide PDF' : 'View PDF'}
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={handleDownloadPdf}
              disabled={isDownloading}
              className="gap-1.5"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {downloadStatus === 'resolving' ? 'Finding PDF...' : 'Downloading...'}
                </>
              ) : downloadStatus === 'complete' ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Downloaded
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  Download PDF
                </>
              )}
            </Button>
          )}

          {/* Re-download for desktop mode */}
          {isDesktop() && hasPdf && !reference.pdfDownloaded && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownloadPdf}
              disabled={isDownloading}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              Save locally
            </Button>
          )}

          {/* Delete local PDF */}
          {isDesktop() && reference.pdfPath && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDeletePdf}
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}

          {/* Open in browser */}
          {reference.url && (
            <a
              href={reference.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="ghost" size="sm" className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" />
                Open source
              </Button>
            </a>
          )}

          {/* Extract text/figures from PDF — desktop only */}
          {isDesktop() && hasPdf && (
            <Button
              variant={showExtract ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setShowExtract(v => !v)}
              className="gap-1.5"
              title="Extract text and figures from PDF"
            >
              <ScanText className="h-3.5 w-3.5" />
              Extract
            </Button>
          )}

          {/* Remove reference */}
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="gap-1.5 text-destructive hover:text-destructive ml-auto"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          )}
        </div>

        {/* Download error */}
        {downloadStatus === 'error' && downloadError && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{downloadError}</span>
          </div>
        )}

        {/* Local path indicator */}
        {isDesktop() && reference.pdfPath && (
          <p className="text-xs text-muted-foreground font-mono truncate">
            {reference.pdfPath}
          </p>
        )}
      </div>

      {/* PDF Extract Panel — desktop only */}
      {showExtract && pdfViewUrl && (
        <PdfExtractPanel
          pdfUrl={pdfViewUrl}
          onAppendNotes={text => handleNotesChange(notesDraft ? `${notesDraft}\n\n${text}` : text)}
        />
      )}

      {/* Inline PDF Viewer */}
      {showPdf && pdfViewUrl && (
        <div className="border rounded-lg overflow-hidden" style={{ height: '600px' }}>
          {isDesktop() && reference.pdfPath ? (
            // Desktop: use embed with local file path
            <embed
              src={pdfViewUrl}
              type="application/pdf"
              className="h-full w-full"
            />
          ) : (
            // Web: use iframe for remote PDF URL
            <iframe
              src={pdfViewUrl}
              className="h-full w-full border-0"
              title={`PDF: ${reference.title}`}
              sandbox="allow-same-origin allow-scripts"
            />
          )}
        </div>
      )}
    </div>
  )
}

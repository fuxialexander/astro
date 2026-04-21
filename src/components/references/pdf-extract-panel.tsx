/**
 * Desktop-only PDF extraction panel.
 * Provides a "Text" tab (per-page extracted text) and a "Pages" tab (page thumbnails).
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, FileText, Image, ClipboardCopy, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PdfExtractPanelProps {
  pdfUrl: string
  onAppendNotes: (text: string) => void
  className?: string
}

interface PageText {
  page: number
  text: string
}

type Tab = 'text' | 'pages'

// ── lazy pdfjs loader ──────────────────────────────────────────────────

async function loadPdfJs() {
  const pdfjsLib = await import('pdfjs-dist')
  // Use bundled worker via URL — avoids cross-origin issues in Electron
  const workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc
  return pdfjsLib
}

// ── component ──────────────────────────────────────────────────────────

export function PdfExtractPanel({ pdfUrl, onAppendNotes, className }: PdfExtractPanelProps) {
  const [tab, setTab] = useState<Tab>('text')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pages, setPages] = useState<PageText[]>([])
  const [thumbnails, setThumbnails] = useState<string[]>([])
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const pdfDocRef = useRef<unknown>(null)

  // Load PDF and extract text on mount
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const pdfjsLib = await loadPdfJs()
        const loadingTask = pdfjsLib.getDocument(pdfUrl)
        const pdf = await loadingTask.promise
        if (cancelled) return
        pdfDocRef.current = pdf

        const extracted: PageText[] = []
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const content = await page.getTextContent()
          const text = content.items
            .map((item: unknown) => {
              const it = item as { str?: string }
              return it.str ?? ''
            })
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
          extracted.push({ page: i, text })
        }
        if (!cancelled) setPages(extracted)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load PDF')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [pdfUrl])

  // Render thumbnails when Pages tab is first opened
  useEffect(() => {
    if (tab !== 'pages' || thumbnails.length > 0 || !pdfDocRef.current) return
    let cancelled = false

    async function renderThumbs() {
      const pdf = pdfDocRef.current as { numPages: number; getPage: (n: number) => Promise<unknown> }
      const results: string[] = []
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await (pdf.getPage(i) as Promise<{
          getViewport: (opts: { scale: number }) => { width: number; height: number }
          render: (ctx: unknown) => { promise: Promise<void> }
        }>)
        const viewport = page.getViewport({ scale: 0.5 })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx, viewport }).promise
        results.push(canvas.toDataURL('image/jpeg', 0.8))
        if (cancelled) return
      }
      if (!cancelled) setThumbnails(results)
    }

    renderThumbs()
    return () => { cancelled = true }
  }, [tab, thumbnails.length])

  const handleCopyPage = useCallback(async (dataUrl: string, idx: number) => {
    try {
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ])
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 1500)
    } catch {
      // fallback: copy as text link
    }
  }, [])

  const handleAppendSelected = useCallback(() => {
    const sel = window.getSelection()?.toString().trim()
    if (sel) onAppendNotes(sel)
  }, [onAppendNotes])

  return (
    <div className={cn('rounded-lg border bg-muted/20 flex flex-col', className)}>
      {/* Tab bar */}
      <div className="flex border-b px-3 pt-2 gap-1">
        <button
          onClick={() => setTab('text')}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors',
            tab === 'text'
              ? 'bg-background border border-b-background -mb-px text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <FileText className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
          Text
        </button>
        <button
          onClick={() => setTab('pages')}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors',
            tab === 'pages'
              ? 'bg-background border border-b-background -mb-px text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Image className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
          Pages
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 max-h-[400px]">
        {loading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Extracting PDF…
          </div>
        )}

        {error && !loading && (
          <p className="text-xs text-destructive py-4 text-center">{error}</p>
        )}

        {!loading && !error && tab === 'text' && (
          <div className="flex flex-col gap-4">
            <p className="text-[10px] text-muted-foreground">
              Select text and click <strong>Append selection</strong> to add it to notes.
            </p>
            {pages.map(({ page, text }) => (
              <div key={page} className="flex flex-col gap-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Page {page}
                </span>
                <p className="text-xs leading-relaxed select-text whitespace-pre-wrap">{text || <span className="italic text-muted-foreground">(no text)</span>}</p>
              </div>
            ))}
            {pages.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleAppendSelected}
                className="gap-1.5 self-start sticky bottom-2"
              >
                <Plus className="h-3.5 w-3.5" />
                Append selection
              </Button>
            )}
          </div>
        )}

        {!loading && !error && tab === 'pages' && (
          <div className="flex flex-col gap-4">
            {thumbnails.length === 0 && (
              <div className="flex items-center justify-center py-8 text-muted-foreground gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Rendering pages…
              </div>
            )}
            {thumbnails.map((src, idx) => (
              <div key={idx} className="flex flex-col gap-1.5">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Page {idx + 1}
                </span>
                <div className="relative group w-fit">
                  <img
                    src={src}
                    alt={`Page ${idx + 1}`}
                    className="rounded border max-w-full"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleCopyPage(src, idx)}
                    className="absolute top-2 right-2 gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <ClipboardCopy className="h-3.5 w-3.5" />
                    {copiedIdx === idx ? 'Copied!' : 'Copy image'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * QuickLook — macOS Finder–style instant file preview for the desktop file browser.
 *
 * Design: utility-first, fast, gets out of the way. Light translucent scrim,
 * snappy 100 ms animation, native-feeling chrome that uses the app's theme.
 *
 * Keyboard:
 *   Space / Escape — close
 *   ← / → — navigate to previous/next file
 *   O — open in external editor
 */

import { createPortal } from 'react-dom'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import {
  X,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  AlertTriangle,
  File,
  ImageIcon,
  FileCode,
  FileText,
  FileType2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { isDesktop } from '@/lib/desktop-detect'
import { desktopBridge } from '@/lib/desktop-bridge'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import {
  getFileCategory,
  getLanguageFromExtension,
  type FileCategory,
} from '@/components/file-browser/file-type-utils'

// ─── Types ───────────────────────────────────────────────────────────────────

interface QuickLookProps {
  filePath: string | null
  filePaths: string[]
  onClose: () => void
  onNavigate: (path: string) => void
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; category: FileCategory; text?: string; dataUrl?: string; blobUrl?: string }
  | { status: 'error'; message: string }

// ─── MIME helper ──────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
}

// ─── Content loading ──────────────────────────────────────────────────────────

function useQuickLookContent(filePath: string): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const blobRef = useRef<string | null>(null)

  useEffect(() => {
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current)
      blobRef.current = null
    }

    let cancelled = false

    const load = async () => {
      setState({ status: 'loading' })

      if (!isDesktop()) {
        setState({ status: 'error', message: 'Desktop bridge not available' })
        return
      }

      const filename = filePath.split('/').pop() ?? ''
      const ext = filename.split('.').pop()?.toLowerCase() ?? ''
      const category = getFileCategory(filename)

      try {
        if (category === 'image') {
          const { content } = await desktopBridge.fs.readFile(filePath, 'base64')
          if (!cancelled) {
            const mime = MIME[ext] ?? 'application/octet-stream'
            setState({ status: 'ready', category, dataUrl: `data:${mime};base64,${content}` })
          }
        } else if (category === 'pdf') {
          const { content } = await desktopBridge.fs.readFile(filePath, 'base64')
          if (!cancelled) {
            const bin = atob(content)
            const bytes = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
            const blob = new Blob([bytes], { type: 'application/pdf' })
            const url = URL.createObjectURL(blob)
            blobRef.current = url
            setState({ status: 'ready', category, blobUrl: url })
          }
        } else if (category === 'code' || category === 'markdown') {
          const { content } = await desktopBridge.fs.readFile(filePath, 'utf8')
          if (!cancelled) setState({ status: 'ready', category, text: content })
        } else {
          if (!cancelled) setState({ status: 'ready', category })
        }
      } catch (err) {
        if (!cancelled)
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to read file',
          })
      }
    }

    void load()
    return () => { cancelled = true }
  }, [filePath])

  useEffect(() => () => {
    if (blobRef.current) URL.revokeObjectURL(blobRef.current)
  }, [])

  return state
}

// ─── Type badge ───────────────────────────────────────────────────────────────

function getTypeBadge(filename: string) {
  const cat = getFileCategory(filename)
  const lang = getLanguageFromExtension(filename)
  switch (cat) {
    case 'image':
      return { label: 'IMAGE', icon: <ImageIcon className="w-3 h-3" />, cls: 'text-sky-400 bg-sky-400/10 border-sky-400/20' }
    case 'pdf':
      return { label: 'PDF', icon: <FileType2 className="w-3 h-3" />, cls: 'text-red-400 bg-red-400/10 border-red-400/20' }
    case 'markdown':
      return { label: 'MD', icon: <FileText className="w-3 h-3" />, cls: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' }
    case 'code':
      return { label: lang.toUpperCase(), icon: <FileCode className="w-3 h-3" />, cls: 'text-violet-400 bg-violet-400/10 border-violet-400/20' }
    default:
      return { label: 'FILE', icon: <File className="w-3 h-3" />, cls: 'text-muted-foreground bg-muted border-border' }
  }
}

// ─── Viewers ──────────────────────────────────────────────────────────────────

function CodeContent({ filePath, text }: { filePath: string; text: string }) {
  const language = getLanguageFromExtension(filePath)
  const lines = text.split('\n')
  const gutterW = String(lines.length).length

  return (
    <div className="h-full flex flex-col bg-[#0d1117]">
      <div className="flex-1 overflow-auto">
        <div className="inline-flex min-w-full">
          <div
            className="select-none text-right pr-4 pl-3 py-4 shrink-0 sticky left-0 bg-[#0d1117]"
            style={{
              minWidth: `${gutterW + 3}ch`,
              color: '#3d444d',
              borderRight: '1px solid #1b2028',
              fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
              fontSize: '12px',
              lineHeight: '20px',
            }}
          >
            {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
          </div>
          <pre
            className="flex-1 py-4 px-4 m-0 overflow-x-auto"
            style={{
              color: '#e6edf3',
              fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
              fontSize: '12px',
              lineHeight: '20px',
            }}
          >
            <code>{text}</code>
          </pre>
        </div>
      </div>
      <div
        className="shrink-0 flex items-center gap-2 px-3 py-1 text-[10px]"
        style={{ background: '#161b22', borderTop: '1px solid #1b2028', color: '#484f58' }}
      >
        <span className="font-medium text-[#8b949e]">{language}</span>
        <span className="opacity-40">|</span>
        <span>{lines.length} lines</span>
      </div>
    </div>
  )
}

function ImageContent({ dataUrl, filename }: { dataUrl: string; filename: string }) {
  return (
    <div
      className="h-full w-full flex items-center justify-center overflow-auto p-6 bg-background"
    >
      <img
        src={dataUrl}
        alt={filename}
        className="max-h-full max-w-full object-contain rounded shadow-lg"
      />
    </div>
  )
}

function PdfContent({ blobUrl }: { blobUrl: string }) {
  return <iframe src={blobUrl} className="w-full h-full border-0" title="PDF preview" />
}

function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="h-full overflow-auto bg-background">
      <div className="max-w-3xl mx-auto px-8 py-6">
        <MarkdownRenderer content={text} />
      </div>
    </div>
  )
}

function UnsupportedContent({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toUpperCase() ?? ''
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 bg-background">
      <div className="flex items-center justify-center w-16 h-16 rounded-xl bg-muted border border-border">
        <File className="w-7 h-7 text-muted-foreground/40" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">{filename}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {ext ? `.${ext} files can't be previewed` : 'No preview available'}
        </p>
      </div>
    </div>
  )
}

// ─── Panel ────────────────────────────────────────────────────────────────────

function QuickLookPanel({
  filePath,
  filePaths,
  onClose,
  onNavigate,
}: QuickLookProps & { filePath: string }) {
  const filename = filePath.split('/').pop() ?? ''
  const badge = useMemo(() => getTypeBadge(filename), [filename])
  const loadState = useQuickLookContent(filePath)
  const currentIdx = filePaths.indexOf(filePath)
  const hasPrev = currentIdx > 0
  const hasNext = currentIdx < filePaths.length - 1

  const handlePrev = useCallback(() => {
    if (hasPrev) onNavigate(filePaths[currentIdx - 1])
  }, [hasPrev, currentIdx, filePaths, onNavigate])

  const handleNext = useCallback(() => {
    if (hasNext) onNavigate(filePaths[currentIdx + 1])
  }, [hasNext, currentIdx, filePaths, onNavigate])

  const handleOpenExternal = useCallback(() => {
    if (!isDesktop()) return
    void desktopBridge.editor.openExternal(`file://${filePath}`)
  }, [filePath])

  // Keyboard: Space/Esc close, arrows navigate, O opens editor
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === 'Escape' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handlePrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleNext()
      } else if (e.key === 'o' || e.key === 'O') {
        handleOpenExternal()
      }
    }
    window.addEventListener('keydown', handler, true) // capture phase
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose, handlePrev, handleNext, handleOpenExternal])

  return (
    <>
      <style>{`
        @keyframes ql-in {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.97); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes ql-scrim-in { from { opacity: 0 } to { opacity: 1 } }
      `}</style>

      {/* Scrim — light, fast, no blur */}
      <div
        className="fixed inset-0 z-50 bg-black/40"
        style={{ animation: 'ql-scrim-in 80ms ease-out forwards' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(86vw, 1060px)',
          height: 'min(82vh, 780px)',
          animation: 'ql-in 100ms cubic-bezier(0.2, 0.9, 0.3, 1) forwards',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — compact, uses theme */}
        <div className="flex items-center gap-1.5 px-3 py-2 shrink-0 border-b border-border bg-muted/30">
          {/* Nav arrows */}
          <button
            onClick={handlePrev}
            disabled={!hasPrev}
            title="Previous (←)"
            className={cn(
              'flex items-center justify-center w-6 h-6 rounded-md transition-colors',
              hasPrev
                ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
                : 'text-muted-foreground/30 cursor-default',
            )}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleNext}
            disabled={!hasNext}
            title="Next (→)"
            className={cn(
              'flex items-center justify-center w-6 h-6 rounded-md transition-colors',
              hasNext
                ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
                : 'text-muted-foreground/30 cursor-default',
            )}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          {/* File info */}
          <div className="flex items-center gap-2 flex-1 min-w-0 ml-1">
            <span
              className="text-xs font-medium text-foreground truncate font-mono"
              title={filePath}
            >
              {filename}
            </span>
            <span
              className={cn(
                'flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide border',
                badge.cls,
              )}
            >
              {badge.icon}
              {badge.label}
            </span>
          </div>

          {filePaths.length > 1 && (
            <span className="text-[10px] text-muted-foreground/50 tabular-nums shrink-0">
              {currentIdx + 1}/{filePaths.length}
            </span>
          )}

          <button
            onClick={handleOpenExternal}
            title="Open in editor (O)"
            className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
          <button
            onClick={onClose}
            title="Close (Space / Esc)"
            className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {loadState.status === 'loading' && (
            <div className="h-full flex items-center justify-center bg-background">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40" />
            </div>
          )}

          {loadState.status === 'error' && (
            <div className="h-full flex flex-col items-center justify-center gap-3 bg-background">
              <AlertTriangle className="w-6 h-6 text-destructive" />
              <div className="text-center">
                <p className="text-sm font-medium text-destructive">Preview failed</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">{loadState.message}</p>
              </div>
            </div>
          )}

          {loadState.status === 'ready' && (
            <>
              {loadState.category === 'code' && loadState.text !== undefined && (
                <CodeContent filePath={filePath} text={loadState.text} />
              )}
              {loadState.category === 'markdown' && loadState.text !== undefined && (
                <MarkdownContent text={loadState.text} />
              )}
              {loadState.category === 'image' && loadState.dataUrl && (
                <ImageContent dataUrl={loadState.dataUrl} filename={filename} />
              )}
              {loadState.category === 'pdf' && loadState.blobUrl && (
                <PdfContent blobUrl={loadState.blobUrl} />
              )}
              {loadState.category === 'download-only' && (
                <UnsupportedContent filename={filename} />
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function QuickLook({ filePath, filePaths, onClose, onNavigate }: QuickLookProps) {
  if (!filePath) return null
  return createPortal(
    <QuickLookPanel
      filePath={filePath}
      filePaths={filePaths}
      onClose={onClose}
      onNavigate={onNavigate}
    />,
    document.body,
  )
}

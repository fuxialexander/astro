/**
 * DiffViewer — displays file content with syntax highlighting and
 * optional side-by-side or unified diff view.
 *
 * Loads file content via invoke('read_file') from Rust.
 * Uses a lightweight syntax highlighting approach with language detection.
 */
import { useEffect, useState, useMemo } from 'react'
import {
  FileCode,
  Columns,
  AlignJustify,
  Copy,
  Check,
  X,
} from 'lucide-react'

import { readFile } from '@desktop/lib/tauri-bridge'
import { cn } from '@desktop/lib/utils'

interface DiffViewerProps {
  filePath: string | null
  onClose?: () => void
}

type ViewMode = 'unified' | 'split'

/** Detect language from file extension. */
function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rs: 'rust',
    go: 'go',
    rb: 'ruby',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    toml: 'toml',
    xml: 'xml',
    svg: 'xml',
    dockerfile: 'dockerfile',
  }
  return langMap[ext] ?? 'text'
}

/** Very basic keyword highlighting by language. */
function highlightLine(text: string, lang: string): string {
  // Escape HTML
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  if (lang === 'text') return html

  // Highlight strings (single and double)
  html = html.replace(
    /(["'`])(?:(?!\1|\\).|\\.)*\1/g,
    '<span class="text-green-400">$&</span>',
  )

  // Highlight comments
  html = html.replace(
    /(\/\/.*$|#.*$)/gm,
    '<span class="text-gray-500 italic">$&</span>',
  )

  // Highlight keywords for common languages
  const keywords: Record<string, string[]> = {
    typescript: ['import', 'export', 'from', 'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'interface', 'type', 'extends', 'implements', 'async', 'await', 'new', 'this', 'try', 'catch', 'throw', 'switch', 'case', 'default', 'break', 'continue', 'typeof', 'instanceof', 'void', 'null', 'undefined', 'true', 'false'],
    tsx: ['import', 'export', 'from', 'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'interface', 'type', 'extends', 'async', 'await', 'new', 'this'],
    javascript: ['import', 'export', 'from', 'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'extends', 'async', 'await', 'new', 'this'],
    python: ['import', 'from', 'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with', 'as', 'yield', 'async', 'await', 'None', 'True', 'False', 'self', 'lambda', 'pass', 'raise'],
    rust: ['use', 'mod', 'fn', 'pub', 'let', 'mut', 'const', 'struct', 'enum', 'impl', 'trait', 'for', 'while', 'loop', 'if', 'else', 'match', 'return', 'self', 'Self', 'async', 'await', 'move', 'unsafe', 'where', 'type'],
  }

  const langKeywords = keywords[lang]
  if (langKeywords) {
    const kwPattern = new RegExp(`\\b(${langKeywords.join('|')})\\b`, 'g')
    html = html.replace(kwPattern, '<span class="text-purple-400 font-medium">$&</span>')
  }

  // Highlight numbers
  html = html.replace(
    /\b(\d+\.?\d*)\b/g,
    '<span class="text-orange-300">$&</span>',
  )

  return html
}

export function DiffViewer({ filePath, onClose }: DiffViewerProps) {
  if (!filePath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2">
        <FileCode className="w-8 h-8 opacity-40" />
        <p>Select a file to view</p>
      </div>
    )
  }

  // Render inner component with key to reset state on filePath change
  return <DiffViewerInner key={filePath} filePath={filePath} onClose={onClose} />
}

function DiffViewerInner({ filePath, onClose }: { filePath: string; onClose?: () => void }) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('unified')
  const [copied, setCopied] = useState(false)

  const language = useMemo(() => detectLanguage(filePath), [filePath])
  const fileName = useMemo(() => filePath.split('/').pop() ?? 'Untitled', [filePath])

  // Load file content
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const text = await readFile(filePath)
        if (!cancelled) {
          setContent(text)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to read file')
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [filePath])

  // Copy content to clipboard
  const handleCopy = async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard not available
    }
  }

  const lines = useMemo(() => content?.split('\n') ?? [], [content])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── File header ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 h-9 flex-shrink-0 border-b bg-muted/30">
        <FileCode className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs font-medium truncate flex-1" title={filePath}>
          {fileName}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">
          {language}
        </span>

        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 ml-2">
          <button
            onClick={() => setViewMode('unified')}
            className={cn(
              'p-1 rounded transition-colors duration-100',
              viewMode === 'unified'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title="Unified view"
          >
            <AlignJustify className="w-3 h-3" />
          </button>
          <button
            onClick={() => setViewMode('split')}
            className={cn(
              'p-1 rounded transition-colors duration-100',
              viewMode === 'split'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title="Split view"
          >
            <Columns className="w-3 h-3" />
          </button>
        </div>

        {/* Copy */}
        <button
          onClick={() => void handleCopy()}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-100"
          title="Copy file content"
        >
          {copied ? (
            <Check className="w-3 h-3 text-green-400" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>

        {/* Close */}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-100"
            title="Close file"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* ── Content ──────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
          Loading...
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-full text-xs text-error px-4 text-center">
          {error}
        </div>
      ) : (
        <div className="flex-1 overflow-auto font-mono text-xs leading-5">
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, i) => (
                <tr
                  key={i}
                  className="hover:bg-muted/30 transition-colors duration-75"
                >
                  {/* Line number */}
                  <td className="text-right text-muted-foreground/50 select-none px-3 py-0 align-top w-[1%] whitespace-nowrap border-r border-muted/30">
                    {i + 1}
                  </td>
                  {/* Code line */}
                  <td className="px-4 py-0 whitespace-pre-wrap break-all">
                    <span
                      dangerouslySetInnerHTML={{
                        __html: highlightLine(line, language),
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

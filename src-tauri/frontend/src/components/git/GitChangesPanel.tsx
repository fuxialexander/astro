/**
 * GitChangesPanel — GitHub Desktop-style split diff view.
 *
 * Layout:
 *   ┌──────────────────────────────┬──────────────────┐
 *   │  diff viewer (line numbers)  │  file tree        │
 *   │  file header: +N -N  •  ⌃   │  Unstaged 93  ↓  │
 *   │  1   1   context line       │  Filter files...  │
 *   │      2  +added line         │  ▼ packages       │
 *   │  3   3   context line       │    agent-runner   │
 *   │                             │  ▶ scripts        │
 *   │  [↩ Revert all][+ Stage all]│                   │
 *   └──────────────────────────────┴──────────────────┘
 */
import { useEffect, useState, useCallback, useRef, useDeferredValue } from 'react'
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, RotateCcw, Plus, RefreshCw } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { cn } from '@desktop/lib/utils'
import type { GitStatus } from '@desktop/types'

interface GitChangesPanelProps {
  repoPath: string | null
  onStatsChange?: (additions: number, deletions: number) => void
}

// ── Diff parsing ──────────────────────────────────────────────────────────────

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'hunk' | 'meta'
  content: string
  oldLine?: number
  newLine?: number
}

interface FileDiff {
  path: string
  additions: number
  deletions: number
  isNew: boolean
  lines: DiffLine[]
}

function parseFullDiff(raw: string): FileDiff[] {
  const fileDiffs: FileDiff[] = []
  // Split on "diff --git" boundaries
  const sections = raw.split(/(?=^diff --git )/m).filter(Boolean)

  for (const section of sections) {
    const headerLine = section.match(/^diff --git a\/(.*?) b\/(.*)$/m)
    if (!headerLine) continue
    const path = headerLine[2]

    const additions = (section.match(/^\+(?!\+\+)/gm) ?? []).length
    const deletions = (section.match(/^-(?!--)/gm) ?? []).length
    const isNew = /^new file mode/m.test(section)

    const lines: DiffLine[] = []
    let oldLine = 0
    let newLine = 0

    for (const rawLine of section.split('\n')) {
      if (
        rawLine.startsWith('diff --git') ||
        rawLine.startsWith('index ') ||
        rawLine.startsWith('old mode') ||
        rawLine.startsWith('new mode') ||
        rawLine.startsWith('new file') ||
        rawLine.startsWith('deleted file') ||
        rawLine.startsWith('--- ') ||
        rawLine.startsWith('+++ ')
      ) {
        lines.push({ type: 'meta', content: rawLine })
        continue
      }

      const hunkMatch = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
      if (hunkMatch) {
        oldLine = parseInt(hunkMatch[1])
        newLine = parseInt(hunkMatch[2])
        lines.push({ type: 'hunk', content: rawLine })
        continue
      }

      if (rawLine.startsWith('+')) {
        lines.push({ type: 'add', content: rawLine.slice(1), newLine: newLine++ })
      } else if (rawLine.startsWith('-')) {
        lines.push({ type: 'remove', content: rawLine.slice(1), oldLine: oldLine++ })
      } else {
        // context or blank
        lines.push({ type: 'context', content: rawLine.slice(1), oldLine: oldLine++, newLine: newLine++ })
      }
    }

    fileDiffs.push({ path, additions, deletions, isNew, lines })
  }

  return fileDiffs
}

// ── File tree ─────────────────────────────────────────────────────────────────

interface TreeNode {
  name: string
  fullPath: string
  isDir: boolean
  children: TreeNode[]
  isNew: boolean
}

function buildTree(files: string[], newSet: Set<string>): TreeNode[] {
  const root: TreeNode[] = []

  for (const file of files) {
    const parts = file.split('/')
    let nodes = root
    let cumPath = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      cumPath = cumPath ? `${cumPath}/${part}` : part
      const isLast = i === parts.length - 1

      if (isLast) {
        nodes.push({ name: part, fullPath: file, isDir: false, children: [], isNew: newSet.has(file) })
      } else {
        let dir = nodes.find((n) => n.name === part && n.isDir)
        if (!dir) {
          dir = { name: part, fullPath: cumPath, isDir: true, children: [], isNew: false }
          nodes.push(dir)
        }
        nodes = dir.children
      }
    }
  }

  return root
}

function TreeItem({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: TreeNode
  depth: number
  selected: string | null
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = useState(true)

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 w-full px-2 py-[3px] text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          {open ? (
            <ChevronDown className="w-3 h-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
          )}
          {open ? (
            <FolderOpen className="w-3 h-3 flex-shrink-0 text-blue-400" />
          ) : (
            <Folder className="w-3 h-3 flex-shrink-0 text-blue-400" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {open &&
          node.children.map((child) => (
            <TreeItem key={child.fullPath} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
          ))}
      </div>
    )
  }

  return (
    <button
      onClick={() => onSelect(node.fullPath)}
      className={cn(
        'flex items-center gap-1.5 w-full py-[3px] text-[11px] transition-colors',
        selected === node.fullPath
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      <File className="w-3 h-3 flex-shrink-0 flex-shrink-0" />
      <span className="truncate">{node.name}</span>
      {node.isNew && <span className="ml-auto mr-2 text-[9px] text-green-500 font-medium">U</span>}
    </button>
  )
}

// ── Diff viewer ───────────────────────────────────────────────────────────────

function FileDiffBlock({
  fileDiff,
  defaultExpanded,
}: {
  fileDiff: FileDiff
  defaultExpanded: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const shortName = fileDiff.path.split('/').pop() ?? fileDiff.path

  return (
    <div className="border rounded-md overflow-hidden mb-3 mx-2">
      {/* File header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b text-[11px]">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <span className="font-mono text-foreground truncate max-w-[200px]" title={fileDiff.path}>
          {shortName}
        </span>
        {fileDiff.additions > 0 && (
          <span className="text-green-600 font-medium">+{fileDiff.additions}</span>
        )}
        {fileDiff.deletions > 0 && (
          <span className="text-red-500 font-medium">-{fileDiff.deletions}</span>
        )}
        {fileDiff.isNew && (
          <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" title="New file" />
        )}
      </div>

      {expanded && (
        <div className="overflow-x-auto font-mono text-[11px] leading-5">
          <table className="w-full border-collapse">
            <tbody>
              {fileDiff.lines.map((line, i) => {
                if (line.type === 'meta') return null
                if (line.type === 'hunk') {
                  return (
                    <tr key={i} className="bg-blue-50/60">
                      <td className="w-8 px-2 text-right text-blue-400/60 select-none border-r border-blue-200/50" />
                      <td className="w-8 px-2 text-right text-blue-400/60 select-none border-r border-blue-200/50" />
                      <td className="px-3 py-0 text-blue-400 whitespace-pre">
                        {line.content}
                      </td>
                    </tr>
                  )
                }
                if (line.type === 'add') {
                  return (
                    <tr key={i} className="bg-green-50">
                      <td className="w-8 px-2 text-right text-green-600/50 select-none border-r border-green-200/50 text-[10px]" />
                      <td className="w-8 px-2 text-right text-green-600 select-none border-r border-green-200/50 text-[10px]">
                        {line.newLine}
                      </td>
                      <td className="px-0 border-l-2 border-l-green-500">
                        <span className="pl-2 pr-3 whitespace-pre block text-green-900">{line.content || '\u00A0'}</span>
                      </td>
                    </tr>
                  )
                }
                if (line.type === 'remove') {
                  return (
                    <tr key={i} className="bg-red-50">
                      <td className="w-8 px-2 text-right text-red-500 select-none border-r border-red-200/50 text-[10px]">
                        {line.oldLine}
                      </td>
                      <td className="w-8 px-2 text-right text-red-500/50 select-none border-r border-red-200/50 text-[10px]" />
                      <td className="px-0 border-l-2 border-l-red-500">
                        <span className="pl-2 pr-3 whitespace-pre block text-red-900">{line.content || '\u00A0'}</span>
                      </td>
                    </tr>
                  )
                }
                // context
                return (
                  <tr key={i}>
                    <td className="w-8 px-2 text-right text-muted-foreground/40 select-none border-r border-border/40 text-[10px]">
                      {line.oldLine}
                    </td>
                    <td className="w-8 px-2 text-right text-muted-foreground/40 select-none border-r border-border/40 text-[10px]">
                      {line.newLine}
                    </td>
                    <td className="px-0 border-l-2 border-l-transparent">
                      <span className="pl-2 pr-3 whitespace-pre block text-foreground/80">{line.content || '\u00A0'}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function GitChangesPanel({ repoPath, onStatsChange }: GitChangesPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [staged, setStaged] = useState(false)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    if (!repoPath) return
    setLoading(true)
    try {
      const s = await invoke<GitStatus>('git_status', { repoPath })
      setStatus(s)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  const loadDiff = useCallback(async () => {
    if (!repoPath) return
    try {
      const raw = await invoke<string>('git_diff', { repoPath, staged })
      // Yield the main thread before parsing so the panel animation isn't blocked
      await new Promise<void>((r) => setTimeout(r, 0))
      const diffs = parseFullDiff(raw)
      setFileDiffs(diffs)
      onStatsChange?.(
        diffs.reduce((s, f) => s + f.additions, 0),
        diffs.reduce((s, f) => s + f.deletions, 0),
      )
    } catch {
      setFileDiffs([])
      onStatsChange?.(0, 0)
    }
  }, [repoPath, staged])

  useEffect(() => {
    void refresh()
    void loadDiff()
  }, [refresh, loadDiff])

  const unstaged = [...(status?.modified ?? []), ...(status?.untracked ?? [])]
  const stagedFiles = status?.staged ?? []
  const allFiles = staged ? stagedFiles : unstaged
  const newSet = new Set(status?.untracked ?? [])

  const filteredFiles = filter
    ? allFiles.filter((f) => f.toLowerCase().includes(filter.toLowerCase()))
    : allFiles

  const tree = buildTree(filteredFiles, newSet)

  // Visible diffs: if a file is selected, only show that file's diff.
  // useDeferredValue lets the panel open animation complete before React
  // commits the (potentially large) diff list to the DOM.
  const rawVisibleDiffs = selectedFile
    ? fileDiffs.filter((fd) => fd.path === selectedFile)
    : fileDiffs
  const visibleDiffs = useDeferredValue(rawVisibleDiffs)

  if (!repoPath) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        No repository
      </div>
    )
  }

  const count = allFiles.length

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: diff viewer ──────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col relative">
        {/* Staged/Unstaged toggle */}
        <div className="flex items-center gap-1 px-3 h-8 flex-shrink-0 border-b bg-muted/10">
          <button
            onClick={() => { setStaged(false); setSelectedFile(null) }}
            className={cn(
              'px-2 py-0.5 text-[11px] rounded transition-colors',
              !staged ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Unstaged
          </button>
          <button
            onClick={() => { setStaged(true); setSelectedFile(null) }}
            className={cn(
              'px-2 py-0.5 text-[11px] rounded transition-colors',
              staged ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Staged
          </button>
          <div className="flex-1" />
          <button
            onClick={() => { void refresh(); void loadDiff() }}
            disabled={loading}
            className={cn('p-1 rounded text-muted-foreground hover:text-foreground transition-colors', loading && 'animate-spin')}
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>

        {/* Diff content */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-auto py-2">
          {visibleDiffs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              {loading ? 'Loading…' : selectedFile ? 'No diff for this file' : 'No changes'}
            </div>
          ) : (
            visibleDiffs.map((fd) => (
              <FileDiffBlock key={fd.path} fileDiff={fd} defaultExpanded={false} />
            ))
          )}
        </div>

        {/* Floating action bar */}
        {allFiles.length > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-px bg-background border shadow-lg rounded-full px-1 py-1 text-[11px]">
            <button className="flex items-center gap-1.5 px-3 py-1 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <RotateCcw className="w-3 h-3" />
              Revert all
            </button>
            <div className="w-px h-4 bg-border" />
            <button className="flex items-center gap-1.5 px-3 py-1 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <Plus className="w-3 h-3" />
              Stage all
            </button>
          </div>
        )}
      </div>

      {/* ── Right: file tree ───────────────────────────────────────── */}
      <div className="w-[200px] flex-shrink-0 border-l flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-1.5 px-2 h-8 flex-shrink-0 border-b bg-muted/10">
          <span className="text-[11px] font-medium text-foreground">
            {staged ? 'Staged' : 'Unstaged'}
          </span>
          {count > 0 && (
            <span className="text-[10px] bg-muted text-muted-foreground rounded-full px-1.5 py-px font-medium">
              {count}
            </span>
          )}
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        </div>

        {/* Filter */}
        <div className="px-2 py-1.5 border-b">
          <input
            type="text"
            placeholder="Filter files…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full bg-muted/40 rounded px-2 py-0.5 text-[11px] placeholder:text-muted-foreground/60 outline-none border border-transparent focus:border-border transition-colors"
          />
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto">
          {tree.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-[11px] text-muted-foreground">
              {loading ? 'Loading…' : 'No changes'}
            </div>
          ) : (
            tree.map((node) => (
              <TreeItem
                key={node.fullPath}
                node={node}
                depth={0}
                selected={selectedFile}
                onSelect={(path) => setSelectedFile(selectedFile === path ? null : path)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

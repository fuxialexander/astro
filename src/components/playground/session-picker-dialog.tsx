/**
 * Session Picker Dialog
 *
 * Command-palette style fuzzy search dialog for browsing and resuming
 * Claude Code sessions from connected machines, plus Astro playground sessions.
 */

import { useState, useMemo, useEffect, useCallback, useRef, useLayoutEffect } from "react"
import {
  Search,
  X,
  Terminal,
  Laptop,
  GitBranch,
  FolderOpen,
  Loader2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Layers,
} from "lucide-react"
import Fuse from "fuse.js"
import { cn } from "@/lib/utils"
import {
  useClaudeSessionsStore,
  type ClaudeCodeSession,
} from "@/stores/claude-sessions-store"
import type { Project } from "@/types"

/** Unified item for the picker list */
export type PickerItem =
  | { kind: "claude"; session: ClaudeCodeSession }
  | { kind: "playground"; project: Project }
  | { kind: "plan"; project: Project }

interface SessionPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectSession: (session: ClaudeCodeSession) => void
  /** Astro playground sessions to include in the list */
  playgroundSessions?: Project[]
  /** Called when an Astro playground session is selected */
  onSelectPlaygroundSession?: (projectId: string) => void
  /** Plan sessions to include in the list */
  planSessions?: Project[]
  /** Called when a plan session is selected */
  onSelectPlanSession?: (projectId: string) => void
}

/** Clean up leading noise from session text */
function cleanText(raw: string): string {
  return raw
    // Remove leading bracketed noise: [Request interrupted...], etc.
    .replace(/^\s*(\[[\w\s]+\]\s*)+/g, "")
    // Remove leading XML-style tags: <local-command-caveat>...</local-command-caveat>
    .replace(/^\s*<[^>]+>[^<]*(<\/[^>]+>)?\s*/g, "")
    .trim()
}

function getSessionTitle(session: ClaudeCodeSession): string {
  // Prefer summary (last user prompt), then customTitle, then firstPrompt
  for (const candidate of [session.summary, session.customTitle, session.firstPrompt]) {
    if (!candidate?.trim()) continue
    const cleaned = cleanText(candidate)
    if (cleaned.length >= 5) return cleaned
  }
  // All were noisy after cleaning — show raw summary/firstPrompt anyway (better than hex ID)
  const raw = session.summary || session.firstPrompt || session.customTitle
  if (raw?.trim()) return raw.trim().slice(0, 100)
  return session.sessionId.slice(0, 8)
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

export function SessionPickerDialog({
  open,
  onOpenChange,
  onSelectSession,
  playgroundSessions = [],
  onSelectPlaygroundSession,
  planSessions = [],
  onSelectPlanSession,
}: SessionPickerDialogProps) {
  const sessions = useClaudeSessionsStore((s) => s.sessions)
  const loading = useClaudeSessionsStore((s) => s.loading)
  const refreshing = useClaudeSessionsStore((s) => s.refreshing)
  const error = useClaudeSessionsStore((s) => s.error)
  const loadSessions = useClaudeSessionsStore((s) => s.loadSessions)

  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Load sessions when dialog opens
  useEffect(() => {
    if (open) {
      loadSessions()
      // Focus input after animation
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open, loadSessions])

  // Reset query/selection when dialog opens
  const prevOpen = useRef(open)
  useLayoutEffect(() => {
    if (open && !prevOpen.current) {
      setQuery("") // eslint-disable-line react-hooks/set-state-in-effect -- intentional: reset on dialog open transition
      setSelectedIndex(0)
    }
    prevOpen.current = open
  }, [open])

  const handleRefresh = useCallback(() => {
    useClaudeSessionsStore.setState({ lastLoadedAt: null })
    loadSessions()
  }, [loadSessions])

  // Merge Claude Code sessions + Astro playground sessions + plan sessions into unified list sorted by time
  const allItems: PickerItem[] = useMemo(() => {
    const items: PickerItem[] = [
      ...sessions.map((s): PickerItem => ({ kind: "claude", session: s })),
      ...playgroundSessions.map((p): PickerItem => ({ kind: "playground", project: p })),
      ...planSessions.map((p): PickerItem => ({ kind: "plan", project: p })),
    ]
    items.sort((a, b) => {
      const timeA = a.kind === "claude" ? a.session.lastModified : new Date(a.project.updatedAt).getTime()
      const timeB = b.kind === "claude" ? b.session.lastModified : new Date(b.project.updatedAt).getTime()
      return timeB - timeA
    })
    return items
  }, [sessions, playgroundSessions, planSessions])

  // Helper to get searchable text from a PickerItem
  const getItemTitle = useCallback((item: PickerItem): string => {
    if (item.kind === "claude") return getSessionTitle(item.session)
    if (item.kind === "plan") return item.project.name || item.project.description?.slice(0, 100) || "Plan session"
    return item.project.name || item.project.description?.slice(0, 100) || "Playground session"
  }, [])

  const getItemSearchText = useCallback((item: PickerItem): string => {
    if (item.kind === "claude") {
      return [
        getSessionTitle(item.session),
        item.session.cwd,
        item.session.gitBranch,
        item.session.machineName,
        item.session.firstPrompt,
        item.session.summary,
      ].filter(Boolean).join(" ")
    }
    return [
      item.project.name,
      item.project.description,
      item.project.workingDirectory,
    ].filter(Boolean).join(" ")
  }, [])

  // Fuzzy search over unified items
  const fuse = useMemo(
    () =>
      new Fuse(allItems, {
        keys: [
          { name: "searchText", getFn: (item) => getItemSearchText(item) },
          { name: "title", getFn: (item) => getItemTitle(item) },
        ],
        threshold: 0.4,
        includeScore: true,
      }),
    [allItems, getItemSearchText, getItemTitle]
  )

  const filtered = useMemo(() => {
    if (!query.trim()) return allItems
    return fuse.search(query).map((r) => r.item)
  }, [query, allItems, fuse])

  // Keep selected index in bounds (synchronous to avoid cascading renders)
  const clampedIndex = selectedIndex >= filtered.length
    ? Math.max(0, filtered.length - 1)
    : selectedIndex
  if (clampedIndex !== selectedIndex) {
    setSelectedIndex(clampedIndex)
  }

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const items = listRef.current.querySelectorAll("[data-session-item]")
    items[selectedIndex]?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  const handleSelect = useCallback((item: PickerItem) => {
    if (item.kind === "claude") {
      onSelectSession(item.session)
    } else if (item.kind === "plan") {
      onSelectPlanSession?.(item.project.id)
    } else {
      onSelectPlaygroundSession?.(item.project.id)
    }
    onOpenChange(false)
  }, [onSelectSession, onSelectPlaygroundSession, onSelectPlanSession, onOpenChange])

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onOpenChange(false)
        return
      }
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === "Enter") {
        e.preventDefault()
        if (filtered[selectedIndex]) {
          handleSelect(filtered[selectedIndex])
        }
        return
      }
    },
    [filtered, selectedIndex, handleSelect, onOpenChange]
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" onKeyDown={handleKeyDown}>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-200"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog */}
      <div className="fixed left-1/2 top-[15vh] w-full max-w-[560px] -translate-x-1/2 rounded-xl border border-border bg-background shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200">
        {/* Search header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder="Search sessions..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
          {refreshing && (
            <span className="text-[10px] text-muted-foreground">updating...</span>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading || refreshing}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", (loading || refreshing) && "animate-spin")} />
          </button>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Session list */}
        <div ref={listRef} className="max-h-[400px] overflow-y-auto p-1.5">
          {loading && allItems.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error && allItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <p className="text-xs text-destructive text-center">{error}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Terminal className="h-5 w-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                {query ? "No matching sessions" : "No sessions found"}
              </p>
            </div>
          ) : (
            filtered.map((item, i) => {
              const key = item.kind === "claude"
                ? `claude-${item.session.machineId}-${item.session.sessionId}`
                : `${item.kind}-${item.project.id}`
              const timestamp = item.kind === "claude"
                ? item.session.lastModified
                : new Date(item.project.updatedAt).getTime()

              return (
                <button
                  key={key}
                  data-session-item
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={cn(
                    "w-full flex flex-col gap-1 px-3 py-2.5 rounded-lg text-left transition-colors",
                    i === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {getItemTitle(item)}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                      {formatRelativeTime(timestamp)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground">
                    {item.kind === "claude" ? (
                      <>
                        <span className="flex items-center gap-0.5 shrink-0">
                          <Laptop className="h-2.5 w-2.5" />
                          {item.session.machineName}
                        </span>
                        {item.session.gitBranch && (
                          <span className="flex items-center gap-0.5 truncate">
                            <GitBranch className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{item.session.gitBranch}</span>
                          </span>
                        )}
                        {item.session.cwd && (
                          <span className="flex items-center gap-0.5 truncate">
                            <FolderOpen className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate font-mono">{item.session.cwd}</span>
                          </span>
                        )}
                      </>
                    ) : item.kind === "plan" ? (
                      <>
                        <span className="flex items-center gap-0.5 shrink-0">
                          <Layers className="h-2.5 w-2.5" />
                          Plan
                        </span>
                        {item.project.workingDirectory && (
                          <span className="flex items-center gap-0.5 truncate">
                            <FolderOpen className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate font-mono">{item.project.workingDirectory}</span>
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="flex items-center gap-0.5 shrink-0">
                          <Sparkles className="h-2.5 w-2.5" />
                          Playground
                        </span>
                        {item.project.workingDirectory && (
                          <span className="flex items-center gap-0.5 truncate">
                            <FolderOpen className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate font-mono">{item.project.workingDirectory}</span>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono text-[9px]">&uarr;&darr;</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono text-[9px]">Enter</kbd>
            resume
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono text-[9px]">Esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  )
}

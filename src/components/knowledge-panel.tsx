import { useEffect, useMemo, useState } from "react"
import { BookOpen, ChevronDown, ChevronRight, Search, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useKnowledgeStore, type KnowledgeEntry } from "@/stores/knowledge-store"
import { usePlanStore, isLive } from "@/stores/plan-store"

const EMPTY_ENTRIES: KnowledgeEntry[] = []
import { cn } from "@/lib/utils"
import { formatRelativeTime } from "@/lib/date-utils"

type GroupedKnowledge = {
  label: string
  milestoneId: string | undefined
  entries: KnowledgeEntry[]
}

export function KnowledgePanel({ projectId }: { projectId: string }) {
  const loadKnowledge = useKnowledgeStore((s) => s.loadKnowledge)
  const deleteKnowledge = useKnowledgeStore((s) => s.deleteKnowledge)
  const entries = useKnowledgeStore((s) => s.entriesByProject[projectId]) ?? EMPTY_ENTRIES
  const loading = useKnowledgeStore((s) => s.loading[projectId])
  const error = useKnowledgeStore((s) => s.error[projectId])

  const rawNodes = usePlanStore((s) => s.nodes)
  const milestones = useMemo(
    () => rawNodes.filter(isLive).filter((n) => n.projectId === projectId && n.type === "milestone"),
    [rawNodes, projectId]
  )

  const [search, setSearch] = useState("")
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    loadKnowledge(projectId)
  }, [projectId, loadKnowledge])

  const filtered = useMemo(() => {
    if (!search) return entries
    const q = search.toLowerCase()
    return entries.filter(
      (e) =>
        e.key.toLowerCase().includes(q) ||
        e.value.toLowerCase().includes(q) ||
        (e.sourceTaskTitle && e.sourceTaskTitle.toLowerCase().includes(q))
    )
  }, [entries, search])

  const grouped = useMemo(() => {
    const groups: GroupedKnowledge[] = []
    const byMilestone = new Map<string | undefined, KnowledgeEntry[]>()

    for (const entry of filtered) {
      const key = entry.milestoneId ?? undefined
      if (!byMilestone.has(key)) byMilestone.set(key, [])
      byMilestone.get(key)!.push(entry)
    }

    // Named milestones first, then ungrouped
    for (const milestone of milestones) {
      const items = byMilestone.get(milestone.id)
      if (items && items.length > 0) {
        groups.push({ label: milestone.title, milestoneId: milestone.id, entries: items })
        byMilestone.delete(milestone.id)
      }
    }

    // Entries without a milestone
    const ungrouped = byMilestone.get(undefined)
    if (ungrouped && ungrouped.length > 0) {
      groups.push({ label: "General", milestoneId: undefined, entries: ungrouped })
    }

    // Any remaining milestone IDs that don't match existing milestones
    for (const [mId, items] of byMilestone) {
      if (mId !== undefined && items.length > 0) {
        groups.push({ label: "Other", milestoneId: mId, entries: items })
      }
    }

    return groups
  }, [filtered, milestones])

  const toggleExpand = (id: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDelete = (entryId: string) => {
    if (confirmDelete === entryId) {
      deleteKnowledge(projectId, entryId)
      setConfirmDelete(null)
    } else {
      setConfirmDelete(entryId)
      // Reset confirm state after 3 seconds
      setTimeout(() => setConfirmDelete((prev) => (prev === entryId ? null : prev)), 3000)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <BookOpen className="h-8 w-8 animate-pulse" />
          <p className="text-sm">Loading knowledge...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <BookOpen className="h-8 w-8" />
          <p className="text-sm text-error">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Knowledge</h3>
        <span className="text-xs text-muted-foreground">{entries.length} entries</span>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 w-48 rounded-md border border-input bg-background pl-8 pr-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground/40" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-muted-foreground">No knowledge entries yet</p>
              <p className="text-xs text-muted-foreground max-w-[300px]">
                Knowledge entries are created by agents during task execution to capture important findings, decisions, and context.
              </p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
            <Search className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No entries match "{search}"</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {grouped.map((group) => (
              <div key={group.milestoneId ?? "general"} className="flex flex-col gap-2">
                {grouped.length > 1 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {group.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">({group.entries.length})</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  {group.entries.map((entry) => {
                    const isExpanded = expandedKeys.has(entry.id)
                    const isLongValue = entry.value.length > 200

                    return (
                      <div
                        key={entry.id}
                        className="group rounded-lg border border-border bg-card p-3 hover:border-border/80 transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          {isLongValue && (
                            <button
                              onClick={() => toggleExpand(entry.id)}
                              className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </button>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-mono shrink-0">
                                {entry.key}
                              </Badge>
                              {entry.sourceTaskTitle && (
                                <span className="text-[10px] text-muted-foreground truncate">
                                  from: {entry.sourceTaskTitle}
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">
                                {formatRelativeTime(entry.updatedAt)}
                              </span>
                            </div>
                            <div
                              className={cn(
                                "text-xs text-foreground/80 whitespace-pre-wrap break-words",
                                !isExpanded && isLongValue && "line-clamp-3"
                              )}
                            >
                              {entry.value}
                            </div>
                          </div>
                          <button
                            onClick={() => handleDelete(entry.id)}
                            className={cn(
                              "mt-0.5 shrink-0 transition-colors",
                              confirmDelete === entry.id
                                ? "text-error"
                                : "text-muted-foreground/0 group-hover:text-muted-foreground hover:text-error"
                            )}
                            title={confirmDelete === entry.id ? "Click again to confirm" : "Delete entry"}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

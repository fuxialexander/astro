/**
 * GTD Workflow Page
 *
 * A Getting Things Done workflow view contributed by the GTD plugin.
 * Reads tasks from the plan store and organizes them into Inbox,
 * Next Actions (grouped by context), and Waiting For columns.
 */

import { useMemo, useState, useCallback } from "react"
import { useNavigate } from "react-router"
import { Inbox, Zap, Clock, Plus, ChevronDown, X, Tag } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { cn } from "@/lib/utils"
import type { PlanNode } from "@/types"

const GTD_CONTEXTS = [
  "@computer",
  "@phone",
  "@errand",
  "@home",
  "@office",
  "@anywhere",
] as const

type GtdContext = (typeof GTD_CONTEXTS)[number]

function isNextAction(node: PlanNode): boolean {
  return node.metadata?.["gtd-next-action"] === true
}

function getGtdContext(node: PlanNode): GtdContext | undefined {
  return node.metadata?.["gtd-context"] as GtdContext | undefined
}

function isWaitingFor(node: PlanNode): boolean {
  return node.status === "awaiting_approval" || node.status === "awaiting_judgment"
}

function isInbox(node: PlanNode): boolean {
  if (node.status === "completed" || node.status === "pruned" || node.status === "auto_verified") return false
  if (isNextAction(node)) return false
  if (isWaitingFor(node)) return false
  return true
}

// --- Sub-component ---

interface GtdTaskCardProps {
  node: PlanNode
  projectName: string
  actions?: React.ReactNode
}

function GtdTaskCard({ node, projectName, actions }: GtdTaskCardProps) {
  const navigate = useNavigate()

  return (
    <div
      className="group flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 hover:bg-muted/50 transition-colors cursor-pointer"
      onClick={() => navigate(`/project/${node.projectId}/plan`)}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{node.title}</div>
        <div className="text-xs text-muted-foreground truncate">{projectName}</div>
      </div>
      {actions && (
        <div className="shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  )
}

// --- Column components ---

function InboxColumn({
  tasks,
  projectMap,
  onMoveToNextAction,
}: {
  tasks: PlanNode[]
  projectMap: Map<string, string>
  onMoveToNextAction: (nodeId: string, context: GtdContext) => void
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <Inbox className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Inbox</h2>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">
          {tasks.length}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Uncategorized tasks. Assign a context to move to Next Actions.
      </p>
      <div className="flex flex-col gap-1.5 flex-1 overflow-y-auto max-h-[calc(100vh-280px)]">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Inbox className="h-8 w-8 mb-2 opacity-30" />
            <span className="text-sm">Inbox zero</span>
          </div>
        ) : (
          tasks.map((node) => (
            <GtdTaskCard
              key={node.id}
              node={node}
              projectName={projectMap.get(node.projectId) ?? "Unknown"}
              actions={
                <ContextDropdown
                  onSelect={(ctx) => onMoveToNextAction(node.id, ctx)}
                />
              }
            />
          ))
        )}
      </div>
    </div>
  )
}

function NextActionsColumn({
  tasks,
  projectMap,
  onChangeContext,
  onRemoveFromNextActions,
}: {
  tasks: PlanNode[]
  projectMap: Map<string, string>
  onChangeContext: (nodeId: string, context: GtdContext) => void
  onRemoveFromNextActions: (nodeId: string) => void
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, PlanNode[]>()
    for (const node of tasks) {
      const ctx = getGtdContext(node) ?? "@anywhere"
      const list = groups.get(ctx) ?? []
      list.push(node)
      groups.set(ctx, list)
    }
    return groups
  }, [tasks])

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Next Actions</h2>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">
          {tasks.length}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Tasks flagged as next actions, grouped by context.
      </p>
      <div className="flex flex-col gap-3 flex-1 overflow-y-auto max-h-[calc(100vh-280px)]">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Zap className="h-8 w-8 mb-2 opacity-30" />
            <span className="text-sm">No next actions</span>
          </div>
        ) : (
          Array.from(grouped.entries()).map(([ctx, nodes]) => (
            <div key={ctx}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Tag className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {ctx}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {nodes.map((node) => (
                  <GtdTaskCard
                    key={node.id}
                    node={node}
                    projectName={projectMap.get(node.projectId) ?? "Unknown"}
                    actions={
                      <div className="flex items-center gap-1">
                        <ContextDropdown
                          currentContext={getGtdContext(node)}
                          onSelect={(c) => onChangeContext(node.id, c)}
                        />
                        <button
                          type="button"
                          onClick={() => onRemoveFromNextActions(node.id)}
                          className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Remove from next actions"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    }
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function WaitingForColumn({
  tasks,
  projectMap,
}: {
  tasks: PlanNode[]
  projectMap: Map<string, string>
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Waiting For</h2>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">
          {tasks.length}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Items awaiting approval or external judgment.
      </p>
      <div className="flex flex-col gap-1.5 flex-1 overflow-y-auto max-h-[calc(100vh-280px)]">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Clock className="h-8 w-8 mb-2 opacity-30" />
            <span className="text-sm">Nothing waiting</span>
          </div>
        ) : (
          tasks.map((node) => (
            <GtdTaskCard
              key={node.id}
              node={node}
              projectName={projectMap.get(node.projectId) ?? "Unknown"}
              actions={
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] px-1.5 py-0",
                    node.status === "awaiting_approval"
                      ? "border-warning/30 text-warning"
                      : "border-info/30 text-info"
                  )}
                >
                  {node.status === "awaiting_approval" ? "Approval" : "Judgment"}
                </Badge>
              }
            />
          ))
        )}
      </div>
    </div>
  )
}

// --- Context dropdown ---

function ContextDropdown({
  currentContext,
  onSelect,
}: {
  currentContext?: GtdContext
  onSelect: (ctx: GtdContext) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
          currentContext
            ? "text-muted-foreground hover:bg-muted"
            : "text-primary hover:bg-primary/10"
        )}
        title={currentContext ? "Change context" : "Set context & move to Next Actions"}
      >
        {currentContext ? (
          <>
            {currentContext}
            <ChevronDown className="h-3 w-3" />
          </>
        ) : (
          <>
            <Zap className="h-3 w-3" />
            <ChevronDown className="h-3 w-3" />
          </>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-lg border border-border bg-popover shadow-lg py-1">
            {GTD_CONTEXTS.map((ctx) => (
              <button
                key={ctx}
                type="button"
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors",
                  ctx === currentContext && "bg-muted font-medium"
                )}
                onClick={() => {
                  onSelect(ctx)
                  setOpen(false)
                }}
              >
                {ctx}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// --- Quick capture ---

function QuickCapture({ onCapture }: { onCapture: (title: string) => void }) {
  const [value, setValue] = useState("")

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const trimmed = value.trim()
      if (!trimmed) return
      onCapture(trimmed)
      setValue("")
    },
    [value, onCapture]
  )

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <div className="relative flex-1">
        <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Quick capture — add to inbox..."
          className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>
      <button
        type="submit"
        disabled={!value.trim()}
        className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Add
      </button>
    </form>
  )
}

// --- Main page ---

export function GtdPage() {
  const rawNodes = usePlanStore((s) => s.nodes)
  const allNodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const updateNode = usePlanStore((s) => s.updateNode)
  const addNode = usePlanStore((s) => s.addNode)
  const projects = useProjectStore((s) => s.projects)

  const projectMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projects) {
      map.set(p.id, p.name)
    }
    return map
  }, [projects])

  // Filter out milestones and completed/pruned tasks, then categorize
  const tasks = useMemo(
    () => allNodes.filter((n) => n.type !== "milestone"),
    [allNodes]
  )

  const inboxTasks = useMemo(() => tasks.filter(isInbox), [tasks])
  const nextActionTasks = useMemo(() => tasks.filter(isNextAction), [tasks])
  const waitingForTasks = useMemo(() => tasks.filter(isWaitingFor), [tasks])

  const handleMoveToNextAction = useCallback(
    (nodeId: string, context: GtdContext) => {
      const node = allNodes.find((n) => n.id === nodeId)
      if (!node) return
      updateNode(nodeId, {
        metadata: {
          ...node.metadata,
          "gtd-next-action": true,
          "gtd-context": context,
        },
      })
    },
    [allNodes, updateNode]
  )

  const handleChangeContext = useCallback(
    (nodeId: string, context: GtdContext) => {
      const node = allNodes.find((n) => n.id === nodeId)
      if (!node) return
      updateNode(nodeId, {
        metadata: {
          ...node.metadata,
          "gtd-context": context,
        },
      })
    },
    [allNodes, updateNode]
  )

  const handleRemoveFromNextActions = useCallback(
    (nodeId: string) => {
      const node = allNodes.find((n) => n.id === nodeId)
      if (!node) return
      const meta = { ...node.metadata }
      delete meta["gtd-next-action"]
      delete meta["gtd-context"]
      updateNode(nodeId, { metadata: meta })
    },
    [allNodes, updateNode]
  )

  const handleQuickCapture = useCallback(
    (title: string) => {
      const firstProject = projects[0]
      if (!firstProject) return
      const now = new Date()
      const newNode: PlanNode = {
        id: crypto.randomUUID(),
        projectId: firstProject.id,
        type: "task",
        title,
        description: "",
        status: "planned",
        parentId: null,
        dependencies: [],
        verification: "auto",
        position: { x: 0, y: 0 },
        createdAt: now,
        updatedAt: now,
      }
      addNode(newNode)
    },
    [projects, addNode]
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">GTD Workflow</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Getting Things Done — capture, clarify, organize, and act
        </p>
      </div>

      <QuickCapture onCapture={handleQuickCapture} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <InboxColumn
          tasks={inboxTasks}
          projectMap={projectMap}
          onMoveToNextAction={handleMoveToNextAction}
        />
        <NextActionsColumn
          tasks={nextActionTasks}
          projectMap={projectMap}
          onChangeContext={handleChangeContext}
          onRemoveFromNextActions={handleRemoveFromNextActions}
        />
        <WaitingForColumn
          tasks={waitingForTasks}
          projectMap={projectMap}
        />
      </div>
    </div>
  )
}

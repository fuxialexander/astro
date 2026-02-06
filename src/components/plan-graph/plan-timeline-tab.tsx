import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { usePlanStore } from "@/stores/plan-store"
import type { PlanNode, PlanEdge } from "@/types"

const DAY_WIDTH = 20

const statusColors: Record<string, string> = {
  completed: "bg-green-500",
  auto_verified: "bg-green-500",
  in_progress: "bg-blue-500",
  dispatched: "bg-blue-500",
  awaiting_judgment: "bg-amber-500",
  planned: "bg-primary/70",
  pruned: "bg-border opacity-40",
}

const progressColors: Record<string, string> = {
  in_progress: "bg-blue-700",
  dispatched: "bg-blue-700",
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000)
}

function snapToMonday(d: Date): Date {
  const day = d.getUTCDay()
  const diff = day === 0 ? 6 : day - 1
  return addDays(d, -diff)
}

/**
 * Topological sort + assign default dates to nodes missing startDate/endDate.
 * Milestones keep their authored dates. Tasks get auto-derived positions.
 */
function assignDefaultDates(nodes: PlanNode[], edges: PlanEdge[]): PlanNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, { ...n }]))

  const inDeps = new Map<string, string[]>()
  for (const n of nodes) inDeps.set(n.id, [])
  for (const e of edges) {
    inDeps.get(e.target)?.push(e.source)
  }

  for (const n of nodes) {
    const list = inDeps.get(n.id) || []
    for (const dep of n.dependencies) {
      if (!list.includes(dep)) list.push(dep)
    }
    inDeps.set(n.id, list)
  }

  // Kahn's topological sort
  const inDegree = new Map<string, number>()
  for (const n of nodes) inDegree.set(n.id, inDeps.get(n.id)!.length)
  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const sorted: string[] = []
  const outEdges = new Map<string, string[]>()
  for (const n of nodes) outEdges.set(n.id, [])
  for (const e of edges) {
    outEdges.get(e.source)?.push(e.target)
  }
  for (const n of nodes) {
    for (const dep of n.dependencies) {
      const outs = outEdges.get(dep) || []
      if (!outs.includes(n.id)) outs.push(n.id)
      outEdges.set(dep, outs)
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!
    sorted.push(id)
    for (const next of outEdges.get(id) || []) {
      const deg = (inDegree.get(next) || 1) - 1
      inDegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
  }

  for (const n of nodes) {
    if (!sorted.includes(n.id)) sorted.push(n.id)
  }

  const today = fmtDate(new Date())

  for (const id of sorted) {
    const node = nodeMap.get(id)!
    if (node.startDate && node.endDate) continue

    const deps = inDeps.get(id) || []
    let earliest = today
    for (const depId of deps) {
      const dep = nodeMap.get(depId)
      if (dep?.endDate && dep.endDate > earliest) {
        earliest = dep.endDate
      }
    }

    if (!node.startDate) {
      node.startDate = earliest
    }
    if (!node.endDate) {
      const duration = node.type === "milestone" ? 0 : 3
      node.endDate = fmtDate(addDays(parseDate(node.startDate), duration))
    }
  }

  return nodes.map((n) => nodeMap.get(n.id)!)
}

interface PlanTimelineTabProps {
  projectId: string
}

export function PlanTimelineTab({ projectId }: PlanTimelineTabProps) {
  const nodes = usePlanStore((s) => s.nodes)
  const edges = usePlanStore((s) => s.edges)
  const updateNode = usePlanStore((s) => s.updateNode)

  const [editingNode, setEditingNode] = useState<PlanNode | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editDesc, setEditDesc] = useState("")
  const [editStart, setEditStart] = useState("")
  const [editEnd, setEditEnd] = useState("")

  const projectEdges = useMemo(() => {
    const nodeIds = new Set(nodes.filter((n) => n.projectId === projectId).map((n) => n.id))
    return edges.filter((e) => nodeIds.has(e.source) || nodeIds.has(e.target))
  }, [nodes, edges, projectId])

  const projectNodes = useMemo(() => {
    const raw = nodes.filter((n) => n.projectId === projectId)
    return assignDefaultDates(raw, projectEdges)
  }, [nodes, projectId, projectEdges])

  const { timelineStart, weeks } = useMemo(() => {
    if (projectNodes.length === 0) {
      const now = new Date()
      const start = snapToMonday(now)
      return {
        timelineStart: start,
        weeks: Array.from({ length: 4 }, (_, i) => {
          const d = addDays(start, i * 7)
          return fmtDate(d)
        }),
      }
    }

    let minDate = parseDate(projectNodes[0].startDate!)
    let maxDate = parseDate(projectNodes[0].endDate!)
    for (const n of projectNodes) {
      const s = parseDate(n.startDate!)
      const e = parseDate(n.endDate!)
      if (s < minDate) minDate = s
      if (e > maxDate) maxDate = e
    }

    const start = snapToMonday(addDays(minDate, -7))
    const end = addDays(maxDate, 7)
    const totalDays = diffDays(start, end)
    const numWeeks = Math.max(4, Math.ceil(totalDays / 7))

    return {
      timelineStart: start,
      weeks: Array.from({ length: numWeeks }, (_, i) => {
        const d = addDays(start, i * 7)
        return fmtDate(d)
      }),
    }
  }, [projectNodes])

  const totalWidth = weeks.length * 7 * DAY_WIDTH

  const todayOffset = useMemo(() => {
    const today = new Date()
    const days = diffDays(timelineStart, today)
    return days * DAY_WIDTH
  }, [timelineStart])

  const isMilestone = editingNode?.type === "milestone"

  function openEdit(node: PlanNode) {
    setEditingNode(node)
    setEditTitle(node.title)
    setEditDesc(node.description)
    setEditStart(node.startDate || "")
    setEditEnd(node.endDate || "")
  }

  function saveEdit() {
    if (!editingNode) return
    const updates: Partial<PlanNode> = {
      title: editTitle,
      description: editDesc,
    }
    // Only save dates for milestones
    if (editingNode.type === "milestone") {
      if (editEnd < editStart) return
      updates.startDate = editStart
      updates.endDate = editEnd
    }
    updateNode(editingNode.id, updates)
    setEditingNode(null)
  }

  const weekColWidth = 7 * DAY_WIDTH

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Task labels */}
      <div className="w-[240px] shrink-0 border-r border-border">
        <div className="flex h-10 items-center border-b border-border px-4">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase">Tasks</span>
        </div>
        {projectNodes.map((node) => (
          <div
            key={node.id}
            className="flex h-11 items-center border-b border-border px-4 cursor-pointer hover:bg-secondary/50"
            onClick={() => openEdit(node)}
          >
            <span className={`truncate text-xs ${node.status === "pruned" ? "text-muted-foreground line-through" : ""}`}>
              {node.type === "milestone" ? "◆ " : ""}{node.title}
            </span>
          </div>
        ))}
      </div>

      {/* Gantt area */}
      <div className="flex-1 overflow-auto relative">
        <div className="sticky top-0 flex h-10 items-center border-b border-border bg-background z-10" style={{ width: `${totalWidth}px` }}>
          {weeks.map((w) => {
            const d = parseDate(w)
            const label = `${d.toLocaleString("default", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}`
            return (
              <span key={w} className="shrink-0 text-center text-[11px] text-muted-foreground font-primary" style={{ width: `${weekColWidth}px` }}>
                {label}
              </span>
            )
          })}
        </div>

        <div className="absolute top-10 left-0 bottom-0" style={{ width: `${totalWidth}px` }}>
          {weeks.map((_, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-px bg-border opacity-30"
              style={{ left: `${i * weekColWidth}px` }}
            />
          ))}
          {todayOffset > 0 && todayOffset < totalWidth && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-primary opacity-60"
              style={{ left: `${todayOffset}px` }}
            />
          )}
        </div>

        <div className="relative" style={{ width: `${totalWidth}px` }}>
          {projectNodes.map((node) => {
            const start = parseDate(node.startDate!)
            const end = parseDate(node.endDate!)
            const barLeft = diffDays(timelineStart, start) * DAY_WIDTH
            const barWidth = Math.max(diffDays(start, end) * DAY_WIDTH, 6)
            return (
              <div key={node.id} className="flex h-11 items-center border-b border-border relative">
                <div
                  className={`absolute h-5 rounded cursor-pointer hover:brightness-110 transition-all ${statusColors[node.status]} ${node.type === "milestone" ? "!rounded-sm" : ""}`}
                  style={{ left: `${barLeft}px`, width: `${barWidth}px` }}
                  onClick={() => openEdit(node)}
                >
                  {progressColors[node.status] && (
                    <div
                      className={`h-full rounded-l ${progressColors[node.status]}`}
                      style={{ width: "40%" }}
                    />
                  )}
                  {barWidth > 30 && (
                    <span className="absolute left-2 top-0.5 text-[10px] font-medium text-white truncate" style={{ maxWidth: `${barWidth - 16}px` }}>
                      {node.title}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingNode} onOpenChange={(open) => { if (!open) setEditingNode(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {isMilestone ? "Milestone" : "Task"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Title</label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
              <textarea
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[80px] resize-none"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
              />
            </div>
            {/* Only show date fields for milestones */}
            {isMilestone && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Start Date</label>
                  <Input type="date" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">End Date</label>
                  <Input type="date" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
                </div>
              </div>
            )}
            {!isMilestone && (
              <p className="text-xs text-muted-foreground">
                Tasks don't have dates. Their timeline position is derived from dependencies.
              </p>
            )}
            {isMilestone && editEnd && editStart && editEnd < editStart && (
              <p className="text-xs text-destructive">End date must be on or after start date.</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setEditingNode(null)}>Cancel</Button>
              <Button size="sm" onClick={saveEdit} disabled={!!(isMilestone && editEnd && editStart && editEnd < editStart)}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { useMemo, useState, useRef, useCallback, useEffect } from "react"
import { X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { usePlanStore } from "@/stores/plan-store"
import { useBarDragResize } from "@/hooks/use-bar-drag-resize"
import { PRIORITIES, ESTIMATES, PRIORITY_CONFIG } from "@/lib/constants"
import { statusBarColors, statusProgressColors } from "@/lib/status-config"
import {
  DAY_WIDTH,
  parseDate,
  fmtDate,
  diffDays,
  addDays,
  snapToMonday,
  assignDefaultDates,
} from "@/lib/timeline-utils"
import type { PlanNode, Priority, Estimate } from "@/types"

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
  const [editPriority, setEditPriority] = useState<Priority>("none")
  const [editEstimate, setEditEstimate] = useState<Estimate | "">("")
  const [editDueDate, setEditDueDate] = useState("")
  const [editMilestoneId, setEditMilestoneId] = useState("")

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

  const timelineStartRef = useRef(timelineStart)
  useEffect(() => { timelineStartRef.current = timelineStart }, [timelineStart])

  const handleDragCommit = useCallback((nodeId: string, startDate: string, endDate: string) => {
    updateNode(nodeId, { startDate, endDate })
  }, [updateNode])

  const { handleMouseDown: handleDragMouseDown } = useBarDragResize({
    getPpd: () => DAY_WIDTH,
    getTimelineStart: () => timelineStartRef.current,
    onCommit: handleDragCommit,
  })

  const todayOffset = useMemo(() => {
    const today = new Date()
    const days = diffDays(timelineStart, today)
    return days * DAY_WIDTH
  }, [timelineStart])

  const isMilestone = editingNode?.type === "milestone"

  const milestoneNodes = useMemo(() => {
    return nodes.filter((n) => n.projectId === projectId && n.type === "milestone")
  }, [nodes, projectId])

  function openEdit(node: PlanNode) {
    setEditingNode(node)
    setEditTitle(node.title)
    setEditDesc(node.description)
    setEditStart(node.startDate || "")
    setEditEnd(node.endDate || "")
    setEditPriority(node.priority || "none")
    setEditEstimate(node.estimate || "")
    setEditDueDate(node.dueDate || "")
    setEditMilestoneId(node.milestoneId || "")
  }

  function saveEdit() {
    if (!editingNode) return
    const updates: Partial<PlanNode> = {
      title: editTitle,
      description: editDesc,
      priority: editPriority === "none" ? undefined : editPriority,
      estimate: editEstimate || undefined,
      dueDate: editDueDate || undefined,
      milestoneId: editMilestoneId || undefined,
    }
    if (editStart && editEnd) {
      if (editEnd < editStart) return
      updates.startDate = editStart
      updates.endDate = editEnd
    }
    updateNode(editingNode.id, updates)
    setEditingNode(null)
  }

  const weekColWidth = 7 * DAY_WIDTH

  return (
    <div className="flex flex-1 overflow-hidden relative">
      {/* Task labels */}
      <div className="w-[240px] shrink-0 border-r border-border">
        <div className="flex h-10 items-center border-b border-border px-4">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase">Tasks</span>
        </div>
        {projectNodes.map((node) => {
          // Compute milestone completion
          const milestoneCompletion = node.type === "milestone" ? (() => {
            const tasks = nodes.filter((n) => n.milestoneId === node.id && n.type !== "milestone")
            if (tasks.length === 0) return null
            const done = tasks.filter((t) => t.status === "completed" || t.status === "auto_verified").length
            return Math.round((done / tasks.length) * 100)
          })() : null

          return (
            <div
              key={node.id}
              className="flex h-11 items-center border-b border-border px-4 cursor-pointer hover:bg-secondary/50"
              onClick={() => openEdit(node)}
            >
              <span className={`truncate text-xs flex-1 ${node.status === "pruned" ? "text-muted-foreground line-through" : ""}`}>
                {node.type === "milestone" ? "◆ " : ""}{node.title}
              </span>
              {milestoneCompletion !== null && (
                <span className="text-[10px] text-muted-foreground ml-1">{milestoneCompletion}%</span>
              )}
            </div>
          )
        })}
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

            // Due date marker
            const hasDueDate = !!node.dueDate
            const dueDateOffset = hasDueDate ? diffDays(timelineStart, parseDate(node.dueDate!)) * DAY_WIDTH : 0
            const isDueDateOverdue = hasDueDate && (() => {
              const due = parseDate(node.dueDate!)
              const today = new Date()
              today.setHours(0, 0, 0, 0)
              return due < today && node.status !== "completed" && node.status !== "pruned" && node.status !== "auto_verified"
            })()

            return (
              <div key={node.id} className="flex h-11 items-center border-b border-border relative">
                <div
                  className={`absolute h-5 rounded cursor-pointer hover:brightness-110 transition-all timeline-bar ${statusBarColors[node.status]} ${node.type === "milestone" ? "!rounded-sm" : ""}`}
                  style={{ left: `${barLeft}px`, width: `${barWidth}px` }}
                  onClick={() => openEdit(node)}
                >
                  {statusProgressColors[node.status] && (
                    <div
                      className={`h-full rounded-l ${statusProgressColors[node.status]}`}
                      style={{ width: "40%" }}
                    />
                  )}
                  {barWidth > 30 && (
                    <span className="absolute left-2 top-0.5 text-[10px] font-medium text-white truncate" style={{ maxWidth: `${barWidth - 16}px` }}>
                      {node.title}
                    </span>
                  )}
                  <div
                    className="drag-handle absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize flex items-center justify-center"
                    onMouseDown={(e) => handleDragMouseDown(e, "left", node.id, e.currentTarget.parentElement!, fmtDate(start), fmtDate(end))}
                  >
                    <div className="w-0.5 h-3 rounded-full bg-white/60" />
                  </div>
                  <div
                    className="drag-handle absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize flex items-center justify-center"
                    onMouseDown={(e) => handleDragMouseDown(e, "right", node.id, e.currentTarget.parentElement!, fmtDate(start), fmtDate(end))}
                  >
                    <div className="w-0.5 h-3 rounded-full bg-white/60" />
                  </div>
                </div>
                {/* Due date marker */}
                {hasDueDate && (
                  <div
                    className={`absolute top-2 w-0.5 h-7 ${isDueDateOverdue ? "bg-red-500" : "bg-orange-400"}`}
                    style={{ left: `${dueDateOffset}px` }}
                    title={`Due: ${node.dueDate}`}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Floating edit panel */}
      {editingNode && (
        <div className="absolute top-2 right-2 bottom-2 w-[340px] z-20 flex flex-col rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 h-11 border-b border-border shrink-0">
            <span className="text-sm font-semibold">Edit {isMilestone ? "Milestone" : "Task"}</span>
            <button onClick={() => setEditingNode(null)} className="rounded-sm p-0.5 opacity-70 hover:opacity-100 transition-opacity cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
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
            {editEnd && editStart && editEnd < editStart && (
              <p className="text-xs text-destructive">End date must be on or after start date.</p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Priority</label>
                <select
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value as Priority)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{PRIORITY_CONFIG[p].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Estimate</label>
                <select
                  value={editEstimate}
                  onChange={(e) => setEditEstimate(e.target.value as Estimate | "")}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">—</option>
                  {ESTIMATES.map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Due Date</label>
                <Input type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} />
              </div>
              {!isMilestone && milestoneNodes.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Milestone</label>
                  <select
                    value={editMilestoneId}
                    onChange={(e) => setEditMilestoneId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">—</option>
                    {milestoneNodes.map((m) => (
                      <option key={m.id} value={m.id}>◆ {m.title}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setEditingNode(null)}>Cancel</Button>
              <Button size="sm" onClick={saveEdit} disabled={!!(editEnd && editStart && editEnd < editStart)}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

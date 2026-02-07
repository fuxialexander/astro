import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { usePlanStore } from "@/stores/plan-store"
import { PRIORITIES, ESTIMATES } from "@/lib/constants"
import { cn } from "@/lib/utils"
import type { PlanNode, PlanEdge, Priority, Estimate } from "@/types"

interface TaskCreationFormProps {
  projectId: string
  parentNodeId?: string
  defaultMilestoneId?: string
  position?: { x: number; y: number }
  mode: "inline" | "popover" | "dialog"
  onCreated?: (node: PlanNode) => void
  onCancel?: () => void
}

export function TaskCreationForm({
  projectId,
  parentNodeId,
  defaultMilestoneId,
  position,
  mode,
  onCreated,
  onCancel,
}: TaskCreationFormProps) {
  const addNode = usePlanStore((s) => s.addNode)
  const addEdge = usePlanStore((s) => s.addEdge)

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [showDescription, setShowDescription] = useState(false)
  const [nodeType, setNodeType] = useState<"task" | "milestone">("task")
  const [priority, setPriority] = useState<Priority>("none")
  const [estimate, setEstimate] = useState<Estimate | "">("")
  const [dueDate, setDueDate] = useState("")
  const [milestoneId, setMilestoneId] = useState(defaultMilestoneId ?? "")
  const [createMore, setCreateMore] = useState(false)

  const titleRef = useRef<HTMLInputElement>(null)

  // Get milestones for the project
  const milestones = usePlanStore((s) =>
    s.nodes.filter((n) => n.projectId === projectId && n.type === "milestone")
  )

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  const resetForm = useCallback(() => {
    setTitle("")
    setDescription("")
    setShowDescription(false)
    setNodeType("task")
    setPriority("none")
    setEstimate("")
    setDueDate("")
    setMilestoneId(defaultMilestoneId ?? "")
  }, [defaultMilestoneId])

  const handleCreate = useCallback(() => {
    if (!title.trim()) return

    const nodeId = crypto.randomUUID()
    const now = new Date()

    const newNode: PlanNode = {
      id: nodeId,
      projectId,
      type: nodeType,
      title: title.trim(),
      description: description.trim(),
      status: "planned",
      parentId: null,
      dependencies: parentNodeId ? [parentNodeId] : [],
      verification: nodeType === "milestone" ? "human" : "auto",
      position: position ?? { x: 40, y: 40 },
      priority: nodeType === "task" ? priority : undefined,
      estimate: nodeType === "task" && estimate ? (estimate as Estimate) : undefined,
      dueDate: dueDate || undefined,
      milestoneId: milestoneId || undefined,
      createdAt: now,
      updatedAt: now,
    }

    addNode(newNode)

    if (parentNodeId) {
      const edgeId = crypto.randomUUID()
      const newEdge: PlanEdge = {
        id: edgeId,
        source: parentNodeId,
        target: nodeId,
        type: "dependency",
      }
      addEdge(newEdge)
    }

    onCreated?.(newNode)

    if (createMore) {
      resetForm()
      titleRef.current?.focus()
    } else {
      onCancel?.()
    }
  }, [
    title, description, nodeType, priority, estimate, dueDate, milestoneId,
    projectId, parentNodeId, position, createMore,
    addNode, addEdge, onCreated, onCancel, resetForm,
  ])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleCreate()
    }
    if (e.key === "Escape") {
      e.preventDefault()
      onCancel?.()
    }
  }, [handleCreate, onCancel])

  const isInline = mode === "inline"
  const isPopover = mode === "popover"

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        isPopover && "w-[320px] rounded-lg border border-border bg-card p-3 shadow-lg",
        isInline && "px-6 py-2 border-b border-border",
        mode === "dialog" && "gap-3"
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Title input */}
      <input
        ref={titleRef}
        type="text"
        placeholder="Task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={cn(
          "w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground",
          mode === "dialog" && "text-base"
        )}
      />

      {/* Description */}
      {showDescription ? (
        <textarea
          placeholder="Add description..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full resize-none bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground"
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowDescription(true)}
          className="text-left text-xs text-muted-foreground hover:text-foreground cursor-pointer"
        >
          Add description...
        </button>
      )}

      {/* Property row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={nodeType}
          onChange={(e) => setNodeType(e.target.value as "task" | "milestone")}
          className="h-7 rounded-md border border-border bg-background px-2 text-xs cursor-pointer"
        >
          <option value="task">Task</option>
          <option value="milestone">Milestone</option>
        </select>

        {nodeType === "task" && (
          <>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="h-7 rounded-md border border-border bg-background px-2 text-xs cursor-pointer"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </select>

            <select
              value={estimate}
              onChange={(e) => setEstimate(e.target.value as Estimate | "")}
              className="h-7 rounded-md border border-border bg-background px-2 text-xs cursor-pointer"
            >
              <option value="">Est.</option>
              {ESTIMATES.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </>
        )}

        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="h-7 rounded-md border border-border bg-background px-2 text-xs cursor-pointer"
        />

        {milestones.length > 0 && (
          <select
            value={milestoneId}
            onChange={(e) => setMilestoneId(e.target.value)}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs cursor-pointer max-w-[120px]"
          >
            <option value="">Milestone</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </select>
        )}
      </div>

      {/* Action row */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none mr-auto">
          <input
            type="checkbox"
            checked={createMore}
            onChange={(e) => setCreateMore(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Create more
        </label>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={handleCreate} disabled={!title.trim()}>
          Create
        </Button>
      </div>
    </div>
  )
}

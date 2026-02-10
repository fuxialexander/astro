import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core"
import {
  Circle,
  Send,
  Loader,
  CheckCircle2,
  Eye,
  Scissors,
  AlertTriangle,
  ArrowUp,
  Minus,
  ArrowDown,
} from "lucide-react"
import { BoardColumn, type DragMode } from "./board-column"
import { BoardCard } from "./board-card"
import type { PlanNode, Priority } from "@/types"

type ColumnBy = "status" | "priority" | "milestone"

interface ColumnDef {
  id: string
  label: string
  icon?: React.ReactNode
  acceptsDrop?: boolean
}

// --- Status columns ---
const STATUS_COLUMNS: ColumnDef[] = [
  { id: "planned", label: "Planned", icon: <Circle className="h-3.5 w-3.5 text-muted-foreground" /> },
  { id: "dispatched", label: "Dispatched", icon: <Send className="h-3.5 w-3.5 text-blue-500" /> },
  { id: "in_progress", label: "In Progress", icon: <Loader className="h-3.5 w-3.5 text-blue-500" /> },
  { id: "auto_verified", label: "Auto Verified", icon: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> },
  { id: "awaiting_judgment", label: "Needs Review", icon: <Eye className="h-3.5 w-3.5 text-amber-500" /> },
  { id: "completed", label: "Completed", icon: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> },
  { id: "pruned", label: "Pruned", icon: <Scissors className="h-3.5 w-3.5 text-muted-foreground" />, acceptsDrop: false },
]

const COMPLETED_STATUSES = new Set(["completed", "auto_verified", "pruned"])

// --- Priority columns ---
const PRIORITY_COLUMNS: ColumnDef[] = [
  { id: "urgent", label: "Urgent", icon: <AlertTriangle className="h-3.5 w-3.5 text-red-500" /> },
  { id: "high", label: "High", icon: <ArrowUp className="h-3.5 w-3.5 text-orange-500" /> },
  { id: "medium", label: "Medium", icon: <Minus className="h-3.5 w-3.5 text-yellow-500" /> },
  { id: "low", label: "Low", icon: <ArrowDown className="h-3.5 w-3.5 text-blue-500" /> },
  { id: "none", label: "None", icon: <Circle className="h-3.5 w-3.5 text-muted-foreground" /> },
]

interface BoardViewProps {
  nodes: PlanNode[]
  columnBy: ColumnBy
  visibleProperties: string[]
  showCompleted: boolean
  orderBy?: string
  orderDirection?: "asc" | "desc"
  milestones?: PlanNode[]
  projectName?: (node: PlanNode) => string | undefined
  onNodeSelect?: (node: PlanNode) => void
  onNodeUpdate?: (id: string, updates: Partial<PlanNode>) => void
  onAddTask?: (columnId: string) => void
}

/** Column label for the catch-all "unset" bucket per columnBy */
const UNSET_COLUMN: Record<ColumnBy, { id: string; label: string }> = {
  status: { id: "planned", label: "Planned" },
  priority: { id: "none", label: "None" },
  milestone: { id: "unassigned", label: "Unassigned" },
}

function getColumnId(node: PlanNode, columnBy: ColumnBy): string {
  switch (columnBy) {
    case "status":
      return node.status || "planned"
    case "priority":
      return node.priority || "none"
    case "milestone":
      return node.milestoneId || "unassigned"
  }
}

function columnIdToNodeUpdate(columnId: string, columnBy: ColumnBy): Partial<PlanNode> {
  switch (columnBy) {
    case "status":
      return { status: columnId as PlanNode["status"] }
    case "priority":
      return { priority: columnId as Priority }
    case "milestone":
      return { milestoneId: columnId === "unassigned" ? undefined : columnId }
  }
}

/* ── Ordering helpers ── */
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }
const STATUS_RANK: Record<string, number> = { planned: 0, dispatched: 1, in_progress: 2, auto_verified: 3, awaiting_judgment: 4, completed: 5, pruned: 6 }

/** Numeric sort value for a node by a given property */
function orderValue(node: PlanNode, prop: string): number {
  switch (prop) {
    case "priority": return PRIORITY_RANK[node.priority ?? "none"] ?? 4
    case "status": return STATUS_RANK[node.status] ?? 0
    case "dueDate": return node.dueDate ? new Date(node.dueDate).getTime() : Infinity
    case "updatedAt": return node.updatedAt ? new Date(node.updatedAt).getTime() : 0
    default: return 0
  }
}

/** Compare two nodes by an ordering property (0 = equal) */
function compareByOrderProp(a: PlanNode, b: PlanNode, prop: string): number {
  if (prop === "name") return a.title.localeCompare(b.title)
  return orderValue(a, prop) - orderValue(b, prop)
}

/** Extract a property update to make `node` match `source`'s ordering value */
function extractOrderProp(source: PlanNode, prop: string): Partial<PlanNode> {
  switch (prop) {
    case "priority": return { priority: source.priority ?? "none" }
    case "dueDate": return source.dueDate ? { dueDate: source.dueDate } : {}
    case "estimate": return source.estimate ? { estimate: source.estimate } : {}
    default: return {}
  }
}

/**
 * Compute the property update for a reorder drop.
 * If the card's value is already between neighbors → no change.
 * If it would sort above the upper neighbor → set to upper's value.
 * If it would sort below the lower neighbor → set to lower's value.
 */
function computeReorderPropertyUpdate(
  node: PlanNode,
  upper: PlanNode | null,
  lower: PlanNode | null,
  prop: string,
  direction: "asc" | "desc",
): Partial<PlanNode> {
  // name/status/updatedAt are not updatable via reorder
  if (prop === "name" || prop === "status" || prop === "updatedAt") return {}

  const val = orderValue(node, prop)
  const asc = direction === "asc"

  // In ascending: upper has smaller-or-equal value, lower has larger-or-equal
  // In descending: upper has larger-or-equal value, lower has smaller-or-equal
  const aboveUpper = upper != null && (asc
    ? val < orderValue(upper, prop)
    : val > orderValue(upper, prop))
  const belowLower = lower != null && (asc
    ? val > orderValue(lower, prop)
    : val < orderValue(lower, prop))

  if (!aboveUpper && !belowLower) return {} // already between
  if (aboveUpper && upper) return extractOrderProp(upper, prop)
  if (belowLower && lower) return extractOrderProp(lower, prop)
  return {}
}

/** Compute insert index from pointer Y vs card midpoints in a column DOM element */
function computeInsertIndex(columnEl: Element, pointerY: number, activeId: string | null): number {
  const cards = columnEl.querySelectorAll("[data-card-id]")
  let insertIdx = 0
  for (const card of cards) {
    const cardId = card.getAttribute("data-card-id")
    if (cardId === activeId) continue // skip the dragged card
    const rect = card.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    if (pointerY > midY) {
      insertIdx++
    } else {
      break
    }
  }
  return insertIdx
}

export function BoardView({
  nodes,
  columnBy,
  visibleProperties,
  showCompleted,
  orderBy,
  orderDirection = "asc",
  milestones = [],
  projectName,
  onNodeSelect,
  onNodeUpdate,
  onAddTask,
}: BoardViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dragMode, setDragMode] = useState<DragMode>("column")
  const [overColumnId, setOverColumnId] = useState<string | null>(null)
  const [reorderInsertIndex, setReorderInsertIndex] = useState<number | null>(null)
  const reorderInsertIndexRef = useRef<number | null>(null)
  const overColumnIdRef = useRef<string | null>(null)
  const activeIdRef = useRef<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  )

  const dragModeRef = useRef(dragMode)
  useEffect(() => { dragModeRef.current = dragMode }, [dragMode])

  // Track meta key state during drag
  useEffect(() => {
    if (!activeId) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey) setDragMode("reorder")
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (!e.metaKey && !e.ctrlKey) setDragMode("column")
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
    }
  }, [activeId])

  // Continuously update insert index during drag via pointermove
  useEffect(() => {
    if (!activeId) return

    function handlePointerMove(e: PointerEvent) {
      if (dragModeRef.current !== "reorder") return

      // Find which column the pointer is over by checking data-column-id elements
      const columnEls = document.querySelectorAll("[data-column-id]")
      let targetCol: Element | null = null
      let targetColId: string | null = null
      for (const el of columnEls) {
        const rect = el.getBoundingClientRect()
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          targetCol = el
          targetColId = el.getAttribute("data-column-id")
          break
        }
      }

      if (!targetCol || !targetColId) return

      // Update over column if changed
      if (targetColId !== overColumnIdRef.current) {
        overColumnIdRef.current = targetColId
        setOverColumnId(targetColId)
      }

      const idx = computeInsertIndex(targetCol, e.clientY, activeIdRef.current)
      if (idx !== reorderInsertIndexRef.current) {
        reorderInsertIndexRef.current = idx
        setReorderInsertIndex(idx)
      }
    }

    window.addEventListener("pointermove", handlePointerMove)
    return () => window.removeEventListener("pointermove", handlePointerMove)
  }, [activeId])

  // Compute columns based on columnBy
  const columns = useMemo((): ColumnDef[] => {
    switch (columnBy) {
      case "status":
        return STATUS_COLUMNS
      case "priority":
        return PRIORITY_COLUMNS
      case "milestone":
        return [
          ...milestones.map((m) => ({
            id: m.id,
            label: m.title,
          })),
          { id: "unassigned", label: "Unassigned" },
        ]
    }
  }, [columnBy, milestones])

  // Filter tasks (exclude milestones) and group into columns
  const filteredNodes = useMemo(() => {
    let tasks = nodes.filter((n) => n.type !== "milestone")
    if (!showCompleted && columnBy === "status") {
      tasks = tasks.filter((n) => !COMPLETED_STATUSES.has(n.status))
    } else if (!showCompleted) {
      tasks = tasks.filter((n) => n.status !== "completed" && n.status !== "auto_verified" && n.status !== "pruned")
    }
    return tasks
  }, [nodes, showCompleted, columnBy])

  // Track extra columns needed for tasks that don't match any predefined column
  const extraColumns = useMemo((): ColumnDef[] => {
    const knownIds = new Set(columns.map((c) => c.id))
    const extras = new Set<string>()
    for (const node of filteredNodes) {
      const colId = getColumnId(node, columnBy)
      if (!knownIds.has(colId)) {
        extras.add(colId)
      }
    }
    if (extras.size === 0) return []
    // Create catch-all columns for unmatched values
    return Array.from(extras).map((id) => ({
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, " "),
    }))
  }, [columns, filteredNodes, columnBy])

  const allColumns = useMemo(() => [...columns, ...extraColumns], [columns, extraColumns])

  const columnNodes = useMemo(() => {
    const map = new Map<string, PlanNode[]>()
    for (const col of allColumns) {
      map.set(col.id, [])
    }
    for (const node of filteredNodes) {
      const colId = getColumnId(node, columnBy)
      const list = map.get(colId)
      if (list) {
        list.push(node)
      } else {
        // Fallback: put in the unset bucket for this columnBy
        const fallbackId = UNSET_COLUMN[columnBy].id
        map.get(fallbackId)?.push(node)
      }
    }
    // Sort each column by orderBy property, boardOrder as tiebreaker
    const dir = orderDirection === "desc" ? -1 : 1

    for (const [, list] of map) {
      list.sort((a, b) => {
        if (orderBy) {
          const cmp = compareByOrderProp(a, b, orderBy)
          if (cmp !== 0) return cmp * dir
        }
        // Tiebreaker: boardOrder then insertion order
        return (a.boardOrder ?? Infinity) - (b.boardOrder ?? Infinity)
      })
    }
    return map
  }, [filteredNodes, allColumns, columnBy, orderBy, orderDirection])

  // Filter out columns with hidden completed statuses
  const visibleColumns = useMemo(() => {
    if (!showCompleted && columnBy === "status") {
      return allColumns.filter((c) => !COMPLETED_STATUSES.has(c.id))
    }
    return allColumns
  }, [allColumns, showCompleted, columnBy])

  const activeNode = activeId ? filteredNodes.find((n) => n.id === activeId) : null

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = event.active.id as string
    setActiveId(id)
    activeIdRef.current = id
    const nativeEvent = event.activatorEvent as MouseEvent | undefined
    const mode = nativeEvent && (nativeEvent.metaKey || nativeEvent.ctrlKey) ? "reorder" : "column"
    setDragMode(mode)
  }, [])

  // Helpers to keep refs in sync with state
  const updateOverColumnId = useCallback((val: string | null) => {
    setOverColumnId(val)
    overColumnIdRef.current = val
  }, [])
  const updateReorderInsertIndex = useCallback((val: number | null) => {
    setReorderInsertIndex(val)
    reorderInsertIndexRef.current = val
  }, [])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over, activatorEvent } = event
    if (!over) {
      updateOverColumnId(null)
      updateReorderInsertIndex(null)
      return
    }

    const overId = over.id as string

    // In dnd-kit, over.id is always a column (only columns are droppable)
    // For column mode: just track which column we're over
    // For reorder mode: compute insert index from pointer Y vs card DOM positions
    const isColumn = allColumns.some((c) => c.id === overId)
    if (!isColumn) return

    updateOverColumnId(overId)

    if (dragMode === "reorder") {
      // Compute pointer Y from activator event + delta
      const startY = (activatorEvent as MouseEvent)?.clientY
      const deltaY = event.delta?.y ?? 0
      const pointerY = startY != null ? startY + deltaY : null

      if (pointerY != null) {
        // Find the column DOM element and compute insert index from card positions
        const columnEl = document.querySelector(`[data-column-id="${overId}"]`)
        if (columnEl) {
          const idx = computeInsertIndex(columnEl, pointerY, activeIdRef.current)
          updateReorderInsertIndex(idx)
        }
      }
    }
  }, [allColumns, dragMode, updateOverColumnId, updateReorderInsertIndex])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const currentDragMode = dragMode
    const insertIdx = reorderInsertIndexRef.current
    const targetColId = overColumnIdRef.current

    setActiveId(null)
    activeIdRef.current = null
    setDragMode("column")
    updateOverColumnId(null)
    updateReorderInsertIndex(null)

    const { active, over } = event
    if (!over || !onNodeUpdate) return

    const nodeId = active.id as string
    const targetColumnId = targetColId ?? (over.id as string)

    if (!targetColumnId) return

    // Check if the column accepts drops
    const targetColumn = allColumns.find((c) => c.id === targetColumnId)
    if (targetColumn?.acceptsDrop === false) return

    const sourceNode = filteredNodes.find((n) => n.id === nodeId)
    if (!sourceNode) return
    const sourceColumnId = getColumnId(sourceNode, columnBy)

    if (currentDragMode === "column") {
      // Column mode: only update if column changed
      if (sourceColumnId === targetColumnId) return
      const update = columnIdToNodeUpdate(targetColumnId, columnBy)
      onNodeUpdate(nodeId, update)
    } else {
      // Reorder mode: update the dragged card's ordering property based on neighbors
      const colNodes = columnNodes.get(targetColumnId) ?? []
      const others = colNodes.filter((n) => n.id !== nodeId)
      const adjustedIdx = Math.min(insertIdx ?? others.length, others.length)

      const upper = adjustedIdx > 0 ? others[adjustedIdx - 1] : null
      const lower = adjustedIdx < others.length ? others[adjustedIdx] : null

      const updates: Partial<PlanNode> = {}

      // Update the ordering property if it would sort out of position
      if (orderBy) {
        Object.assign(updates, computeReorderPropertyUpdate(sourceNode, upper, lower, orderBy, orderDirection))
      }

      // Set boardOrder as tiebreaker (midpoint of neighbors)
      const upperOrder = upper?.boardOrder ?? -1
      const lowerOrder = lower?.boardOrder ?? ((upper?.boardOrder ?? -1) + 2)
      updates.boardOrder = (upperOrder + lowerOrder) / 2

      // Column change
      if (sourceColumnId !== targetColumnId) {
        Object.assign(updates, columnIdToNodeUpdate(targetColumnId, columnBy))
      }

      if (Object.keys(updates).length > 0) {
        onNodeUpdate(nodeId, updates)
      }
    }
  }, [allColumns, filteredNodes, columnBy, columnNodes, onNodeUpdate, dragMode, orderBy, orderDirection, updateOverColumnId, updateReorderInsertIndex])

  const handleDragCancel = useCallback(() => {
    setActiveId(null)
    activeIdRef.current = null
    setDragMode("column")
    updateOverColumnId(null)
    updateReorderInsertIndex(null)
  }, [updateOverColumnId, updateReorderInsertIndex])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex flex-1 gap-3 overflow-x-auto p-4">
        {visibleColumns.map((col) => (
          <BoardColumn
            key={col.id}
            id={col.id}
            label={col.label}
            icon={col.icon}
            nodes={columnNodes.get(col.id) ?? []}
            visibleProperties={visibleProperties}
            projectName={projectName}
            onNodeSelect={onNodeSelect}
            onNodeUpdate={onNodeUpdate}
            onAddTask={onAddTask ? () => onAddTask(col.id) : undefined}
            acceptsDrop={col.acceptsDrop}
            dragMode={activeId && overColumnId === col.id ? dragMode : "column"}
            reorderInsertIndex={activeId && overColumnId === col.id ? reorderInsertIndex : null}
            activeNodeId={activeId}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeNode ? (
          <BoardCard
            node={activeNode}
            visibleProperties={visibleProperties}
            projectName={projectName?.(activeNode)}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

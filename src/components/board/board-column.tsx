import { useDroppable } from "@dnd-kit/core"
import { Plus } from "lucide-react"
import { BoardCard } from "./board-card"
import { TaskCreationForm } from "@/components/task-creation-form"
import { cn } from "@/lib/utils"
import type { PlanNode } from "@/types"

export type DragMode = "column" | "reorder"

interface BoardColumnProps {
  id: string
  label: string
  icon?: React.ReactNode
  nodes: PlanNode[]
  visibleProperties: string[]
  projectName?: (node: PlanNode) => string | undefined
  onNodeSelect?: (node: PlanNode) => void
  onNodeUpdate?: (id: string, updates: Partial<PlanNode>) => void
  onAddTask?: () => void
  acceptsDrop?: boolean
  dragMode?: DragMode
  reorderInsertIndex?: number | null
  activeNodeId?: string | null
  fastEdit?: boolean
  projectId?: string
  isCreating?: boolean
  onCreatingChange?: (creating: boolean) => void
}

// Grey ghost card placeholder
function CardPlaceholder() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2.5 transition-all duration-150">
      <div className="h-4 w-2/3 rounded bg-muted" />
      <div className="mt-2 h-3 w-1/3 rounded bg-muted" />
    </div>
  )
}

export function BoardColumn({
  id,
  label,
  icon,
  nodes,
  visibleProperties,
  projectName,
  onNodeSelect,
  onNodeUpdate,
  onAddTask,
  acceptsDrop = true,
  dragMode = "column",
  reorderInsertIndex,
  activeNodeId,
  fastEdit,
  projectId,
  isCreating,
  onCreatingChange,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    disabled: !acceptsDrop,
  })

  const isDraggingInReorder = dragMode === "reorder" && reorderInsertIndex != null
  // Separate dragged card from others for clean index mapping
  const draggedNode = activeNodeId ? nodes.find((n) => n.id === activeNodeId) : null
  const otherNodes = activeNodeId ? nodes.filter((n) => n.id !== activeNodeId) : nodes

  return (
    <div className="flex w-[280px] shrink-0 flex-col">
      {/* Column header */}
      <div className="flex items-center gap-2 px-2 py-2.5">
        {icon}
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{nodes.length}</span>
      </div>

      {/* Card list */}
      <div
        ref={setNodeRef}
        data-column-id={id}
        className={cn(
          "flex-1 overflow-y-auto rounded-lg px-1 pb-2 transition-colors relative",
          isOver && acceptsDrop && dragMode === "column" && "bg-accent/20"
        )}
      >
        {/* Hidden dragged card — keeps useDraggable ref alive */}
        {draggedNode && (
          <div className="h-0 overflow-hidden" aria-hidden>
            <BoardCard
              node={draggedNode}
              visibleProperties={visibleProperties}
              projectName={projectName?.(draggedNode)}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {otherNodes.map((node, idx) => (
            <div key={node.id}>
              {/* Grey card placeholder before this card */}
              {isDraggingInReorder && reorderInsertIndex === idx && (
                <div className="mb-1.5">
                  <CardPlaceholder />
                </div>
              )}
              <div className="transition-transform duration-150 ease-in-out">
                <BoardCard
                  node={node}
                  visibleProperties={visibleProperties}
                  projectName={projectName?.(node)}
                  onNodeSelect={onNodeSelect}
                  onNodeUpdate={onNodeUpdate}
                  fastEdit={fastEdit}
                />
              </div>
            </div>
          ))}
          {/* Grey card placeholder at end */}
          {isDraggingInReorder && reorderInsertIndex === otherNodes.length && (
            <CardPlaceholder />
          )}
        </div>

        {otherNodes.length === 0 && !isDraggingInReorder && (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No tasks
          </div>
        )}

        {/* Add task — inline form inside the column */}
        {(onAddTask || onCreatingChange) && (
          isCreating && projectId ? (
            <div className="mt-1.5 rounded-lg border border-primary/40 bg-card p-2">
              <TaskCreationForm
                mode="inline"
                projectId={projectId}
                onCreated={() => onCreatingChange?.(false)}
                onCancel={() => onCreatingChange?.(false)}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onCreatingChange ? onCreatingChange(true) : onAddTask?.()}
              className="mt-1.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Add task
            </button>
          )
        )}
      </div>
    </div>
  )
}

import { useState, useCallback, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ListColumn<T> {
  id: string
  label: string
  width: string            // e.g. "w-[120px]" or "flex-1"
  render: (item: T) => ReactNode
  headerClassName?: string // extra classes for header cell
}

export interface ListGroup<T> {
  key: string
  label: string
  icon?: ReactNode
  items: T[]
  meta?: ReactNode          // e.g. "45% · 12 tasks"
}

interface ItemListViewProps<T> {
  columns: ListColumn<T>[]
  groups: ListGroup<T>[]
  visibleColumns: string[]
  onItemClick?: (item: T) => void
  getItemId: (item: T) => string
  getItemClass?: (item: T) => string
  renderItemName?: (item: T) => ReactNode
  emptyState?: ReactNode
  footer?: (groupKey: string) => ReactNode
  indentGroupedRows?: boolean
  showGroupHeaders?: boolean
}

export function ItemListView<T>({
  columns,
  groups,
  visibleColumns,
  onItemClick,
  getItemId,
  getItemClass,
  renderItemName,
  emptyState,
  footer,
  indentGroupedRows = true,
  showGroupHeaders = true,
}: ItemListViewProps<T>) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const nameCol = columns.find((c) => c.id === "name")
  const otherCols = columns.filter((c) => c.id !== "name" && visibleColumns.includes(c.id))
  const allEmpty = groups.every((g) => g.items.length === 0)
  const hasMultipleGroups = groups.length > 1

  if (allEmpty && emptyState) {
    return <div className="flex-1 overflow-auto">{emptyState}</div>
  }

  return (
    <>
      {/* Column headers */}
      <div className="flex items-center border-b border-border px-6 h-9 shrink-0">
        <span className={cn("text-[13px] font-medium text-muted-foreground", nameCol?.width ?? "flex-1")}>
          {nameCol?.label ?? "Name"}
        </span>
        {otherCols.map((col) => (
          <span key={col.id} className={cn("text-[13px] font-medium text-muted-foreground", col.width, col.headerClassName)}>
            {col.label}
          </span>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.key)
          return (
            <div key={group.key}>
              {/* Group header */}
              {showGroupHeaders && hasMultipleGroups && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="flex items-center gap-2 bg-muted px-6 h-8 w-full text-left cursor-pointer hover:bg-muted/80 transition-colors"
                >
                  <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", !isCollapsed && "rotate-90")} />
                  {group.icon}
                  <span className="text-sm font-medium">{group.label}</span>
                  <span className="text-[13px] text-muted-foreground">{group.items.length}</span>
                  {group.meta}
                </button>
              )}

              {/* Rows (hidden when collapsed) */}
              {!isCollapsed && group.items.map((item) => (
                <div
                  key={getItemId(item)}
                  onClick={() => onItemClick?.(item)}
                  className={cn(
                    "flex items-center border-b border-border px-6 py-2.5 hover:bg-muted/30 transition-colors",
                    onItemClick && "cursor-pointer",
                    indentGroupedRows && hasMultipleGroups && showGroupHeaders && "pl-12",
                    getItemClass?.(item)
                  )}
                >
                  {/* Name column */}
                  <div className={cn("min-w-0", nameCol?.width ?? "flex-1")}>
                    {renderItemName ? renderItemName(item) : nameCol?.render(item)}
                  </div>

                  {/* Other visible columns */}
                  {otherCols.map((col) => (
                    <div key={col.id} className={cn(col.width)}>
                      {col.render(item)}
                    </div>
                  ))}
                </div>
              ))}

              {/* Footer (e.g. "Add task" row) — hidden when collapsed */}
              {!isCollapsed && footer?.(group.key)}
            </div>
          )
        })}
      </div>
    </>
  )
}

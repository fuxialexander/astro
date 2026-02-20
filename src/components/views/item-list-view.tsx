import { useState, useCallback, type ReactNode } from "react"
import { ChevronRight, ArrowUp, ArrowDown, X } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { PropertyPicker } from "@/components/property-picker"
import type { PickerOption } from "@/lib/constants"
import { cn } from "@/lib/utils"

export interface ListColumn<T> {
  id: string
  label: string
  width: string            // e.g. "w-[120px]" or "flex-1"
  render: (item: T) => ReactNode
  headerClassName?: string // extra classes for header cell
  /** If set, this column is sortable. The value is passed to onSort when clicked. */
  sortKey?: string
  /** If set, this column supports batch property setting. Shown when items are selected. */
  batchPropertyOptions?: PickerOption[]
  /** Called when batch property is set from column header. */
  onBatchPropertySet?: (value: string, selectedIds: string[]) => void
}

export interface ListGroup<T> {
  key: string
  label: string
  icon?: ReactNode
  items: T[]
  meta?: ReactNode          // e.g. "45% · 12 tasks"
}

export interface BatchAction {
  id: string
  label: string
  icon?: ReactNode
  variant?: "default" | "destructive"
  /** Called with selected item IDs. Return true to clear selection after. */
  onAction: (ids: string[]) => void | boolean | Promise<void | boolean>
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
  /** Batch actions shown when items are selected */
  batchActions?: BatchAction[]
  /** Current sort column key (matches ListColumn.sortKey) */
  sortColumn?: string
  /** Current sort direction */
  sortDirection?: "asc" | "desc"
  /** Called when a sortable column header is clicked */
  onSort?: (sortKey: string) => void
}

function ColumnHeader<T>({
  col,
  fallbackLabel,
  sortColumn,
  sortDirection,
  onSort,
  isNameColumn,
  hasSelection,
  selectedIds,
}: {
  col?: ListColumn<T>
  fallbackLabel?: string
  sortColumn?: string
  sortDirection?: "asc" | "desc"
  onSort?: (sortKey: string) => void
  isNameColumn?: boolean
  hasSelection?: boolean
  selectedIds?: string[]
}) {
  const label = col?.label ?? fallbackLabel ?? "Name"
  const width = col?.width ?? "flex-1"
  const sortKey = col?.sortKey
  const isSorted = sortKey != null && sortColumn === sortKey
  const sortable = sortKey != null && onSort != null
  const batchPropertyOptions = col?.batchPropertyOptions
  const onBatchPropertySet = col?.onBatchPropertySet
  const hasBatchProperty = hasSelection && batchPropertyOptions && onBatchPropertySet && selectedIds && selectedIds.length > 0

  // If batch property setting is available and items are selected, show PropertyPicker
  if (hasBatchProperty) {
    return (
      <PropertyPicker
        value={undefined}
        options={batchPropertyOptions}
        title={`Set ${label.toLowerCase()} for ${selectedIds.length} item${selectedIds.length > 1 ? 's' : ''}`}
        onSelect={(value) => onBatchPropertySet(value, selectedIds)}
      >
        <span className={cn(
          "text-[13px] font-medium text-primary flex items-center gap-1 cursor-pointer",
          isNameColumn ? "justify-start" : "justify-end text-right shrink-0",
          width,
          col?.headerClassName
        )}>
          {label}
        </span>
      </PropertyPicker>
    )
  }

  if (!sortable) {
    return (
      <span className={cn(
        "text-[13px] font-medium text-muted-foreground flex",
        isNameColumn ? "justify-start" : "justify-end text-right shrink-0",
        width,
        col?.headerClassName
      )}>
        {label}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        "flex items-center gap-1 text-[13px] font-medium transition-colors cursor-pointer select-none",
        isNameColumn ? "justify-start" : "justify-end text-right shrink-0",
        isSorted ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        width,
        col?.headerClassName,
      )}
    >
      {label}
      {isSorted && (
        sortDirection === "asc"
          ? <ArrowUp className="h-3 w-3 shrink-0" />
          : <ArrowDown className="h-3 w-3 shrink-0" />
      )}
    </button>
  )
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
  batchActions,
  sortColumn,
  sortDirection,
  onSort,
}: ItemListViewProps<T>) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastClickedId, setLastClickedId] = useState<string | null>(null)
  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const selectable = batchActions && batchActions.length > 0

  const allItemIds = groups.flatMap((g) => g.items.map(getItemId))
  const allSelected = selectable && allItemIds.length > 0 && allItemIds.every((id) => selected.has(id))
  const someSelected = selectable && selected.size > 0

  const toggleItem = useCallback((id: string, shiftKey = false) => {
    if (shiftKey && lastClickedId && lastClickedId !== id) {
      // Shift-click: select range from lastClickedId to id
      const startIndex = allItemIds.indexOf(lastClickedId)
      const endIndex = allItemIds.indexOf(id)

      if (startIndex !== -1 && endIndex !== -1) {
        const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex]
        const rangeIds = allItemIds.slice(from, to + 1)

        setSelected((prev) => {
          const next = new Set(prev)
          // Add all items in the range
          for (const rangeId of rangeIds) {
            next.add(rangeId)
          }
          return next
        })
      }
    } else {
      // Normal click: toggle single item
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }

    // Update last clicked item
    setLastClickedId(id)
  }, [lastClickedId, allItemIds])

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(allItemIds))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSelected, JSON.stringify(allItemIds)])

  const toggleGroupItems = useCallback((groupKey: string) => {
    const group = groups.find((g) => g.key === groupKey)
    if (!group) return
    const groupIds = group.items.map(getItemId)
    const allGroupSelected = groupIds.every((id) => selected.has(id))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allGroupSelected) {
        for (const id of groupIds) next.delete(id)
      } else {
        for (const id of groupIds) next.add(id)
      }
      return next
    })
  }, [groups, getItemId, selected])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const nameCol = columns.find((c) => c.id === "name")
  const otherCols = columns.filter((c) => c.id !== "name" && visibleColumns.includes(c.id))
  const allEmpty = groups.every((g) => g.items.length === 0)
  const hasMultipleGroups = groups.length > 1

  if (allEmpty && emptyState) {
    return <div className="flex-1 overflow-auto">{emptyState}</div>
  }

  return (
    <>
      {/* Batch action bar */}
      {someSelected && batchActions && (
        <div className="flex items-center gap-3 border-b border-border bg-muted/50 px-6 h-10 shrink-0">
          <span className="text-xs font-medium text-muted-foreground">
            {selected.size} selected
          </span>
          <div className="flex items-center gap-1.5">
            {batchActions.map((action) => (
              <Button
                key={action.id}
                variant={action.variant === "destructive" ? "destructive" : "outline"}
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={async () => {
                  const result = await action.onAction(Array.from(selected))
                  if (result !== false) clearSelection()
                }}
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
          </div>
          <button
            onClick={clearSelection}
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        </div>
      )}

      {/* Column headers */}
      <div className="flex items-center border-b border-border px-6 h-9 shrink-0">
        {selectable && (
          <div className="w-8 shrink-0 flex items-center">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              aria-label="Select all"
            />
          </div>
        )}
        <ColumnHeader
          col={nameCol}
          fallbackLabel="Name"
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={onSort}
          isNameColumn
          hasSelection={someSelected}
          selectedIds={Array.from(selected)}
        />
        {otherCols.map((col) => (
          <ColumnHeader
            key={col.id}
            col={col}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSort={onSort}
            isNameColumn={false}
            hasSelection={someSelected}
            selectedIds={Array.from(selected)}
          />
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.key)
          const groupIds = group.items.map(getItemId)
          const allGroupSelected = selectable && groupIds.length > 0 && groupIds.every((id) => selected.has(id))
          return (
            <div key={group.key}>
              {/* Group header */}
              {showGroupHeaders && hasMultipleGroups && (
                <div className="flex items-center gap-2 bg-muted px-6 h-8 w-full">
                  {selectable && (
                    <div className="w-8 shrink-0 flex items-center" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={allGroupSelected}
                        onCheckedChange={() => toggleGroupItems(group.key)}
                        aria-label={`Select all in ${group.label}`}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="flex items-center gap-2 flex-1 text-left cursor-pointer hover:bg-muted/80 transition-colors"
                  >
                    <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", !isCollapsed && "rotate-90")} />
                    {group.icon}
                    <span className="text-sm font-medium">{group.label}</span>
                    <span className="text-[13px] text-muted-foreground">{group.items.length}</span>
                    {group.meta}
                  </button>
                </div>
              )}

              {/* Rows (hidden when collapsed) */}
              {!isCollapsed && group.items.map((item) => {
                const itemId = getItemId(item)
                const isSelected = selected.has(itemId)
                return (
                  <div
                    key={itemId}
                    onClick={() => onItemClick?.(item)}
                    className={cn(
                      "flex items-center border-b border-border px-6 py-2.5 hover:bg-muted/30 transition-colors",
                      onItemClick && "cursor-pointer",
                      indentGroupedRows && hasMultipleGroups && showGroupHeaders && "pl-12",
                      isSelected && "bg-primary/5",
                      getItemClass?.(item)
                    )}
                  >
                    {/* Checkbox */}
                    {selectable && (
                      <div
                        className={cn("w-8 shrink-0 flex items-center", indentGroupedRows && hasMultipleGroups && showGroupHeaders && "-ml-6")}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleItem(itemId, e.shiftKey)
                        }}
                      >
                        <Checkbox
                          checked={isSelected}
                          aria-label={`Select item`}
                          tabIndex={-1}
                          className="pointer-events-none"
                        />
                      </div>
                    )}

                    {/* Name column */}
                    <div className={cn("min-w-0 flex items-center", nameCol?.width ?? "flex-1")}>
                      {renderItemName ? renderItemName(item) : nameCol?.render(item)}
                    </div>

                    {/* Other visible columns */}
                    {otherCols.map((col) => (
                      <div key={col.id} className={cn("flex items-center justify-end text-right shrink-0", col.width)}>
                        {col.render(item)}
                      </div>
                    ))}
                  </div>
                )
              })}

              {/* Footer (e.g. "Add task" row) — hidden when collapsed */}
              {!isCollapsed && footer?.(group.key)}
            </div>
          )
        })}
      </div>
    </>
  )
}

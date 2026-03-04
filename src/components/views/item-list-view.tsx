import { useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import { ChevronRight, ArrowUp, ArrowDown, X, GripVertical } from "lucide-react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  pointerWithin,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { PropertyPicker } from "@/components/property-picker"
import type { PickerOption } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { useKeyboardNav } from "@/hooks/use-keyboard-nav"
import { useKeyboardNavStore } from "@/stores/keyboard-nav-store"
import { useMediaQuery } from "@/hooks/use-media-query"

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
  /** Render a mobile card for each item. When provided and screen < 640px, cards replace the table layout. */
  renderMobileItem?: (item: T) => ReactNode
  /** Called when an item is dragged from one group to another. Enables group-aware DnD. */
  onGroupDrop?: (itemId: string, sourceGroupKey: string, targetGroupKey: string) => void
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
          isNameColumn ? "justify-start" : "justify-center text-center shrink-0",
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
        isNameColumn ? "justify-start" : "justify-center text-center shrink-0",
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
        isNameColumn ? "justify-start" : "justify-center text-center shrink-0",
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

/** Wrapper that makes a group header a drop target */
function DroppableGroup({ groupKey, children }: { groupKey: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `group:${groupKey}` })
  return (
    <div ref={setNodeRef} className={cn(isOver && "ring-2 ring-primary/30 ring-inset rounded-sm")}>
      {children}
    </div>
  )
}

/** Wrapper that makes a row draggable */
function DraggableRow({ itemId, groupKey, children }: { itemId: string; groupKey: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `item:${itemId}`,
    data: { itemId, groupKey },
  })
  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-30")}>
      <div className="flex items-center">
        <div
          {...listeners}
          {...attributes}
          className="shrink-0 flex items-center justify-center w-5 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
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
  renderMobileItem,
  onGroupDrop,
}: ItemListViewProps<T>) {
  const isMobile = useMediaQuery("(max-width: 639px)")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastClickedId, setLastClickedId] = useState<string | null>(null)
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map())

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Keyboard navigation integration
  const setItems = useKeyboardNavStore((s) => s.setItems)
  const clear = useKeyboardNavStore((s) => s.clear)

  const { focusedId } = useKeyboardNav({
    onActivate: (id) => {
      const item = groups.flatMap((g) => g.items).find((item) => getItemId(item) === id)
      if (item && onItemClick) {
        onItemClick(item)
      }
    },
    enabled: true,
  })

  // Update keyboard nav items when groups change
  useEffect(() => {
    const allItems = groups.flatMap((g) =>
      g.items.map((item) => ({
        id: getItemId(item),
        type: "task" as const,
        element: itemRefs.current.get(getItemId(item)),
      }))
    )
    setItems(allItems)
  }, [groups, getItemId, setItems])

  // Clear on unmount
  useEffect(() => {
    return () => clear()
  }, [clear])

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

  // DnD state
  const dndEnabled = !!onGroupDrop && groups.length > 1
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as { itemId: string; groupKey: string } | undefined
    if (data) setDraggedItemId(data.itemId)
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDraggedItemId(null)
    if (!onGroupDrop) return
    const { active, over } = event
    if (!over) return

    const activeData = active.data.current as { itemId: string; groupKey: string } | undefined
    if (!activeData) return

    // Extract target group key from droppable id (format: "group:KEY")
    const overId = String(over.id)
    if (!overId.startsWith("group:")) return
    const targetGroupKey = overId.slice("group:".length)

    if (activeData.groupKey !== targetGroupKey) {
      onGroupDrop(activeData.itemId, activeData.groupKey, targetGroupKey)
    }
  }, [onGroupDrop])

  const draggedItem = draggedItemId
    ? groups.flatMap((g) => g.items).find((item) => getItemId(item) === draggedItemId)
    : null

  const nameCol = columns.find((c) => c.id === "name")
  const otherCols = columns.filter((c) => c.id !== "name" && visibleColumns.includes(c.id))
  const allEmpty = groups.every((g) => g.items.length === 0)
  const hasMultipleGroups = groups.length > 1

  if (allEmpty && emptyState) {
    return <div className="flex-1 overflow-auto">{emptyState}</div>
  }

  function renderRow(item: T, groupKey: string, withDnd: boolean) {
    const itemId = getItemId(item)
    const isSelected = selected.has(itemId)
    const isFocused = focusedId === itemId
    const rowContent = (
      <div
        key={itemId}
        ref={(el) => {
          if (el) {
            itemRefs.current.set(itemId, el)
          } else {
            itemRefs.current.delete(itemId)
          }
        }}
        onClick={() => onItemClick?.(item)}
        className={cn(
          "flex flex-wrap sm:flex-nowrap items-center border-b border-border py-2.5 hover:bg-muted/30 transition-all duration-200",
          withDnd ? "px-1 sm:px-1" : "px-6",
          onItemClick && "cursor-pointer",
          indentGroupedRows && hasMultipleGroups && showGroupHeaders && !withDnd && "pl-12",
          isSelected && "bg-primary/5",
          isFocused && "shadow-[0_0_0_2px_rgba(var(--primary),0.3)] bg-accent/20 scale-[1.005]",
          getItemClass?.(item)
        )}
      >
        {/* Checkbox */}
        {selectable && (
          <div
            className={cn("w-8 shrink-0 flex items-center", indentGroupedRows && hasMultipleGroups && showGroupHeaders && !withDnd && "-ml-6")}
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
        <div className={cn("w-full sm:w-auto sm:min-w-[40%] flex items-center", nameCol?.width ?? "flex-1")}>
          {renderItemName ? renderItemName(item) : nameCol?.render(item)}
        </div>

        {/* Other visible columns */}
        <div className="flex items-center gap-2 sm:gap-0 flex-wrap sm:flex-nowrap w-full sm:w-auto sm:shrink sm:overflow-hidden mt-1 sm:mt-0">
          {otherCols.map((col) => (
            <div key={col.id} className={cn("flex items-center sm:justify-center sm:text-center shrink-0", col.width)}>
              {col.render(item)}
            </div>
          ))}
        </div>
      </div>
    )

    if (withDnd) {
      return (
        <DraggableRow key={itemId} itemId={itemId} groupKey={groupKey}>
          {rowContent}
        </DraggableRow>
      )
    }
    return rowContent
  }

  function renderGroups(withDnd: boolean) {
    return groups.map((group) => {
      const isCollapsed = collapsed.has(group.key)
      const groupIds = group.items.map(getItemId)
      const allGroupSelected = selectable && groupIds.length > 0 && groupIds.every((id) => selected.has(id))

      const groupContent = (
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

          {/* Rows */}
          {!isCollapsed && group.items.map((item) => renderRow(item, group.key, withDnd))}

          {/* Footer */}
          {!isCollapsed && footer?.(group.key)}
        </div>
      )

      if (withDnd) {
        return (
          <DroppableGroup key={group.key} groupKey={group.key}>
            {groupContent}
          </DroppableGroup>
        )
      }
      return groupContent
    })
  }

  // Mobile card layout: render cards instead of the table when on small screens
  if (isMobile && renderMobileItem) {
    return (
      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="flex flex-col gap-6">
          {groups.map((group) => {
            const isGroupCollapsed = collapsed.has(group.key)
            return (
              <div key={group.key}>
                {showGroupHeaders && hasMultipleGroups && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="flex items-center gap-2 px-2 mb-3 w-full text-left"
                  >
                    <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", !isGroupCollapsed && "rotate-90")} />
                    {group.icon}
                    <span className="text-sm font-semibold">{group.label}</span>
                    <span className="text-xs text-muted-foreground">({group.items.length})</span>
                    {group.meta}
                  </button>
                )}
                {!isGroupCollapsed && (
                  <div className="flex flex-col gap-3">
                    {group.items.map((item) => (
                      <div key={getItemId(item)}>
                        {renderMobileItem(item)}
                      </div>
                    ))}
                  </div>
                )}
                {!isGroupCollapsed && footer?.(group.key)}
              </div>
            )
          })}
        </div>
      </div>
    )
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
        <div className="hidden sm:flex items-center shrink overflow-hidden">
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
      </div>

      {/* Body */}
      {dndEnabled ? (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex-1 overflow-auto">
            {renderGroups(true)}
          </div>
          <DragOverlay dropAnimation={null}>
            {draggedItem ? (
              <div className="flex items-center border border-border bg-background shadow-lg rounded px-6 py-2.5 opacity-90">
                <div className={cn(nameCol?.width ?? "flex-1")}>
                  {renderItemName ? renderItemName(draggedItem) : nameCol?.render(draggedItem)}
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <div className="flex-1 overflow-auto">
          {renderGroups(false)}
        </div>
      )}
    </>
  )
}

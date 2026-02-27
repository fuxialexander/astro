import { useState, useMemo, useCallback } from "react"
import { Plus, X, Trash2, Palette } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { COLOR_PALETTE, getDistinctColor } from "@/lib/color-icon-utils"
import { cn } from "@/lib/utils"
import type { Label } from "@/types"

interface LabelManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

function ColorSwatchPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (color: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-5 w-5 rounded-full shrink-0 ring-1 ring-border hover:ring-foreground/40 transition-all cursor-pointer"
          style={{ backgroundColor: value }}
          onClick={(e) => e.stopPropagation()}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2" onClick={(e) => e.stopPropagation()}>
        <div className="grid grid-cols-5 gap-1.5">
          {COLOR_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              className={cn(
                "h-6 w-6 rounded-full cursor-pointer ring-1 ring-transparent hover:ring-foreground/40 transition-all",
                value === color && "ring-2 ring-foreground",
              )}
              style={{ backgroundColor: color }}
              onClick={() => {
                onChange(color)
                setOpen(false)
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function LabelRow({
  label,
  usageCount,
  selected,
  onToggleSelect,
  onUpdateName,
  onUpdateColor,
  onDelete,
}: {
  label: Label
  usageCount: number
  selected: boolean
  onToggleSelect: () => void
  onUpdateName: (name: string) => void
  onUpdateColor: (color: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label.name)

  const commitName = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== label.name) {
      onUpdateName(trimmed)
    } else {
      setDraft(label.name)
    }
    setEditing(false)
  }

  return (
    <div className="group flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        className="h-3.5 w-3.5 rounded border-border shrink-0 cursor-pointer"
      />
      <ColorSwatchPicker value={label.color} onChange={onUpdateColor} />
      {editing ? (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitName()
            if (e.key === "Escape") { setDraft(label.name); setEditing(false) }
          }}
          className="flex-1 min-w-0 bg-transparent text-sm border-b border-primary outline-none"
          autoFocus
        />
      ) : (
        <span
          className="flex-1 min-w-0 text-sm truncate cursor-pointer hover:underline decoration-muted-foreground/30"
          onClick={() => { setEditing(true); setDraft(label.name) }}
        >
          {label.name}
        </span>
      )}
      {usageCount > 0 && (
        <span className="text-[10px] text-muted-foreground shrink-0 bg-muted rounded-full px-1.5 py-0.5">
          {usageCount} task{usageCount !== 1 ? "s" : ""}
        </span>
      )}
      <button
        type="button"
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all cursor-pointer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function LabelManagerDialog({ open, onOpenChange, projectId }: LabelManagerDialogProps) {
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const updateProject = useProjectStore((s) => s.updateProject)
  const allNodes = usePlanStore((s) => s.nodes)
  const updateNode = usePlanStore((s) => s.updateNode)

  const labels = useMemo(() => project?.labels ?? [], [project?.labels])
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState(() =>
    getDistinctColor(labels.map((l) => l.color)),
  )

  // Count label usage across plan nodes
  const usageMap = useMemo(() => {
    const map = new Map<string, number>()
    const liveNodes = allNodes.filter(isLive).filter((n) => n.projectId === projectId)
    for (const node of liveNodes) {
      for (const lid of node.labelIds ?? []) {
        map.set(lid, (map.get(lid) ?? 0) + 1)
      }
    }
    return map
  }, [allNodes, projectId])

  const filteredLabels = useMemo(() => {
    if (!search) return labels
    const q = search.toLowerCase()
    return labels.filter((l) => l.name.toLowerCase().includes(q))
  }, [labels, search])

  const saveLabels = useCallback(
    (next: Label[]) => {
      updateProject(projectId, { labels: next })
    },
    [updateProject, projectId],
  )

  const handleAdd = () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    const id = crypto.randomUUID()
    saveLabels([...labels, { id, name: trimmed, color: newColor }])
    setNewName("")
    setNewColor(getDistinctColor([...labels.map((l) => l.color), newColor]))
  }

  const handleUpdateName = (id: string, name: string) => {
    saveLabels(labels.map((l) => (l.id === id ? { ...l, name } : l)))
  }

  const handleUpdateColor = (id: string, color: string) => {
    saveLabels(labels.map((l) => (l.id === id ? { ...l, color } : l)))
  }

  const handleDelete = (ids: string[]) => {
    const idsSet = new Set(ids)
    const affectedNodes = allNodes
      .filter(isLive)
      .filter((n) => n.projectId === projectId)
      .filter((n) => n.labelIds?.some((lid) => idsSet.has(lid)))

    const totalUsage = ids.reduce((sum, id) => sum + (usageMap.get(id) ?? 0), 0)
    if (totalUsage > 0) {
      const ok = window.confirm(
        `This will remove ${ids.length > 1 ? "these labels" : "this label"} from ${totalUsage} task${totalUsage !== 1 ? "s" : ""}. Continue?`,
      )
      if (!ok) return
    }

    // Strip label IDs from affected nodes
    for (const node of affectedNodes) {
      updateNode(node.id, {
        labelIds: (node.labelIds ?? []).filter((lid) => !idsSet.has(lid)),
      })
    }

    saveLabels(labels.filter((l) => !idsSet.has(l.id)))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
  }

  const handleBatchChangeColor = (color: string) => {
    saveLabels(
      labels.map((l) => (selectedIds.has(l.id) ? { ...l, color } : l)),
    )
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!project) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Labels</DialogTitle>
        </DialogHeader>

        {/* Search */}
        {labels.length > 5 && (
          <input
            type="text"
            placeholder="Search labels..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background outline-none placeholder:text-muted-foreground/50 focus-visible:ring-1 focus-visible:ring-ring"
          />
        )}

        {/* Batch actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted text-sm">
            <span className="text-muted-foreground text-xs">
              {selectedIds.size} selected
            </span>
            <div className="flex-1" />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                  <Palette className="h-3 w-3" />
                  Color
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-2">
                <div className="grid grid-cols-5 gap-1.5">
                  {COLOR_PALETTE.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className="h-6 w-6 rounded-full cursor-pointer ring-1 ring-transparent hover:ring-foreground/40 transition-all"
                      style={{ backgroundColor: color }}
                      onClick={() => handleBatchChangeColor(color)}
                    />
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
              onClick={() => handleDelete([...selectedIds])}
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </Button>
          </div>
        )}

        {/* Label list */}
        <div className="flex flex-col max-h-[300px] overflow-y-auto">
          {filteredLabels.length === 0 && labels.length > 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No matching labels</p>
          )}
          {filteredLabels.length === 0 && labels.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No labels yet. Add one below.</p>
          )}
          {filteredLabels.map((label) => (
            <LabelRow
              key={label.id}
              label={label}
              usageCount={usageMap.get(label.id) ?? 0}
              selected={selectedIds.has(label.id)}
              onToggleSelect={() => toggleSelect(label.id)}
              onUpdateName={(name) => handleUpdateName(label.id, name)}
              onUpdateColor={(color) => handleUpdateColor(label.id, color)}
              onDelete={() => handleDelete([label.id])}
            />
          ))}
        </div>

        {/* Add label row */}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <ColorSwatchPicker value={newColor} onChange={setNewColor} />
          <input
            type="text"
            placeholder="New label name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd()
            }}
            className="flex-1 min-w-0 text-sm bg-transparent border-b border-border outline-none placeholder:text-muted-foreground/50 py-1 focus:border-primary"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 gap-1"
            disabled={!newName.trim()}
            onClick={handleAdd}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

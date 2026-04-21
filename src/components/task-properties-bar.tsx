import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import {
  Diamond, Plus, X,
  FileText, GitMerge, CalendarClock, ChevronDown, Paperclip
} from "lucide-react"
import { PropertyPicker } from "@/components/property-picker"
import { LabelPicker } from "@/components/label-picker"
import { LabelManagerDialog } from "@/components/label-manager-dialog"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useScheduleStore } from "@/stores/schedule-store"
import { PRIORITY_CONFIG, PRIORITY_OPTIONS, ESTIMATE_OPTIONS, STATUS_OPTIONS } from "@/lib/constants"
import { STATUS_CONFIG } from "@/lib/status-config"
import { cn } from "@/lib/utils"
import type { PlanNode, Priority } from "@/types"

interface TaskPropertiesBarProps {
  node: PlanNode
  project: {
    id: string
    workingDirectory?: string
    defaultMachineId?: string
    fileTree?: string[]
  }
  onNodeUpdate?: (node: PlanNode) => void
  hasNote?: boolean
  attachmentCount?: number
  children?: React.ReactNode
}

const ICON_BTN = "h-7 w-7 rounded-md inline-flex items-center justify-center transition-colors duration-100 hover:bg-muted/70 cursor-pointer shrink-0 select-none"
const ICON_BTN_ACTIVE = "bg-muted/50"
const DIVIDER = "w-px h-3.5 bg-border/50 mx-1 shrink-0"

export function TaskPropertiesBar({ node, onNodeUpdate, hasNote, attachmentCount = 0, children }: TaskPropertiesBarProps) {
  const updateNodeStore = usePlanStore((s) => s.updateNode)
  const allNodes = usePlanStore((s) => s.nodes)
  const allEdges = usePlanStore((s) => s.edges)
  const addEdge = usePlanStore((s) => s.addEdge)
  const removeEdge = usePlanStore((s) => s.removeEdge)
  const liveNodes = useMemo(() => allNodes.filter(isLive), [allNodes])
  const liveEdges = useMemo(() => allEdges.filter(isLive), [allEdges])

  const [labelManagerOpen, setLabelManagerOpen] = useState(false)
  const [addDepOpen, setAddDepOpen] = useState(false)
  const [addDepSearch, setAddDepSearch] = useState("")
  const [noteExpanded, setNoteExpanded] = useState(false)

  // Dep popover hover timers
  const depCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelDepClose = () => { if (depCloseTimer.current) clearTimeout(depCloseTimer.current) }
  const scheduleDepClose = () => { depCloseTimer.current = setTimeout(() => { setAddDepOpen(false); setAddDepSearch("") }, 200) }

  const schedules = useScheduleStore((s) => s.schedules)
  const loadSchedules = useScheduleStore((s) => s.loadSchedules)
  const updateScheduleStore = useScheduleStore((s) => s.updateSchedule)
  const nodeSchedule = schedules.find((s) => s.scope === 'node' && s.nodeId === node.id)
  useEffect(() => { loadSchedules(node.projectId) }, [node.projectId, loadSchedules])

  const fullProject = useProjectStore((s) => s.projects.find((p) => p.id === node.projectId))
  const projectLabels = fullProject?.labels ?? []

  const upstreamDeps = useMemo(() => {
    const depEdges = liveEdges.filter((e) => e.target === node.id)
    return depEdges.map((e) => {
      const depNode = liveNodes.find((n) => n.id === e.source)
      return { id: e.source, title: depNode?.title ?? e.source, status: depNode?.status }
    })
  }, [liveEdges, liveNodes, node.id])

  const addCandidates = useMemo(() => {
    const existingDepIds = new Set(upstreamDeps.map((d) => d.id))
    return liveNodes
      .filter((n) => n.projectId === node.projectId && n.id !== node.id && !existingDepIds.has(n.id))
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [liveNodes, upstreamDeps, node.projectId, node.id])

  const filteredCandidates = useMemo(() => {
    if (!addDepSearch) return addCandidates
    const q = addDepSearch.toLowerCase()
    return addCandidates.filter((n) => n.title.toLowerCase().includes(q))
  }, [addCandidates, addDepSearch])

  const milestoneOptions = useMemo(() => {
    const milestones = liveNodes
      .filter((n) => n.type === 'milestone' && n.projectId === node.projectId)
      .map((n) => ({ id: n.id, label: n.title, icon: Diamond }))
    return [{ id: 'none', label: 'No milestone' }, ...milestones]
  }, [liveNodes, node.projectId])

  const currentMilestoneName = useMemo(() => {
    if (!node.milestoneId) return null
    return allNodes.find((n) => n.id === node.milestoneId)?.title ?? null
  }, [allNodes, node.milestoneId])

  const handleUpdate = useCallback((updates: Partial<PlanNode>) => {
    updateNodeStore(node.id, updates)
    onNodeUpdate?.({ ...node, ...updates })
  }, [node, updateNodeStore, onNodeUpdate])

  const handleAddDep = useCallback((sourceId: string) => {
    addEdge({ id: crypto.randomUUID(), source: sourceId, target: node.id, type: "dependency" })
    const targetNode = allNodes.find((n) => n.id === node.id)
    if (targetNode && !targetNode.dependencies.includes(sourceId)) {
      updateNodeStore(node.id, { dependencies: [...targetNode.dependencies, sourceId] })
    }
    setAddDepOpen(false)
    setAddDepSearch("")
  }, [addEdge, node.id, allNodes, updateNodeStore])

  const handleRemoveDep = useCallback((sourceId: string) => {
    removeEdge(sourceId, node.id)
    const targetNode = allNodes.find((n) => n.id === node.id)
    if (targetNode) {
      updateNodeStore(node.id, { dependencies: targetNode.dependencies.filter((d) => d !== sourceId) })
    }
  }, [removeEdge, node.id, allNodes, updateNodeStore])

  const statusEntry = STATUS_CONFIG[node.status]
  const StatusIcon = statusEntry.icon
  const priorityConfig = PRIORITY_CONFIG[(node.priority ?? "none") as Priority]
  const PriorityIcon = priorityConfig.icon
  const hasNoteContent = hasNote || attachmentCount > 0

  return (
    <>
      <div className="flex items-center gap-0.5 overflow-x-auto" onClick={(e) => e.stopPropagation()}>

        {/* Note toggle */}
        <button
          type="button"
          onClick={() => setNoteExpanded(!noteExpanded)}
          className={cn(ICON_BTN, noteExpanded && ICON_BTN_ACTIVE)}
          title={noteExpanded ? "Collapse note" : "Expand note"}
        >
          {noteExpanded
            ? <ChevronDown className={cn("h-3.5 w-3.5", hasNoteContent ? "text-foreground" : "text-muted-foreground/40")} />
            : <FileText className={cn("h-3.5 w-3.5", hasNoteContent ? "text-muted-foreground" : "text-muted-foreground/30")} />
          }
          {attachmentCount > 0 && (
            <Paperclip className="h-2.5 w-2.5 text-muted-foreground/50 -ml-0.5" />
          )}
        </button>

        <span className={DIVIDER} />

        {/* Status */}
        <PropertyPicker
          value={node.status}
          options={STATUS_OPTIONS}
          title="Status"
          onSelect={(id) => handleUpdate({ status: id as PlanNode["status"] })}
          openOnHover
          triggerClassName={ICON_BTN}
        >
          <StatusIcon className={cn("h-3.5 w-3.5", statusEntry.color)} />
        </PropertyPicker>

        {/* Priority */}
        <PropertyPicker
          value={node.priority ?? "none"}
          options={PRIORITY_OPTIONS}
          title="Priority"
          onSelect={(id) => handleUpdate({ priority: id as Priority })}
          openOnHover
          triggerClassName={ICON_BTN}
        >
          <PriorityIcon className={cn("h-3.5 w-3.5", priorityConfig.color)} />
        </PropertyPicker>

        {/* Estimate */}
        <PropertyPicker
          value={node.estimate}
          options={ESTIMATE_OPTIONS}
          title="Estimate"
          onSelect={(id) => handleUpdate({ estimate: id as PlanNode["estimate"] })}
          openOnHover
          triggerClassName={ICON_BTN}
        >
          <span className={cn(
            "text-[11px] font-mono font-bold tabular-nums leading-none w-5 text-center",
            node.estimate ? "text-foreground" : "text-muted-foreground/30"
          )}>
            {node.estimate ?? "—"}
          </span>
        </PropertyPicker>

        <span className={DIVIDER} />

        {/* Labels */}
        {projectLabels.length > 0 ? (
          <LabelPicker
            labelIds={node.labelIds ?? []}
            allLabels={projectLabels}
            displayMode="icon"
            onChange={(labelIds) => handleUpdate({ labelIds })}
            onManageLabels={() => setLabelManagerOpen(true)}
            openOnHover
            triggerClassName={ICON_BTN}
          />
        ) : (
          <button type="button" onClick={() => setLabelManagerOpen(true)} className={ICON_BTN} title="Manage labels">
            <span className="text-muted-foreground/30 text-[10px]">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current"><path d="M1.5 1h6.086a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 0 1.414l-5.086 5.086a1 1 0 0 1-1.414 0L1.793 7.793A1 1 0 0 1 1.5 7.086V1.5a.5.5 0 0 1 0 0z M4 4.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z"/></svg>
            </span>
          </button>
        )}

        {/* Milestone */}
        {node.type !== 'milestone' && (
          <PropertyPicker
            value={node.milestoneId ?? 'none'}
            options={milestoneOptions}
            title={currentMilestoneName ? `Milestone: ${currentMilestoneName}` : "Milestone"}
            onSelect={(id) => handleUpdate({ milestoneId: id === 'none' ? undefined : id })}
            openOnHover
            triggerClassName={ICON_BTN}
          >
            <Diamond className={cn("h-3.5 w-3.5", node.milestoneId ? "text-foreground" : "text-muted-foreground/30")} />
          </PropertyPicker>
        )}

        {/* Dependencies */}
        <Popover open={addDepOpen} onOpenChange={(o) => { setAddDepOpen(o); if (!o) setAddDepSearch("") }}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(ICON_BTN, "relative")}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseEnter={() => { cancelDepClose(); setAddDepOpen(true) }}
              onMouseLeave={scheduleDepClose}
              title={upstreamDeps.length > 0 ? `${upstreamDeps.length} dependenc${upstreamDeps.length === 1 ? 'y' : 'ies'}` : "Dependencies"}
            >
              <GitMerge className={cn("h-3.5 w-3.5", upstreamDeps.length > 0 ? "text-foreground" : "text-muted-foreground/30")} />
              {upstreamDeps.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] rounded-full bg-muted border border-background flex items-center justify-center text-[8px] font-bold text-foreground leading-none px-0.5">
                  {upstreamDeps.length}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-64 p-0"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseEnter={cancelDepClose}
            onMouseLeave={scheduleDepClose}
          >
            <input
              type="text"
              placeholder="Search tasks..."
              value={addDepSearch}
              onChange={(e) => setAddDepSearch(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-transparent border-b border-border outline-none placeholder:text-muted-foreground/50"
              autoFocus
            />
            {upstreamDeps.length > 0 && (
              <div className="px-1 py-1 border-b border-border/50">
                <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Current</p>
                {upstreamDeps.map((dep) => (
                  <div key={dep.id} className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] hover:bg-muted/50 transition-colors">
                    <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", dep.status === "completed" || dep.status === "auto_verified" ? "bg-success" : dep.status === "in_progress" || dep.status === "dispatched" ? "bg-warning" : "border border-muted-foreground/40")} />
                    <span className="flex-1 truncate">{dep.title}</span>
                    <button type="button" onClick={() => handleRemoveDep(dep.id)} className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all cursor-pointer">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="max-h-48 overflow-y-auto py-1 px-1">
              {filteredCandidates.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No tasks available</p>
              ) : filteredCandidates.map((n) => (
                <button key={n.id} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer" onClick={() => handleAddDep(n.id)}>
                  <Plus className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="flex-1 text-left truncate">{n.title}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Schedule */}
        {nodeSchedule && (
          <>
            <span className={DIVIDER} />
            <button
              type="button"
              className={ICON_BTN}
              onClick={() => updateScheduleStore(nodeSchedule.id, { enabled: !nodeSchedule.enabled })}
              title={`Schedule: ${nodeSchedule.cronExpression} (${nodeSchedule.enabled ? 'enabled — click to pause' : 'paused — click to enable'})`}
            >
              <CalendarClock className={cn("h-3.5 w-3.5", nodeSchedule.enabled ? "text-success" : "text-muted-foreground/30")} />
            </button>
          </>
        )}

        <div className="flex-1 min-w-[8px]" />
      </div>

      {/* Expanded note content */}
      {noteExpanded && children && (
        <div className="border-t border-border/30 max-h-[40vh] overflow-auto">
          {children}
        </div>
      )}

      <LabelManagerDialog open={labelManagerOpen} onOpenChange={setLabelManagerOpen} projectId={node.projectId} />
    </>
  )
}

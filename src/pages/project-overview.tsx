import { useState, useMemo, useEffect, useCallback } from "react"
import { useParams, useSearchParams } from "react-router"
import {
  Rocket,
  Star,
  Pencil,
  Plus,
  FileText,
  CircleCheck,
  Play,
  User,
  MessageSquare,
  FolderGit2,
  Diamond,
  ExternalLink,
  LayoutGrid,
  List,
  Calendar,
  Network,
  Maximize2,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { VisionDocDialog } from "@/components/vision-doc-dialog"
import { RepoConfigDialog } from "@/components/repo-config-dialog"
import { MilestoneDialog } from "@/components/milestone-dialog"
import { ActivityDialog } from "@/components/activity-dialog"
import { ColorIconBadge } from "@/components/color-icon-picker"
import { PlanCanvas } from "@/components/plan-graph/plan-canvas"
import { ChatPanel } from "@/components/agent/chat-panel"
import { DisplayPopover, type DisplayPopoverConfig } from "@/components/display-popover"
import { PlanListView, PlanBoardView, PlanTimelineView } from "@/pages/plan-view"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useInitiativeStore } from "@/stores/initiative-store"
import { useActivityStore } from "@/stores/activity-store"
import { useMachinesStore } from "@/stores/machines-store"
import { cn } from "@/lib/utils"
import type { Project, PlanNode } from "@/types"

const healthLabels: Record<string, string> = {
  on_track: "On Track",
  at_risk: "At Risk",
  off_track: "Off Track",
}

const healthColors: Record<string, string> = {
  on_track: "bg-green-500",
  at_risk: "bg-amber-500",
  off_track: "bg-red-500",
}

type ViewMode = "graph" | "list" | "timeline" | "board"

const VALID_VIEWS = new Set<ViewMode>(["graph", "list", "timeline", "board"])
const FILE_TREE_STALE_MS = 5 * 60 * 1000 // 5 minutes

const planGraphDisplayConfig: DisplayPopoverConfig = {
  viewKey: "plan-graph",
  groupByLabel: "Highlight by",
  groupByOptions: [
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "none", label: "None" },
  ],
  orderByOptions: [],
  propertyOptions: [],
}

const planListDisplayConfig: DisplayPopoverConfig = {
  viewKey: "plan-list",
  groupByOptions: [
    { value: "none", label: "No grouping" },
    { value: "milestone", label: "Milestone" },
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
  ],
  orderByOptions: [
    { value: "name", label: "Name" },
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "dueDate", label: "Due date" },
  ],
  propertyOptions: [
    { value: "priority", label: "Priority" },
    { value: "status", label: "Status" },
    { value: "dueDate", label: "Due date" },
    { value: "estimate", label: "Estimate" },
    { value: "milestone", label: "Milestone" },
    { value: "labels", label: "Labels" },
    { value: "pr", label: "PR" },
  ],
}

const planTimelineDisplayConfig: DisplayPopoverConfig = {
  viewKey: "plan-list",
  groupByOptions: [
    { value: "none", label: "No grouping" },
    { value: "milestone", label: "Milestone" },
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
  ],
  orderByOptions: [
    { value: "name", label: "Name" },
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "dueDate", label: "Due date" },
  ],
  propertyOptions: [
    { value: "priority", label: "Priority" },
    { value: "status", label: "Status" },
    { value: "dueDate", label: "Due date" },
    { value: "estimate", label: "Estimate" },
    { value: "labels", label: "Labels" },
    { value: "pr", label: "PR" },
  ],
  showZoom: true,
}

const planBoardDisplayConfig: DisplayPopoverConfig = {
  viewKey: "plan-board",
  columnByOptions: [
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "milestone", label: "Milestone" },
  ],
  groupByOptions: [
    { value: "none", label: "No grouping" },
  ],
  orderByOptions: [
    { value: "priority", label: "Priority" },
    { value: "name", label: "Name" },
    { value: "dueDate", label: "Due date" },
  ],
  propertyOptions: [
    { value: "priority", label: "Priority" },
    { value: "estimate", label: "Estimate" },
    { value: "dueDate", label: "Due date" },
    { value: "labels", label: "Labels" },
    { value: "pr", label: "PR" },
  ],
}

import { formatDate, formatRelativeTime } from "@/lib/date-utils"

// --- Overview Tab Content ---
function OverviewTab({
  project,
  viewMode,
  setViewMode,
  chatOpen,
  setChatOpen,
  isEnlarged,
  setIsEnlarged,
}: {
  project: Project
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  chatOpen: boolean
  setChatOpen: (open: boolean) => void
  isEnlarged: boolean
  setIsEnlarged: (enlarged: boolean) => void
}) {
  const planNodes = usePlanStore((s) => s.nodes)
  const addNode = usePlanStore((s) => s.addNode)
  const updateNode = usePlanStore((s) => s.updateNode)
  const removeNodes = usePlanStore((s) => s.removeNodes)
  const updateProject = useProjectStore((s) => s.updateProject)
  const initiatives = useInitiativeStore((s) => s.initiatives)
  const addActivity = useActivityStore((s) => s.addActivity)
  const activities = useActivityStore((s) => s.activities)
  const machines = useMachinesStore((s) => s.machines)
  const fetchMachines = useMachinesStore((s) => s.fetchMachines)
  const recentActivities = useMemo(
    () => activities.filter((a) => a.projectId === project.id).slice(0, 3),
    [activities, project.id]
  )

  // Fetch machines on mount (for displaying machine hostname)
  useEffect(() => {
    if (machines.length === 0) {
      fetchMachines()
    }
  }, [machines.length, fetchMachines])
  const allNodes = useMemo(() => planNodes.filter((n) => n.projectId === project.id), [planNodes, project.id])
  const [visionOpen, setVisionOpen] = useState(false)
  const [repoOpen, setRepoOpen] = useState(false)
  const [activityDialogOpen, setActivityDialogOpen] = useState(false)
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false)
  const [editingMilestone, setEditingMilestone] = useState<PlanNode | undefined>(undefined)
  const [editingStatus, setEditingStatus] = useState(false)
  const [editingStartDate, setEditingStartDate] = useState(false)
  const [editingTargetDate, setEditingTargetDate] = useState(false)
  const [editingInitiative, setEditingInitiative] = useState(false)
  const [chatInitialMessage, setChatInitialMessage] = useState<string | undefined>()
  const [useLocalUrls, setUseLocalUrls] = useState(true) // true = Local, false = Remote
  const [useVSCode, setUseVSCode] = useState(false) // false = Cursor, true = VSCode

  // Handle decompose: open chat with pre-filled message
  const handleDecomposeNode = useCallback((nodeId: string) => {
    const node = planNodes.find((n) => n.id === nodeId)
    if (!node) return
    const message = `Decompose @${node.title} into smaller sub-tasks with minimal overlap. Each sub-task should be agent-solvable in one session.`
    setChatInitialMessage(message)
    setChatOpen(true)
  }, [planNodes, setChatOpen])

  // Calculate real progress based on task completion
  const progress = useMemo(() => {
    const tasks = allNodes.filter((n) => n.type !== "milestone")
    if (tasks.length === 0) return 0
    const completed = tasks.filter((n) => n.status === "completed" || n.status === "auto_verified")
    return Math.round((completed.length / tasks.length) * 100)
  }, [allNodes])

  // Get milestones for this project
  const milestones = useMemo(() => allNodes.filter((n) => n.type === "milestone"), [allNodes])

  const handleMilestoneAdd = () => {
    setEditingMilestone(undefined)
    setMilestoneDialogOpen(true)
  }

  const handleMilestoneEdit = (milestone: PlanNode) => {
    setEditingMilestone(milestone)
    setMilestoneDialogOpen(true)
  }

  const handleMilestoneSave = (data: { title: string; description: string; dueDate?: string }) => {
    if (editingMilestone) {
      // Update existing milestone
      updateNode(editingMilestone.id, {
        title: data.title,
        description: data.description,
        dueDate: data.dueDate,
      })
      addActivity({
        projectId: project.id,
        type: "milestone.updated",
        title: `Updated milestone: ${data.title}`,
        nodeId: editingMilestone.id,
      })
    } else {
      // Create new milestone
      const newMilestone: PlanNode = {
        id: crypto.randomUUID(),
        projectId: project.id,
        type: "milestone",
        title: data.title,
        description: data.description,
        dueDate: data.dueDate,
        status: "planned",
        parentId: null,
        dependencies: [],
        verification: "human",
        position: { x: 0, y: 0 }, // Will be calculated by layout algorithm
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      addNode(newMilestone)
      addActivity({
        projectId: project.id,
        type: "milestone.created",
        title: `Created milestone: ${data.title}`,
        description: data.description,
        nodeId: newMilestone.id,
      })
    }
  }

  const handleMilestoneDelete = (milestoneId: string) => {
    // Check if any tasks are assigned to this milestone
    const milestone = allNodes.find((n) => n.id === milestoneId)
    const assignedTasks = allNodes.filter((n) => n.milestoneId === milestoneId && n.type !== "milestone")

    if (assignedTasks.length > 0) {
      const confirmDelete = window.confirm(
        `This milestone has ${assignedTasks.length} assigned task(s). Deleting it will unassign these tasks. Continue?`
      )
      if (!confirmDelete) return

      // Unassign tasks from this milestone
      for (const task of assignedTasks) {
        updateNode(task.id, { milestoneId: undefined })
      }
    }

    removeNodes([milestoneId])

    if (milestone) {
      addActivity({
        projectId: project.id,
        type: "milestone.deleted",
        title: `Deleted milestone: ${milestone.title}`,
        nodeId: milestoneId,
      })
    }
  }

  // Generate editor URL (Cursor/VSCode) with local/remote protocol
  const editorUrl = useMemo(() => {
    if (!project.workingDirectory) return null

    const path = project.workingDirectory
    const editorScheme = useVSCode ? 'vscode' : 'cursor'

    console.log('[EditorURL] Computing URL:', { useLocalUrls, useVSCode, editorScheme, defaultMachineId: project.defaultMachineId })

    // Local mode - use file:// protocol
    if (useLocalUrls) {
      const url = `${editorScheme}://file${path}`
      console.log('[EditorURL] Local mode:', url)
      return url
    }

    // Remote mode - use SSH remote URL
    if (project.defaultMachineId) {
      const machine = machines.find((m) => m.id === project.defaultMachineId)
      console.log('[EditorURL] Found machine:', machine?.hostname)
      if (machine && machine.hostname) {
        // Format: editor://vscode-remote/ssh-remote+hostname/path
        const url = `${editorScheme}://vscode-remote/ssh-remote+${machine.hostname}${path}`
        console.log('[EditorURL] Remote mode:', url)
        return url
      }
    }

    // Fallback to local file URL
    const fallbackUrl = `${editorScheme}://file${path}`
    console.log('[EditorURL] Fallback to local:', fallbackUrl, 'No machine configured')
    return fallbackUrl
  }, [project.workingDirectory, project.defaultMachineId, useLocalUrls, useVSCode, machines])

  // Enlarged Plan View (Full Screen)
  if (isEnlarged) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <VisionDocDialog open={visionOpen} onOpenChange={setVisionOpen} project={project} />
        {/* Header with close button */}
        <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
          <h3 className="text-lg font-semibold">Plan</h3>
          <div className="flex items-center gap-2">
            {/* View mode selector */}
            <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
              <button
                onClick={() => setViewMode("graph")}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  viewMode === "graph" ? "bg-background shadow-sm" : "hover:bg-background/50"
                )}
                title="Graph view"
              >
                <Network className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  viewMode === "list" ? "bg-background shadow-sm" : "hover:bg-background/50"
                )}
                title="List view"
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode("timeline")}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  viewMode === "timeline" ? "bg-background shadow-sm" : "hover:bg-background/50"
                )}
                title="Timeline view"
              >
                <Calendar className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode("board")}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  viewMode === "board" ? "bg-background shadow-sm" : "hover:bg-background/50"
                )}
                title="Board view"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
            </div>
            {viewMode === "graph" && <DisplayPopover config={planGraphDisplayConfig} />}
            {viewMode === "list" && <DisplayPopover config={planListDisplayConfig} />}
            {viewMode === "timeline" && <DisplayPopover config={planTimelineDisplayConfig} />}
            {viewMode === "board" && <DisplayPopover config={planBoardDisplayConfig} />}
            <Button
              variant={chatOpen ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setChatOpen(!chatOpen)
                if (chatOpen) setChatInitialMessage(undefined)
              }}
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEnlarged(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {/* Full screen plan view */}
        <div className="flex-1 overflow-hidden relative">
          {viewMode === "graph" ? (
            <div className="absolute inset-0 touch-pan-x touch-pan-y">
              <PlanCanvas projectId={project.id} onNodeSelect={() => {}} onDecomposeNode={handleDecomposeNode} />
            </div>
          ) : viewMode === "list" ? (
            <div className="absolute inset-0 overflow-hidden">
              <PlanListView projectId={project.id} onNodeSelect={() => {}} />
            </div>
          ) : viewMode === "board" ? (
            <div className="absolute inset-0 overflow-hidden">
              <PlanBoardView projectId={project.id} onNodeSelect={() => {}} />
            </div>
          ) : (
            <div className="absolute inset-0 overflow-hidden">
              <PlanTimelineView projectId={project.id} onNodeSelect={() => {}} />
            </div>
          )}
        </div>
        {/* Chat panel (if open) */}
        {chatOpen && (
          <div className="flex w-[400px] shrink-0 flex-col border-l border-border bg-card absolute right-0 top-14 bottom-0">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-semibold">Plan Chat</h3>
              <button
                onClick={() => {
                  setChatOpen(false)
                  setChatInitialMessage(undefined)
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ChatPanel projectId={project.id} visionDoc={project.visionDoc} initialMessage={chatInitialMessage} />
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <VisionDocDialog open={visionOpen} onOpenChange={setVisionOpen} project={project} />
      <RepoConfigDialog open={repoOpen} onOpenChange={setRepoOpen} project={project} />
      <ActivityDialog open={activityDialogOpen} onOpenChange={setActivityDialogOpen} projectId={project.id} />
      <MilestoneDialog
        open={milestoneDialogOpen}
        onOpenChange={setMilestoneDialogOpen}
        milestone={editingMilestone}
        onSave={handleMilestoneSave}
        onDelete={editingMilestone ? () => handleMilestoneDelete(editingMilestone.id) : undefined}
      />
      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">
        {/* Description Section */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Description</h3>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className="text-sm leading-relaxed">
            {project.description}
          </p>
        </div>

        {/* Plan View Section */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Plan</h3>
            <div className="flex items-center gap-2">
              {/* View mode selector */}
              <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
                <button
                  onClick={() => setViewMode("graph")}
                  className={cn(
                    "p-1.5 rounded transition-colors",
                    viewMode === "graph" ? "bg-background shadow-sm" : "hover:bg-background/50"
                  )}
                  title="Graph view"
                >
                  <Network className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={cn(
                    "p-1.5 rounded transition-colors",
                    viewMode === "list" ? "bg-background shadow-sm" : "hover:bg-background/50"
                  )}
                  title="List view"
                >
                  <List className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setViewMode("timeline")}
                  className={cn(
                    "p-1.5 rounded transition-colors",
                    viewMode === "timeline" ? "bg-background shadow-sm" : "hover:bg-background/50"
                  )}
                  title="Timeline view"
                >
                  <Calendar className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setViewMode("board")}
                  className={cn(
                    "p-1.5 rounded transition-colors",
                    viewMode === "board" ? "bg-background shadow-sm" : "hover:bg-background/50"
                  )}
                  title="Board view"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
              </div>
              {viewMode === "graph" && <DisplayPopover config={planGraphDisplayConfig} />}
              {viewMode === "list" && <DisplayPopover config={planListDisplayConfig} />}
              {viewMode === "timeline" && <DisplayPopover config={planTimelineDisplayConfig} />}
              {viewMode === "board" && <DisplayPopover config={planBoardDisplayConfig} />}
              <Button
                variant={chatOpen ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setChatOpen(!chatOpen)
                  if (chatOpen) setChatInitialMessage(undefined)
                }}
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEnlarged(true)}
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {/* Plan canvas/view */}
          <div className="relative h-[400px] rounded-lg border border-border overflow-hidden bg-card">
            {viewMode === "graph" ? (
              <div className="absolute inset-0 touch-pan-x touch-pan-y">
                <PlanCanvas projectId={project.id} onNodeSelect={() => {}} onDecomposeNode={handleDecomposeNode} />
              </div>
            ) : viewMode === "list" ? (
              <div className="absolute inset-0 overflow-hidden">
                <PlanListView projectId={project.id} onNodeSelect={() => {}} />
              </div>
            ) : viewMode === "board" ? (
              <div className="absolute inset-0 overflow-hidden">
                <PlanBoardView projectId={project.id} onNodeSelect={() => {}} />
              </div>
            ) : (
              <div className="absolute inset-0 overflow-hidden">
                <PlanTimelineView projectId={project.id} onNodeSelect={() => {}} />
              </div>
            )}
          </div>
        </div>

        {/* Milestones Section */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Milestones</h3>
            <Plus
              className="h-4 w-4 text-muted-foreground cursor-pointer hover:text-foreground"
              onClick={handleMilestoneAdd}
            />
          </div>
          {milestones.length === 0 ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-6">
              <div className="flex flex-col items-center gap-2 text-center">
                <Diamond className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">No milestones yet</p>
                <p className="text-xs text-muted-foreground">Click the + icon to create your first milestone</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {milestones.map((milestone) => {
                const tasks = allNodes.filter((n) => n.milestoneId === milestone.id && n.type !== "milestone")
                const completed = tasks.filter((t) => t.status === "completed" || t.status === "auto_verified").length
                const pct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0

                return (
                  <div
                    key={milestone.id}
                    className="flex items-start gap-3 rounded-lg bg-muted p-4 cursor-pointer hover:bg-muted/80 transition-colors"
                    onClick={() => handleMilestoneEdit(milestone)}
                  >
                    <Diamond className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div className="flex-1 flex flex-col gap-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{milestone.title}</span>
                        {milestone.dueDate && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            Due {formatDate(milestone.dueDate)}
                          </span>
                        )}
                      </div>
                      {milestone.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{milestone.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground shrink-0">
                          {completed}/{tasks.length}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Resources Section */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Resources</h3>
            <Plus className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-2">
            <div
              className="flex items-center gap-3 rounded-lg bg-muted p-3 px-4 cursor-pointer hover:bg-muted/80 transition-colors"
              onClick={() => setVisionOpen(true)}
            >
              <FileText className="h-[18px] w-[18px] text-primary" />
              <div className="flex-1 flex flex-col gap-0.5">
                <span className="text-sm font-medium">Vision Document</span>
                <span className="text-xs text-muted-foreground">
                  {project.visionDoc ? "Product vision and context for agents" : "Click to add vision context for agents"}
                </span>
              </div>
              <span className="text-xs font-medium text-primary">
                {project.visionDoc ? "Edit" : "Add"}
              </span>
            </div>
            {/* Show repository/directory item when configured */}
            {(project.workingDirectory || project.repository) && (
              <div className="flex flex-col gap-2 rounded-lg bg-muted p-3 px-4">
                <div className="flex items-center gap-3 min-w-0">
                  <FolderGit2 className="h-[18px] w-[18px] text-primary shrink-0" />
                  <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium shrink-0">Working Directory</span>
                      {project.defaultMachineId && (
                        <span className="text-[10px] text-muted-foreground truncate">
                          ({machines.find(m => m.id === project.defaultMachineId)?.hostname || 'unknown'})
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground font-mono truncate" title={project.workingDirectory || project.repository}>
                      {project.workingDirectory || project.repository}
                    </span>
                    {editorUrl && (
                      <span className="text-[10px] text-muted-foreground/70 font-mono truncate mt-0.5 break-all" title={editorUrl}>
                        {editorUrl}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setRepoOpen(true)}
                    className="text-xs font-medium text-primary hover:underline shrink-0"
                  >
                    Edit
                  </button>
                </div>
                {editorUrl && (
                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <Badge
                      variant="outline"
                      className="cursor-pointer hover:bg-muted transition-colors text-[10px] h-6 px-2"
                      onClick={() => setUseLocalUrls(!useLocalUrls)}
                    >
                      {useLocalUrls ? "Local" : "Remote"}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="cursor-pointer hover:bg-muted transition-colors text-[10px] h-6 px-2"
                      onClick={() => setUseVSCode(!useVSCode)}
                    >
                      {useVSCode ? "VSCode" : "Cursor"}
                    </Badge>
                    <a
                      href={editorUrl}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 hover:bg-primary/20 transition-colors h-6"
                    >
                      <ExternalLink className="h-3 w-3 text-primary" />
                      <span className="text-[10px] font-medium text-primary">Open in Editor</span>
                    </a>
                  </div>
                )}
              </div>
            )}
            {/* Only show repository warning when NOT configured */}
            {!(project.workingDirectory || project.repository) && (
              <div
                className="flex items-center gap-3 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 px-4 cursor-pointer hover:bg-amber-500/15 transition-colors"
                onClick={() => setRepoOpen(true)}
              >
                <FolderGit2 className="h-[18px] w-[18px] text-amber-600 dark:text-amber-500" />
                <div className="flex-1 flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-amber-900 dark:text-amber-100">Repository Not Configured</span>
                  <span className="text-xs text-amber-700 dark:text-amber-300">
                    Click to configure working directory for agents
                  </span>
                </div>
                <span className="text-xs font-medium text-amber-600 dark:text-amber-500">
                  Add
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Panel — Properties + Activity OR Chat */}
      <div className="flex w-[320px] shrink-0 flex-col border-l border-border bg-card">
        {chatOpen ? (
          /* Chat Panel */
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-semibold">Plan Chat</h3>
              <button
                onClick={() => {
                  setChatOpen(false)
                  setChatInitialMessage(undefined)
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <MessageSquare className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ChatPanel projectId={project.id} visionDoc={project.visionDoc} initialMessage={chatInitialMessage} />
            </div>
          </div>
        ) : (
          <>
            {/* Properties */}
            <div className="flex flex-col gap-4 p-5">
          <h3 className="text-sm font-semibold">Properties</h3>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Status</span>
            {editingStatus ? (
              <select
                className="text-[13px] rounded-md border border-input bg-background px-2 py-1"
                value={project.status}
                onChange={(e) => {
                  updateProject(project.id, { status: e.target.value as "active" | "archived" })
                  setEditingStatus(false)
                }}
                onBlur={() => setEditingStatus(false)}
                autoFocus
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            ) : (
              <Badge
                variant="success"
                className="text-xs cursor-pointer hover:opacity-80"
                onClick={() => setEditingStatus(true)}
              >
                {project.status === "active" ? "Active" : "Archived"}
              </Badge>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Progress</span>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-16 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-[13px] font-medium">{progress}%</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Health</span>
            <div className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", healthColors[project.health ?? "on_track"])} />
              <span className="text-[13px]">{healthLabels[project.health ?? "on_track"]}</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Est. Completion</span>
            <span className="text-[13px]">{formatDate(project.targetDate)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Lead</span>
            <div className="flex items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                {(project.lead ?? "U").charAt(0)}
              </span>
              <span className="text-[13px]">{project.lead ?? "—"}</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Start Date</span>
            {editingStartDate ? (
              <input
                type="date"
                className="text-[13px] rounded-md border border-input bg-background px-2 py-1"
                value={project.startDate || ""}
                onChange={(e) => {
                  updateProject(project.id, { startDate: e.target.value })
                }}
                onBlur={() => setEditingStartDate(false)}
                autoFocus
              />
            ) : (
              <span
                className="text-[13px] cursor-pointer hover:underline"
                onClick={() => setEditingStartDate(true)}
              >
                {formatDate(project.startDate)}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Target Date</span>
            {editingTargetDate ? (
              <input
                type="date"
                className="text-[13px] rounded-md border border-input bg-background px-2 py-1"
                value={project.targetDate || ""}
                onChange={(e) => {
                  updateProject(project.id, { targetDate: e.target.value })
                }}
                onBlur={() => setEditingTargetDate(false)}
                autoFocus
              />
            ) : (
              <span
                className="text-[13px] cursor-pointer hover:underline"
                onClick={() => setEditingTargetDate(true)}
              >
                {formatDate(project.targetDate)}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">Initiative</span>
            {editingInitiative ? (
              <select
                className="text-[13px] rounded-md border border-input bg-background px-2 py-1"
                value={project.initiativeId || ""}
                onChange={(e) => {
                  updateProject(project.id, { initiativeId: e.target.value || undefined })
                  setEditingInitiative(false)
                }}
                onBlur={() => setEditingInitiative(false)}
                autoFocus
              >
                <option value="">No initiative</option>
                {initiatives
                  .filter(i => i.status === "active")
                  .map((initiative) => (
                    <option key={initiative.id} value={initiative.id}>
                      {initiative.name}
                    </option>
                  ))}
              </select>
            ) : (
              <div
                className="flex items-center gap-1 cursor-pointer hover:opacity-80"
                onClick={() => setEditingInitiative(true)}
              >
                <Rocket className="h-3.5 w-3.5 text-primary" />
                <span className="text-[13px]">
                  {initiatives.find(i => i.id === project.initiativeId)?.name ?? "—"}
                </span>
              </div>
            )}
          </div>

          {/* Labels */}
          {project.labels && project.labels.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Labels</span>
              <div className="flex items-center gap-1 flex-wrap justify-end">
                {project.labels.map((label) => (
                  <span
                    key={label.id}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                    style={{ backgroundColor: label.color }}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* Recent Activity */}
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Recent Activity</h3>
            <span
              className="text-xs text-primary cursor-pointer hover:underline"
              onClick={() => setActivityDialogOpen(true)}
            >
              View all
            </span>
          </div>
          {recentActivities.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-center">
              <div className="flex flex-col gap-1">
                <MessageSquare className="h-5 w-5 text-muted-foreground mx-auto" />
                <p className="text-xs text-muted-foreground">No activity yet</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {recentActivities.map((activity) => {
                // Map activity types to icons
                const iconMap = {
                  "task.completed": { Icon: CircleCheck, color: "text-green-500" },
                  "task.started": { Icon: Play, color: "text-blue-500" },
                  "task.failed": { Icon: User, color: "text-red-500" },
                  "task.cancelled": { Icon: User, color: "text-orange-500" },
                  "milestone.created": { Icon: Plus, color: "text-primary" },
                  "milestone.updated": { Icon: Pencil, color: "text-primary" },
                  "milestone.deleted": { Icon: User, color: "text-red-500" },
                  "vision.updated": { Icon: FileText, color: "text-primary" },
                  "repo.configured": { Icon: FolderGit2, color: "text-primary" },
                  "plan.refined": { Icon: User, color: "text-purple-500" },
                  "project.updated": { Icon: Pencil, color: "text-muted-foreground" },
                  "project.created": { Icon: Rocket, color: "text-purple-500" },
                  "task.created": { Icon: Plus, color: "text-blue-500" },
                }

                const config = iconMap[activity.type] || { Icon: User, color: "text-muted-foreground" }
                const Icon = config.Icon

                return (
                  <div key={activity.id} className="flex gap-2.5">
                    <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", config.color)} />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[13px] truncate">{activity.title}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatRelativeTime(activity.timestamp)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <Separator />

        {/* Updates (Comment-like section) */}
        <div className="flex flex-col flex-1 min-h-0 p-5">
          <h3 className="text-sm font-semibold mb-3">Updates</h3>
          <div className="flex-1 overflow-y-auto pr-2 -mr-2">
            <div className="flex items-center justify-center h-full text-center">
              <div className="flex flex-col gap-1">
                <MessageSquare className="h-5 w-5 text-muted-foreground mx-auto" />
                <p className="text-xs text-muted-foreground">No updates yet</p>
              </div>
            </div>
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  )
}

// --- Main Project Overview Page ---
export function ProjectOverview() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const initialView = searchParams.get("view") as ViewMode | null
  const project = useProjectStore((s) => s.projects.find((p) => p.id === id))
  const updateFileTree = useProjectStore((s) => s.updateFileTree)
  const updateProject = useProjectStore((s) => s.updateProject)
  const [viewMode, setViewMode] = useState<ViewMode>(initialView && VALID_VIEWS.has(initialView) ? initialView : "list")
  const [chatOpen, setChatOpen] = useState(false)
  const [isEnlarged, setIsEnlarged] = useState(false)

  // Refresh file tree cache if stale, missing, or from a different machine
  useEffect(() => {
    if (!project?.workingDirectory) return
    const machineId = project.defaultMachineId
    const cachedForMachine = project.fileTreeMachineId || 'local'
    const currentMachine = machineId || 'local'
    const updatedAt = project.fileTreeUpdatedAt ? new Date(project.fileTreeUpdatedAt).getTime() : 0
    const isStale = Date.now() - updatedAt >= FILE_TREE_STALE_MS || !project.fileTree?.length
    const isMachineMismatch = cachedForMachine !== currentMachine
    if (!isStale && !isMachineMismatch) return

    if (machineId) {
      const params = new URLSearchParams({ projectId: project.id, machineId, workingDirectory: project.workingDirectory })
      fetch(`/api/fs/files?${params}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.files?.length) updateFileTree(project.id, data.files, machineId)
        })
        .catch(() => {})
    } else {
      fetch(`/api/repo/file-tree?workingDirectory=${encodeURIComponent(project.workingDirectory)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.files?.length) updateFileTree(project.id, data.files)
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.workingDirectory, project?.defaultMachineId])

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Project not found
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Single-line header: identity */}
      <div className="flex items-center gap-3 border-b border-border px-6 h-14 shrink-0">
        <ColorIconBadge
          color={project.color}
          icon={project.icon}
          type="project"
          editable
          onColorChange={(color) => updateProject(project.id, { color })}
          onIconChange={(icon) => updateProject(project.id, { icon })}
        />
        <span className="text-lg font-semibold shrink-0">{project.name}</span>
        <Star className="h-[18px] w-[18px] text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0" />
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden relative">
        <OverviewTab
          project={project}
          viewMode={viewMode}
          setViewMode={setViewMode}
          chatOpen={chatOpen}
          setChatOpen={setChatOpen}
          isEnlarged={isEnlarged}
          setIsEnlarged={setIsEnlarged}
        />
      </div>
    </div>
  )
}

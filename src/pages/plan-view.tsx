import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useParams, useLocation, useNavigate } from "react-router"
import { useProjectData } from "@/hooks/use-project-data"
import { Diamond, Trash2, GitPullRequestDraft, GitPullRequest, Play, Pencil, GitBranch, ChevronLeft, ChevronDown, ChevronRight, MoreVertical, FolderGit2, Clock, RotateCcw, RefreshCw, Sparkles, Globe, GitFork, X, Settings2, PlayCircle, Square, Scissors, Bot, Check, FileText, Loader2, CircleCheck, Target, Users, Download, Link2, BookOpen, List, Network, CalendarRange, Columns3, PanelRight } from "lucide-react"
import { useMediaQuery } from "@/hooks/use-media-query"
import { VisionDocDialog } from "@/components/vision-doc-dialog"
import { RichTextEditor, type RichTextEditorRef } from "@/components/ui/rich-text-editor"
import { resolveEditorContent, fileToBase64 } from "@/lib/html-utils"
import { dataClient } from "@/lib/data-client"

import { PlanHistory } from "@/components/plan-history"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { TaskRow } from "@/components/task-row"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { PlanCanvas } from "@/components/plan-graph/plan-canvas"
import { ChatPanel } from "@/components/agent/chat-panel"
import { NodeInspectorSheet, NodeInspectorSidebar } from "@/components/node-inspector"
import { BoardView } from "@/components/board/board-view"
import { DisplayPopover, type DisplayPopoverConfig } from "@/components/display-popover"
import { ItemListView, type ListColumn, type ListGroup, type BatchAction } from "@/components/views/item-list-view"
import { ItemTimelineView, TimelineAddTaskFooter, type TimelineRow } from "@/components/views/item-timeline-view"
import { PropertyPicker } from "@/components/property-picker"
import { LabelPicker } from "@/components/label-picker"
import { LabelManagerDialog } from "@/components/label-manager-dialog"
import { ColorIconBadge } from "@/components/color-icon-picker"
import { InlineRenameInput } from "@/components/inline-rename-input"
import { validateProjectName } from "@/lib/project-validation"
import { KnowledgePanel } from "@/components/knowledge-panel"
import { RepoExplorer } from "@/components/repo-explorer/repo-explorer"
import { RepoConfigDialog } from "@/components/repo-config-dialog"
import { PublishDialog } from "@/components/community/publish-dialog"
import { GitHubSyncSettingsDialog } from "@/components/github-sync-settings-dialog"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { SyncHealthDot } from "@/components/github-sync-health"
import { useMachinesStore } from "@/stores/machines-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useDisplaySettingsStore, type DisplaySettings, type ViewKey } from "@/stores/display-settings-store"
import { useActivityStore } from "@/stores/activity-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useContentSaveStore } from "@/stores/content-save-store"
import { useToastStore } from "@/stores/toast-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useKeyboardNavStore } from "@/stores/keyboard-nav-store"
import { PRIORITY_CONFIG, PRIORITY_OPTIONS, ESTIMATE_OPTIONS, STATUS_OPTIONS } from "@/lib/constants"
import { statusLabels, statusBadgeVariants, statusBarColors, statusProgressColors } from "@/lib/status-config"
import { formatDueDateShort, formatDuration } from "@/lib/date-utils"
import { assignDefaultDates } from "@/lib/timeline-utils"
import { remoteTypeLabel } from "@/lib/project-source"
import {
  getProjectGroupDescriptor,
  getProjectGroupDescriptorForId,
  getProjectGroupSeedProjects,
} from "@/lib/project-grouping"
import { isServerMode } from "@/lib/app-mode"
import { useFeatureFlag } from "@/hooks/use-feature-flag"
import { cn } from "@/lib/utils"
import { exportProject, downloadBundle } from "@/lib/sharing/export-project"
import { useInitiativeStore } from "@/stores/initiative-store"
import { useTeamStore } from "@/stores/team-store"
import { splitTitleDescription } from "@/lib/text-utils"
import { topologicalSortNodes } from "@/lib/graph-sort-utils"
import { useFileTreeRefresh } from "@/hooks/use-file-tree-refresh"
import { apiUrl } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { useSettingsStore } from "@/stores/settings-store"
import { PROVIDER_NAMES } from "@/components/execution/provider-utils"
import type { PlanNode, Priority, Project } from "@/types"

type ViewMode = "graph" | "list" | "timeline" | "board"

const statusVariant = statusBadgeVariants

const planListDisplayConfig: DisplayPopoverConfig = {
  viewKey: "plan-list",
  groupByOptions: [
    { value: "none", label: "No grouping" },
    { value: "milestone", label: "Milestone" },
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "label", label: "Label" },
  ],
  orderByOptions: [
    { value: "number", label: "Task number" },
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "dueDate", label: "Due date" },
    { value: "dependency", label: "Dependency order" },
  ],
  propertyOptions: [
    { value: "priority", label: "Priority" },
    { value: "status", label: "Status" },
    { value: "progress", label: "Progress" },
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
    { value: "label", label: "Label" },
  ],
  orderByOptions: [
    { value: "name", label: "Name" },
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "dueDate", label: "Due date" },
    { value: "dependency", label: "Dependency order" },
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

const planGraphDisplayConfig: DisplayPopoverConfig = {
  viewKey: "plan-graph",
  groupByOptions: [],
  orderByOptions: [],
  propertyOptions: [],
}

/** Shared "View as" options — all four view modes listed in logical order */
const PLAN_VIEW_AS_OPTIONS = [
  { value: "list", label: "List" },
  { value: "board", label: "Board" },
  { value: "timeline", label: "Timeline" },
  { value: "graph", label: "Graph" },
]


// --- Execute All button (self-contained, reads from stores) ---
function ExecuteAllButton({ projectId }: { projectId: string }) {
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const executeAllProject = useExecutionStore((s) => s.executeAllProject)
  const stopBatchExecution = useExecutionStore((s) => s.stopBatchExecution)
  const batchExecution = useExecutionStore((s) => s.batchExecutions.get(projectId))
  const flushPendingSaves = useContentSaveStore((s) => s.flushPendingSaves)

  const allProjectNodes = useMemo(() => planNodes.filter((n) => n.projectId === projectId), [planNodes, projectId])
  const isBatchActive = batchExecution?.active ?? false
  const plannedCount = allProjectNodes.filter((n) => n.status === "planned" && n.type !== "milestone").length
  const executingCount = allProjectNodes.filter((n) => (n.status === "dispatched" || n.status === "in_progress") && n.type !== "milestone").length

  const handleExecuteAll = useCallback(async () => {
    if (!project?.defaultMachineId) {
      useToastStore.getState().add({
        type: "warning",
        title: "No machine connected",
        description: "Connect a machine in Environments before executing tasks.",
      })
      return
    }
    const nodeIds = allProjectNodes.map((n) => n.id)
    try {
      await flushPendingSaves(nodeIds)
    } catch (error) {
      console.error('Failed to save task content before execution:', error)
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to save changes',
        description: 'Could not save task content before execution. Please try again.',
      })
      return
    }
    executeAllProject(projectId)
  }, [executeAllProject, projectId, project, allProjectNodes, flushPendingSaves])

  if (isBatchActive) {
    return (
      <div className="flex items-center gap-2">
        <div className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </div>
        <span className="text-xs font-medium text-foreground">
          Executing{executingCount > 0 ? ` (${executingCount} running` : ""}
          {plannedCount > 0 ? `, ${plannedCount} queued)` : executingCount > 0 ? ")" : "..."}
        </span>
        <button
          type="button"
          onClick={() => stopBatchExecution(projectId)}
          title="Stop queuing new tasks (running tasks will finish)"
          className="flex h-6 items-center gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
        >
          <Square className="h-3 w-3" />
          Stop
        </button>
      </div>
    )
  }

  if (plannedCount <= 0) return null

  return (
    <button
      type="button"
      onClick={handleExecuteAll}
      title={`Execute all ${plannedCount} planned tasks in dependency order`}
      className="flex h-6 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 text-xs font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer"
    >
      <PlayCircle className="h-3.5 w-3.5" />
      Execute All ({plannedCount})
    </button>
  )
}

// --- Editor app definitions for "Open in" dropdown ---
// --- Editor app icon helper ---
function AppIcon({ appId, className }: { appId: string; className?: string }) {
  return <img src={`/app-icons/${appId}.png`} alt="" className={cn("rounded-[3px]", className)} draggable={false} />
}

const EDITOR_APPS = [
  { id: 'cursor', label: 'Cursor', scheme: 'cursor' },
  { id: 'vscode', label: 'VS Code', scheme: 'vscode' },
  { id: 'vscode-insiders', label: 'VS Code Insiders', scheme: 'vscode-insiders' },
  { id: 'finder', label: 'Finder', scheme: 'finder' },
  { id: 'terminal', label: 'Terminal', scheme: 'terminal' },
  { id: 'iterm', label: 'iTerm2', scheme: 'iterm' },
  { id: 'ghostty', label: 'Ghostty', scheme: 'ghostty' },
  { id: 'xcode', label: 'Xcode', scheme: 'xcode' },
] as const

type EditorAppId = (typeof EDITOR_APPS)[number]['id']

function buildEditorUrl(appId: EditorAppId, path: string, isRemote: boolean, machineName?: string): string | null {
  const app = EDITOR_APPS.find((a) => a.id === appId)
  if (!app || !path) return null
  const scheme = app.scheme
  // Terminal-type apps: open via x-man-page or custom handler
  if (appId === 'finder') return `file://${path}`
  if (appId === 'terminal') return `terminal://open?path=${encodeURIComponent(path)}`
  if (appId === 'iterm') return `iterm2://open?path=${encodeURIComponent(path)}`
  if (appId === 'ghostty') return `ghostty://open?path=${encodeURIComponent(path)}`
  if (appId === 'xcode') return `xcode://open?path=${encodeURIComponent(path)}`
  // VS Code / Cursor family
  if (isRemote && machineName) {
    return `${scheme}://vscode-remote/ssh-remote+${machineName}${path.startsWith('/') ? '' : '/'}${path}`
  }
  return `${scheme}://file${path}`
}

// --- Compact workdir bar shown at bottom of plan view ---
function WorkdirBar({ project }: { project: Project }) {
  const [repoOpen, setRepoOpen] = useState(false)
  const machines = useMachinesStore((s) => s.machines)
  const fetchMachines = useMachinesStore((s) => s.fetchMachines)
  const liveMachines = useExecutionStore((s) => s.machines)
  const defaultProvider = useSettingsStore((s) => s.defaultProvider)
  const setDefaultProvider = useSettingsStore((s) => s.setDefaultProvider)
  const editorType = useSettingsStore((s) => s.editorType)
  const setEditorType = useSettingsStore((s) => s.setEditorType)
  const [selectedApp, setSelectedApp] = useState<EditorAppId>(editorType === 'vscode' ? 'vscode' : 'cursor')
  const [useRemote, setUseRemote] = useState(false)

  useEffect(() => {
    if (machines.length === 0) fetchMachines()
  }, [machines.length, fetchMachines])

  const defaultMachine = project.defaultMachineId
    ? machines.find((m) => m.id === project.defaultMachineId)
    : (machines.length === 1 ? machines[0] : undefined)

  // Resolve available providers for the selected machine
  const providerIds = useMemo(() => {
    const machineId = defaultMachine?.id
    if (!machineId) return []
    const live = liveMachines.find((lm) => lm.machineId === machineId)
    const reg = machines.find((m) => m.id === machineId)
    return live?.providers?.map((p) => p.type) ?? reg?.providers ?? []
  }, [defaultMachine?.id, liveMachines, machines])

  const editorUrl = project.workingDirectory
    ? buildEditorUrl(selectedApp, project.workingDirectory, useRemote, defaultMachine?.name)
    : null

  const selectedAppDef = EDITOR_APPS.find((a) => a.id === selectedApp)!

  const hasWorkdir = !!(project.workingDirectory || project.repository)

  // Sync selectedApp → settings store for apps that map to editor types
  const handleSelectApp = useCallback((appId: EditorAppId) => {
    setSelectedApp(appId)
    if (appId === 'vscode' || appId === 'vscode-insiders') setEditorType('vscode')
    else if (appId === 'cursor') setEditorType('cursor')
  }, [setEditorType])

  return (
    <>
      <RepoConfigDialog open={repoOpen} onOpenChange={setRepoOpen} project={project} />
      <div className="flex items-center gap-2 border-t border-border/60 px-3 md:px-6 h-9 shrink-0 bg-muted/20 text-xs">
        {hasWorkdir ? (
          <>
            <button
              onClick={() => setRepoOpen(true)}
              className="flex items-center gap-1.5 min-w-0 px-2 py-0.5 -ml-2 rounded-md hover:bg-muted hover:text-foreground transition-colors cursor-pointer text-xs font-mono text-muted-foreground"
              title="Edit working directory"
            >
              <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
              {project.source?.isGit && (
                <>
                  <span className="shrink-0">
                    {project.githubOwner && project.githubRepo
                      ? `${project.githubOwner}/${project.githubRepo}`
                      : project.source.remoteType !== 'none'
                        ? remoteTypeLabel(project.source.remoteType)
                        : 'Local Git'}
                  </span>
                  {project.source.baseBranch && (
                    <>
                      <span className="opacity-40">/</span>
                      <GitBranch className="h-3 w-3 shrink-0" />
                      <span className="shrink-0">{project.source.baseBranch}</span>
                    </>
                  )}
                  {project.projectPrUrl ? (
                    <>
                      <span className="opacity-30 mx-0.5">|</span>
                      <a
                        href={project.projectPrUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-0.5 text-primary hover:underline shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GitPullRequest className="h-3 w-3" />
                        <span>PR #{project.projectPrNumber}</span>
                      </a>
                    </>
                  ) : project.projectBranch && project.source?.remoteType === 'none' ? (
                    <>
                      <span className="opacity-30 mx-0.5">|</span>
                      <span className="flex items-center gap-0.5 shrink-0" title={`Results on branch: ${project.projectBranch}`}>
                        <GitBranch className="h-3 w-3 text-emerald-500" />
                        <span className="text-emerald-600 dark:text-emerald-400">{project.projectBranch}</span>
                      </span>
                    </>
                  ) : null}
                  <span className="opacity-30 mx-0.5">|</span>
                </>
              )}
              <span className="truncate" title={project.workingDirectory || project.repository}>
                {project.workingDirectory || project.repository}
              </span>
              {defaultMachine && (
                <span className="opacity-60 shrink-0">
                  ({defaultMachine.name || 'unknown'})
                </span>
              )}
            </button>

            {/* AI Agent selector */}
            {providerIds.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-border hover:bg-muted transition-colors text-xs shrink-0 cursor-pointer">
                    <Bot className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      {defaultProvider ? (PROVIDER_NAMES[defaultProvider] || defaultProvider) : "Auto"}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="start">
                  <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">AI Agent</p>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted transition-colors",
                      !defaultProvider && "bg-accent/50"
                    )}
                    onClick={() => setDefaultProvider("")}
                  >
                    <span className="flex-1 text-left text-muted-foreground">Auto</span>
                    {!defaultProvider && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                  {providerIds.map((pid) => (
                    <button
                      key={pid}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted transition-colors",
                        pid === defaultProvider && "bg-accent/50"
                      )}
                      onClick={() => setDefaultProvider(pid)}
                    >
                      <span className="flex-1 text-left font-medium">{PROVIDER_NAMES[pid] || pid}</span>
                      {pid === defaultProvider && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            )}

            <div className="flex items-center gap-2 ml-auto shrink-0">
              <ExecuteAllButton projectId={project.id} />

              {/* Open in editor: icon button + dropdown */}
              {project.workingDirectory && (
                <div className="flex items-center">
                  {/* Direct open button */}
                  <a
                    href={editorUrl ?? '#'}
                    className={cn(
                      "flex items-center justify-center h-7 w-7 rounded-l-md border border-border hover:bg-muted transition-colors",
                      !editorUrl && "pointer-events-none opacity-40"
                    )}
                    title={`Open in ${selectedAppDef.label}`}
                  >
                    <AppIcon appId={selectedApp} className="h-4 w-4" />
                  </a>
                  {/* Dropdown chevron */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="flex items-center justify-center h-7 w-5 rounded-r-md border border-l-0 border-border hover:bg-muted transition-colors cursor-pointer">
                        <ChevronLeft className="h-3 w-3 text-muted-foreground rotate-[270deg]" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-1" align="end" side="top">
                      {EDITOR_APPS.map((app) => (
                        <button
                          key={app.id}
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors cursor-pointer",
                            app.id === selectedApp && "bg-accent/50"
                          )}
                          onClick={() => handleSelectApp(app.id)}
                        >
                          <AppIcon appId={app.id} className="h-4 w-4" />
                          <span className="flex-1 text-left font-medium">{app.label}</span>
                          {app.id === selectedApp && <Check className="h-3.5 w-3.5 text-primary" />}
                        </button>
                      ))}
                      {/* Local/Remote toggle */}
                      <div className="border-t border-border mt-1 pt-1 px-3 py-2 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Remote (SSH)</span>
                        <button
                          type="button"
                          onClick={() => setUseRemote(!useRemote)}
                          className={cn(
                            "relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer",
                            useRemote ? "bg-primary" : "bg-muted-foreground/30"
                          )}
                        >
                          <span className={cn(
                            "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform shadow-sm",
                            useRemote ? "translate-x-[18px]" : "translate-x-[3px]"
                          )} />
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => setRepoOpen(true)}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
              <span>Set working directory</span>
            </button>
            <div className="ml-auto shrink-0">
              <ExecuteAllButton projectId={project.id} />
            </div>
          </>
        )}
      </div>
    </>
  )
}

// --- Fork source lineage banner ---
interface ForkSource {
  type: 'community-fork'
  planId: string
  planTitle: string
  authorName: string | null
  forkedAt: string
}

function ForkSourceBanner({ project }: { project: Project }) {
  const navigate = useNavigate()
  // Use lazy initializer to check localStorage for dismissal state
  const [isDismissed, setIsDismissed] = useState(() => {
    const dismissKey = `fork-banner-dismissed-${project.id}`
    return localStorage.getItem(dismissKey) === 'true'
  })

  // Check if project has fork source metadata
  // The source field can be a ProjectSource (git info) or a fork source
  const forkSource = project.source as unknown as ForkSource | undefined
  const isCommunityFork = forkSource?.type === 'community-fork'

  if (!isCommunityFork || isDismissed) {
    return null
  }

  const handleDismiss = () => {
    const dismissKey = `fork-banner-dismissed-${project.id}`
    localStorage.setItem(dismissKey, 'true')
    setIsDismissed(true)
  }

  const handleNavigateToPlan = () => {
    navigate(`/community/plans/${forkSource.planId}`)
  }

  return (
    <Alert variant="info" className="mx-3 md:mx-6 mt-2 mb-0 py-2 pr-10 relative">
      <GitFork className="h-4 w-4" />
      <AlertDescription className="flex items-center gap-1 text-sm">
        <span>Forked from</span>
        <button
          onClick={handleNavigateToPlan}
          className="font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
        >
          {forkSource.planTitle}
        </button>
        {forkSource.authorName && (
          <>
            <span>by</span>
            <span className="font-medium">{forkSource.authorName}</span>
          </>
        )}
      </AlertDescription>
      <button
        onClick={handleDismiss}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-blue-500/10 transition-colors cursor-pointer"
        title="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </Alert>
  )
}

// --- Collapsible project info section (description + properties) ---
function ProjectInfoSection({ project }: { project: Project }) {
  const [expanded, setExpanded] = useState(false)
  const [visionOpen, setVisionOpen] = useState(false)
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const updateProject = useProjectStore((s) => s.updateProject)
  const initiatives = useInitiativeStore((s) => s.initiatives)
  const addActivity = useActivityStore((s) => s.addActivity)
  const teams = useTeamStore((s) => s.teams)

  const [descriptionDraft, setDescriptionDraft] = useState(() => resolveEditorContent(project.description))
  const [descriptionSaveStatus, setDescriptionSaveStatus] = useState<"idle" | "saving" | "saved">("idle")
  const descriptionEditorRef = useRef<RichTextEditorRef>(null)
  const descriptionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)


  const handleDescriptionChange = useCallback((html: string) => {
    setDescriptionDraft(html)
    if (html === project.description) return
    if (descriptionDebounceRef.current) clearTimeout(descriptionDebounceRef.current)
    descriptionDebounceRef.current = setTimeout(() => {
      setDescriptionSaveStatus("saving")
      updateProject(project.id, { description: html })
      addActivity({ projectId: project.id, type: "project.updated", title: "Updated project description" })
      setDescriptionSaveStatus("saved")
      setTimeout(() => setDescriptionSaveStatus("idle"), 1500)
    }, 800)
  }, [project.id, project.description, updateProject, addActivity])

  useEffect(() => {
    return () => { if (descriptionDebounceRef.current) clearTimeout(descriptionDebounceRef.current) }
  }, [])

  const handleDescriptionImageUpload = useCallback(async (file: File): Promise<string | null> => {
    try {
      const base64 = await fileToBase64(file)
      const blobId = await dataClient.uploadBlob(base64, file.type, file.size, file.name, project.id, project.id)
      return dataClient.getBlobUrl(blobId)
    } catch (err) {
      console.error('Failed to upload image:', err)
      return null
    }
  }, [project.id])

  return (
    <>
      <VisionDocDialog open={visionOpen} onOpenChange={setVisionOpen} project={project} />
      <Dialog open={knowledgeOpen} onOpenChange={setKnowledgeOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto p-0">
          <KnowledgePanel projectId={project.id} />
        </DialogContent>
      </Dialog>
      <div className="border-b border-border/30">
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-4 h-8 text-[12px] text-muted-foreground hover:bg-muted/20 transition-colors cursor-pointer select-none"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-2">
              {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
              <FileText className="h-3 w-3 shrink-0" />
              <span>Notes</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{expanded ? "Click to collapse notes" : "Click to expand notes"}</TooltipContent>
        </Tooltip>

        {/* Initiative */}
        <div className="relative group/initiative" onClick={(e) => e.stopPropagation()}>
          <button className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-muted/40 transition-colors cursor-pointer">
            <Target className="h-3 w-3 shrink-0" />
            <span className="truncate max-w-[120px]">{project.initiativeId ? (initiatives.find(i => i.id === project.initiativeId)?.name ?? "—") : "No initiative"}</span>
          </button>
          <div className="absolute top-full left-0 pt-1 invisible group-hover/initiative:visible opacity-0 group-hover/initiative:opacity-100 transition-all z-50">
            <div className="bg-popover border border-border rounded-lg shadow-lg p-1 min-w-[140px]">
              <button
                className={cn("flex w-full items-center rounded-sm px-2 py-1.5 text-[12px] hover:bg-muted/60 transition-colors", !project.initiativeId && "text-primary font-medium")}
                onClick={() => updateProject(project.id, { initiativeId: undefined })}
              >
                No initiative
              </button>
              {initiatives.filter(i => i.status === "active").map((i) => (
                <button
                  key={i.id}
                  className={cn("flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-[12px] hover:bg-muted/60 transition-colors", project.initiativeId === i.id && "text-primary font-medium")}
                  onClick={() => updateProject(project.id, { initiativeId: i.id })}
                >
                  <Target className="h-3 w-3 shrink-0" />
                  <span className="truncate">{i.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Team (multi-team) */}
        {teams.length > 1 && (
          <div className="relative group/team" onClick={(e) => e.stopPropagation()}>
            <button className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-muted/40 transition-colors cursor-pointer">
              <Users className="h-3 w-3 shrink-0" />
              <span className="truncate max-w-[100px]">{teams.find(t => t.id === project.teamId)?.name ?? teams[0]?.name}</span>
            </button>
            <div className="absolute top-full left-0 pt-1 invisible group-hover/team:visible opacity-0 group-hover/team:opacity-100 transition-all z-50">
              <div className="bg-popover border border-border rounded-lg shadow-lg p-1 min-w-[120px]">
                {teams.map((t) => (
                  <button
                    key={t.id}
                    className={cn("flex w-full items-center rounded-sm px-2 py-1.5 text-[12px] hover:bg-muted/60 transition-colors", project.teamId === t.id && "text-primary font-medium")}
                    onClick={() => updateProject(project.id, { teamId: t.id })}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* skill.md */}
        <button onClick={(e) => { e.stopPropagation(); setVisionOpen(true) }} className="flex items-center gap-1 hover:text-foreground transition-colors">
          <FileText className="h-3 w-3" />
          <span>skill.md</span>
        </button>

        {/* Knowledge */}
        <button onClick={(e) => { e.stopPropagation(); setKnowledgeOpen(true) }} className="flex items-center gap-1 hover:text-foreground transition-colors">
          <BookOpen className="h-3 w-3" />
          <span>Knowledge</span>
        </button>

        <div className="flex-1" />
      </div>

      {/* Expanded: notes */}
      {expanded && (
        <div className="px-4 pb-3 pt-1">
          <div className="flex items-center justify-end mb-1">
            {descriptionSaveStatus !== "idle" && (
              <span className="text-[11px] text-muted-foreground/40 flex items-center gap-1">
                {descriptionSaveStatus === "saving" && <><Loader2 className="h-2.5 w-2.5 animate-spin" />Saving</>}
                {descriptionSaveStatus === "saved" && <><CircleCheck className="h-2.5 w-2.5" />Saved</>}
              </span>
            )}
          </div>
          <RichTextEditor
            ref={descriptionEditorRef}
            content={descriptionDraft}
            onChange={handleDescriptionChange}
            placeholder="Add notes — goals, context, key details..."
            onImageUpload={handleDescriptionImageUpload}
            className="min-h-[80px] text-[13px]"
          />
        </div>
      )}
      </div>
    </>
  )
}

// --- Floating chat bubble: unified for mobile + desktop ---
function FloatingChat({
  projectId,
  visionDoc,
  initialMessage,
  onNodeSelect,
  isMobile,
}: {
  projectId: string
  visionDoc?: string
  initialMessage?: string
  onNodeSelect: (nodeId: string) => void
  isMobile: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [pos, setPos] = useState(() => ({
    x: typeof window !== 'undefined' ? window.innerWidth - 72 : 0,
    y: typeof window !== 'undefined' ? window.innerHeight - (isMobile ? 160 : 130) : 0,
  }))
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 })
  const hasMoved = useRef(false)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true
    hasMoved.current = false
    dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [pos])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasMoved.current = true
    setPos({
      x: Math.max(52, Math.min(window.innerWidth - 56, dragStart.current.posX + dx)),
      y: Math.max(40, Math.min(window.innerHeight - 56, dragStart.current.posY + dy)),
    })
  }, [])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    if (!hasMoved.current) setExpanded((v) => !v)
  }, [])

  // Panel dimensions — larger on desktop
  const panelW = isMobile ? Math.min(340, window.innerWidth - 68) : Math.min(420, window.innerWidth - 100)
  const panelH = isMobile ? Math.min(460, window.innerHeight - 140) : Math.min(560, window.innerHeight - 80)
  // Anchor panel above+left of FAB, clamp to viewport
  const panelX = Math.max(56, Math.min(pos.x - panelW + 48, window.innerWidth - panelW - 12))
  const panelY = Math.max(12, Math.min(pos.y - panelH - 12, window.innerHeight - panelH - 12))

  return (
    <>
      {/* Expanded floating sheet */}
      {expanded && (
        <>
          <div
            className="fixed inset-0 z-40"
            onPointerDown={() => setExpanded(false)}
          />
          <div
            className={cn(
              "fixed z-40 flex flex-col bg-card overflow-hidden",
              "rounded-2xl shadow-[0_8px_40px_-8px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_40px_-8px_rgba(0,0,0,0.4)]",
              "border border-border/50",
              "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200",
            )}
            style={{ left: panelX, top: panelY, width: panelW, height: panelH }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ChatPanel
              projectId={projectId}
              visionDoc={visionDoc}
              initialMessage={initialMessage}
              onNodeSelect={onNodeSelect}
            />
          </div>
        </>
      )}

      {/* Draggable FAB */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={cn(
          "fixed z-40 flex items-center justify-center rounded-full touch-none select-none cursor-pointer",
          "transition-all duration-200 ease-out",
          expanded
            ? "h-10 w-10 bg-primary text-primary-foreground shadow-md"
            : "h-12 w-12 bg-card shadow-[0_2px_16px_-2px_rgba(0,0,0,0.12)] dark:shadow-[0_2px_16px_-2px_rgba(0,0,0,0.35)] border border-border/50 hover:shadow-[0_4px_20px_-2px_rgba(0,0,0,0.18)] hover:scale-110 active:scale-95",
        )}
        style={{ left: pos.x, top: pos.y }}
      >
        {expanded ? (
          <X className="h-4 w-4" />
        ) : (
          <Sparkles className="h-5 w-5 text-primary" />
        )}
      </div>
    </>
  )
}

// --- Shared sorting logic for plan nodes ---
function sortPlanNodes(nodes: PlanNode[], orderBy: string, dir: number): PlanNode[] {
  if (orderBy === "dependency") {
    const topoSorted = topologicalSortNodes([...nodes])
    return dir === 1 ? topoSorted : topoSorted.reverse()
  }
  const sorted = [...nodes]
  sorted.sort((a, b) => {
    switch (orderBy) {
      case "number":
        return dir * ((a.number ?? Infinity) - (b.number ?? Infinity))
      case "status":
        return dir * a.status.localeCompare(b.status)
      case "priority": {
        const order = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }
        return dir * ((order[a.priority as keyof typeof order] ?? 4) - (order[b.priority as keyof typeof order] ?? 4))
      }
      case "dueDate": {
        const da = a.dueDate ?? ""
        const db = b.dueDate ?? ""
        return dir * da.localeCompare(db)
      }
      default:
        return 0
    }
  })
  return sorted
}

// LabelPicker extracted to @/components/label-picker

// --- Progress cell (needs hooks, so it's a component) ---
function ProgressCell({ node }: { node: PlanNode }) {
  const stream = useRealtimeStore((s) =>
    node.executionId ? s.taskStreams.get(node.executionId) : undefined
  )
  const progress = stream?.progress ?? 0
  const isRunning = node.status === "in_progress" || node.status === "dispatched"
  const hasStarted = !!node.executionStartedAt

  if (!isRunning && !hasStarted) return null

  const elapsed = hasStarted ? formatDuration(node.executionStartedAt, node.executionCompletedAt) : null

  return (
    <div className="flex items-center gap-1.5 w-full min-w-0">
      {isRunning && progress > 0 ? (
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[40px]">
            <div
              className="h-full rounded-full bg-info transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] font-medium text-info tabular-nums shrink-0">{progress}%</span>
        </div>
      ) : isRunning ? (
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex gap-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-info animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-info animate-pulse [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-info animate-pulse [animation-delay:300ms]" />
          </div>
        </div>
      ) : null}
      {elapsed && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground tabular-nums shrink-0">
          <Clock className="h-2.5 w-2.5" />
          {elapsed}
        </span>
      )}
    </div>
  )
}

// --- Plan List Column Definitions ---
function makePlanColumns(
  project: { labels?: { id: string; name: string; color: string }[] } | undefined,
  milestoneMap: Map<string, string>,
  onNodeUpdate?: (id: string, updates: Partial<PlanNode>) => void,
  projectMap?: Map<string, string>,
  _executionOrderMap?: Map<string, number>,
  onManageLabels?: () => void,
  onExecute?: (node: PlanNode) => void,
  showTaskNumbers?: boolean,
): ListColumn<PlanNode>[] {
  return [
    {
      id: "name",
      label: "Task",
      width: "flex-1 min-w-0",
      sortKey: "number",
      render: (node) => {
        return (
          <span className={cn("text-sm truncate flex items-center gap-1.5", node.status === "pruned" && "line-through")}>
            {onExecute && node.status === 'planned' && (
              <button
                type="button"
                title="Execute task"
                onClick={(e) => {
                  e.stopPropagation()
                  onExecute(node)
                }}
                className="shrink-0 flex items-center justify-center w-5 h-5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
              >
                <Play className="h-3 w-3 fill-current" />
              </button>
            )}
            {showTaskNumbers && node.number != null && <span className="text-muted-foreground tabular-nums">{node.number}</span>}
            <span className="truncate">{node.title}</span>
          </span>
        )
      },
    },
    {
      id: "priority",
      label: "Priority",
      width: "w-[60px]",
      sortKey: "priority",
      batchPropertyOptions: onNodeUpdate ? PRIORITY_OPTIONS : undefined,
      onBatchPropertySet: onNodeUpdate ? (value, selectedIds) => {
        selectedIds.forEach((id) => onNodeUpdate(id, { priority: value as Priority }))
      } : undefined,
      render: (node) => {
        const config = PRIORITY_CONFIG[(node.priority ?? "none") as Priority]
        const PIcon = config.icon
        return (
          <PropertyPicker
            value={node.priority ?? "none"}
            options={PRIORITY_OPTIONS}
            title="Set priority"
            disabled={!onNodeUpdate}
            onSelect={(id) => onNodeUpdate?.(node.id, { priority: id as Priority })}
          >
            <PIcon className={cn("h-3.5 w-3.5", config.color)} />
          </PropertyPicker>
        )
      },
    },
    {
      id: "status",
      label: "Status",
      width: "w-[120px]",
      sortKey: "status",
      batchPropertyOptions: onNodeUpdate ? STATUS_OPTIONS : undefined,
      onBatchPropertySet: onNodeUpdate ? (value, selectedIds) => {
        selectedIds.forEach((id) => onNodeUpdate(id, { status: value as PlanNode["status"] }))
      } : undefined,
      render: (node) => (
        <PropertyPicker
          value={node.status}
          options={STATUS_OPTIONS}
          title="Set status"
          disabled={!onNodeUpdate}
          onSelect={(id) => onNodeUpdate?.(node.id, { status: id as PlanNode["status"] })}
        >
          <Badge variant={statusVariant[node.status] ?? "secondary"} className="text-[10px]">
            {node.status.replace(/_/g, " ")}
          </Badge>
        </PropertyPicker>
      ),
    },
    {
      id: "progress",
      label: "Progress",
      width: "w-[120px]",
      render: (node) => <ProgressCell node={node} />,
    },
    {
      id: "dueDate",
      label: "Due Date",
      width: "w-[100px]",
      sortKey: "dueDate",
      render: (node) => {
        const { text, className } = formatDueDateShort(node.dueDate)
        return (
          <div
            className="relative inline-flex items-center rounded-sm p-0.5 -m-0.5 hover:bg-muted transition-colors cursor-pointer"
            onClick={(e) => e.stopPropagation()}
          >
            <span className={cn("text-xs", className)}>{text}</span>
            {onNodeUpdate && (
              <input
                type="date"
                value={node.dueDate || ""}
                onChange={(e) => onNodeUpdate(node.id, { dueDate: e.target.value || undefined })}
                className="absolute inset-0 opacity-0 cursor-pointer"
                tabIndex={-1}
              />
            )}
          </div>
        )
      },
    },
    {
      id: "estimate",
      label: "Estimate",
      width: "w-[70px]",
      batchPropertyOptions: onNodeUpdate ? ESTIMATE_OPTIONS : undefined,
      onBatchPropertySet: onNodeUpdate ? (value, selectedIds) => {
        selectedIds.forEach((id) => onNodeUpdate(id, { estimate: value as PlanNode["estimate"] }))
      } : undefined,
      render: (node) => (
        <PropertyPicker
          value={node.estimate}
          options={ESTIMATE_OPTIONS}
          title="Set estimate"
          disabled={!onNodeUpdate}
          onSelect={(id) => onNodeUpdate?.(node.id, { estimate: id as PlanNode["estimate"] })}
        >
          <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {node.estimate ?? "\u2014"}
          </span>
        </PropertyPicker>
      ),
    },
    {
      id: "milestone",
      label: "Milestone",
      width: "w-[120px]",
      render: (node) => {
        const name = node.milestoneId ? milestoneMap.get(node.milestoneId) : undefined
        return name ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground truncate">
            <Diamond className="h-3 w-3 shrink-0 text-primary" />
            {name}
          </span>
        ) : null
      },
    },
    {
      id: "labels",
      label: "Labels",
      width: "w-[80px]",
      render: (node) => {
        const allLabels = project?.labels || []
        return (
          <LabelPicker
            labelIds={node.labelIds || []}
            allLabels={allLabels}
            disabled={!onNodeUpdate}
            displayMode="dots"
            onChange={(labelIds) => onNodeUpdate?.(node.id, { labelIds })}
            onManageLabels={onManageLabels}
          />
        )
      },
    },
    {
      id: "pr",
      label: "PR",
      width: "w-[70px]",
      render: (node) => {
        if (!node.prUrl) return null
        const PrIcon = node.status === "completed" || node.status === "auto_verified"
          ? GitPullRequest
          : GitPullRequestDraft
        return (
          <a
            href={node.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
            title={node.branchName ?? `PR #${node.prNumber}`}
          >
            <PrIcon className="h-3.5 w-3.5 shrink-0" />
            {node.prNumber != null && <span>#{node.prNumber}</span>}
          </a>
        )
      },
    },
    {
      id: "project",
      label: "Project",
      width: "w-[120px]",
      render: (node) => {
        const name = projectMap?.get(node.projectId)
        if (!name) return null
        return <span className="text-xs text-muted-foreground truncate">{name}</span>
      },
    },
  ]
}


// --- Inline List Creation Row (reusable) ---
// Renders with the same visual style as a real task row (PropertyPicker, Badge, etc.)
// In cross-project mode (projectId not a valid UUID), shows a project picker before creating.
function InlineListCreationRow({
  projectId,
  defaultMilestoneId,
  onCreated,
  onMilestoneCreated,
}: {
  projectId: string
  columns?: ListColumn<PlanNode>[]
  displaySettings?: DisplaySettings
  defaultMilestoneId?: string
  onCreated?: () => void
  onMilestoneCreated?: (milestoneId: string) => void
}) {
  const addNode = usePlanStore((s) => s.addNode)
  const allProjects = useProjectStore((s) => s.projects)
  const [taskName, setTaskName] = useState("")
  const [mode, setMode] = useState<"task" | "milestone">("task")
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Detect cross-project mode: projectId is not a valid UUID
  const isCrossProject = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)

  const createNode = useCallback((targetProjectId: string) => {
    if (!taskName.trim()) return

    const { title, description } = splitTitleDescription(taskName)
    const nodeId = crypto.randomUUID()

    addNode({
      id: nodeId,
      projectId: targetProjectId,
      type: mode,
      title,
      description,
      status: "planned",
      parentId: null,
      dependencies: [],
      verification: mode === "milestone" ? "human" : "auto",
      position: { x: 0, y: 0 },
      priority: "medium",
      milestoneId: mode === "task" ? defaultMilestoneId : undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    setTaskName("")

    if (mode === "milestone") {
      // Switch to task mode and notify parent to move cursor to the new milestone's group
      setMode("task")
      onMilestoneCreated?.(nodeId)
    } else {
      requestAnimationFrame(() => nameInputRef.current?.focus())
    }
  }, [taskName, defaultMilestoneId, addNode, mode, onMilestoneCreated])

  const handleCreate = () => {
    if (!taskName.trim()) return

    if (isCrossProject) {
      if (allProjects.length === 1) {
        createNode(allProjects[0].id)
      } else {
        // Use first project as fallback in cross-project mode
        createNode(allProjects[0]?.id ?? projectId)
      }
      return
    }

    createNode(projectId)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault()
      setMode((m) => (m === "task" ? "milestone" : "task"))
    } else if (e.key === "Enter" && taskName.trim()) {
      e.preventDefault()
      handleCreate()
    } else if (e.key === "Escape") {
      e.preventDefault()
      onCreated?.()
    }
  }

  return (
    <div className="flex items-center border-b border-border px-6 py-2.5 hover:bg-muted/30 transition-colors">
      {mode === "milestone" && (
        <Diamond className="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <input
          ref={nameInputRef}
          type="text"
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={mode === "task"
            ? "Task name... (Enter to create, Shift+Tab for milestone, Esc to cancel)"
            : "Milestone name... (Enter to create, Shift+Tab for task, Esc to cancel)"}
          autoFocus
          className="w-full bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  )
}

// --- Inline Empty State for List View ---
function ListEmptyState({ projectId, columns }: { projectId: string; columns: ListColumn<PlanNode>[] }) {
  const navigate = useNavigate()
  const displaySettings = useDisplaySettingsStore((s) => s.get("plan-list"))

  // Filter visible columns (but always show name for creation)
  const visibleColumns = columns.filter((col) =>
    col.id === "name" || // Always show name field for task creation
    !displaySettings.visibleProperties ||
    displaySettings.visibleProperties.includes(col.id)
  )

  return (
    <div className="flex flex-col h-full">
      {/* Generate with AI button */}
      <div className="px-6 py-4">
        <button
          type="button"
          onClick={() => navigate(`/plan?projectId=${projectId}`)}
          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer"
        >
          <Sparkles className="h-4 w-4" />
          Generate with AI
        </button>
      </div>

      {/* Header row */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-2 bg-muted/30">
        {visibleColumns.map((col) => (
          <div
            key={col.id}
            className={cn(
              "text-xs font-medium text-muted-foreground uppercase tracking-wide",
              col.width
            )}
          >
            {col.label}
          </div>
        ))}
      </div>

      {/* Inline creation row */}
      <InlineListCreationRow
        projectId={projectId}
        columns={columns}
        displaySettings={displaySettings}
      />
    </div>
  )
}

// --- List View ---
export function PlanListView({
  projectId,
  nodes,
  onNodeSelect,
  getProjectIdFromGroup,
  applyCompletedFilter = true,
  displayViewKey = "plan-list",
}: {
  projectId: string
  nodes?: PlanNode[] // Optional: pre-filtered nodes for cross-project mode
  onNodeSelect: (node: PlanNode | null) => void
  /** Optional: extract projectId from group key for cross-project task creation */
  getProjectIdFromGroup?: (groupKey: string) => string | undefined
  applyCompletedFilter?: boolean // Whether to apply showCompleted filter (default true)
  displayViewKey?: ViewKey // Which display settings to use (default "plan-list")
}) {
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const updateNode = usePlanStore((s) => s.updateNode)
  const removeNodes = usePlanStore((s) => s.removeNodes)
  const addActivity = useActivityStore((s) => s.addActivity)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const projects = useProjectStore((s) => s.projects)
  const displaySettings = useDisplaySettingsStore((s) => s.get(displayViewKey))
  const updateDisplaySettings = useDisplaySettingsStore((s) => s.update)
  const fastEdit = useDisplaySettingsStore((s) => s.fastEdit)
  const flushPendingSaves = useContentSaveStore((s) => s.flushPendingSaves)
  const showTaskNumbers = useSettingsStore((s) => s.showTaskNumbers)
  const [creatingInGroup, setCreatingInGroup] = useState<string | null>(null)
  const [labelManagerOpen, setLabelManagerOpen] = useState(false)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")

  const handleNodeUpdate = useCallback((id: string, updates: Partial<PlanNode>) => {
    updateNode(id, updates)
  }, [updateNode])

  const handleManageLabels = useCallback(() => {
    setLabelManagerOpen(true)
  }, [])

  const handleExecute = useCallback(async (node: PlanNode) => {
    // Guard against double-dispatch: only planned tasks can be executed
    if (node.status !== 'planned') {
      console.warn(`[plan-view] Skipping dispatch for node ${node.id} — status is ${node.status}, not planned`)
      return
    }
    if (!project?.defaultMachineId) {
      useToastStore.getState().add({
        type: "warning",
        title: "No machine connected",
        description: "Connect a machine in Environments before executing tasks.",
      })
      return
    }
    // Flush any pending content saves before execution
    try {
      await flushPendingSaves([node.id])
    } catch (error) {
      console.error('Failed to save task content before execution:', error)
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to save changes',
        description: 'Could not save task content before execution. Please try again.',
      })
      return
    }

    const { startExecution } = useExecutionStore.getState()
    await startExecution(node.id, node.projectId)
    addActivity({
      projectId: node.projectId,
      type: "task.started",
      title: `Executing task: ${node.title}`,
    })
  }, [project, addActivity, flushPendingSaves])

  const planBatchActions: BatchAction[] = useMemo(() => [
    {
      id: "execute",
      label: "Execute All",
      icon: <Play className="h-3.5 w-3.5" />,
      variant: "default",
      onAction: async (ids) => {
        // Check machine + working directory before dispatching
        if (!project?.defaultMachineId) {
          useToastStore.getState().add({
            type: "warning",
            title: "No machine connected",
            description: "Connect a machine in Environments before executing tasks.",
          })
          return
        }
        // Flush pending saves for all selected tasks before execution
        try {
          await flushPendingSaves(ids)
        } catch (error) {
          console.error('Failed to save task content before execution:', error)
          const description = error instanceof Error
            ? error.message
            : 'Could not save task content before execution. Please try again.'
          useToastStore.getState().add({
            type: 'error',
            title: 'Failed to save changes',
            description,
          })
          return
        }

        const { startExecution } = useExecutionStore.getState()
        // Execute all selected tasks in parallel
        const executions = ids.map((id) => {
          const node = planNodes.find((n) => n.id === id)
          if (node) {
            return startExecution(id, node.projectId)
          }
          return Promise.resolve()
        })
        // Wait for all executions to start (not complete)
        await Promise.all(executions)
        // Track activity
        addActivity({
          projectId,
          type: "task.bulk_executed",
          title: `Executing ${ids.length} task${ids.length > 1 ? 's' : ''}`,
        })
      },
    },
    {
      id: "reset",
      label: "Reset All",
      icon: <RotateCcw className="h-3.5 w-3.5" />,
      variant: "default",
      onAction: async (ids) => {
        const { resetExecution } = useExecutionStore.getState()
        await Promise.all(ids.map((id) => resetExecution(id)))
        addActivity({
          projectId,
          type: "task.bulk_reset",
          title: `Reset ${ids.length} task${ids.length > 1 ? 's' : ''}`,
        })
      },
    },
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      variant: "destructive",
      onAction: (ids) => {
        const deletedNodes = planNodes.filter((n) => ids.includes(n.id))
        removeNodes(ids)
        // Track activity for each deleted node's project
        const byProject = new Map<string, string[]>()
        for (const n of deletedNodes) {
          const list = byProject.get(n.projectId) ?? []
          list.push(n.title)
          byProject.set(n.projectId, list)
        }
        for (const [pid, titles] of byProject) {
          addActivity({
            projectId: pid,
            type: ids.length > 1 ? "task.bulk_deleted" : "task.deleted",
            title: ids.length > 1
              ? `Deleted ${titles.length} tasks`
              : `Deleted task: ${titles[0]}`,
          })
        }
      },
    },
  ], [removeNodes, planNodes, addActivity, projectId, flushPendingSaves, project])

  const allProjectNodes = useMemo(() => {
    // If nodes provided (cross-project mode), use those
    if (nodes) return nodes
    // Otherwise filter by projectId (single-project mode)
    return planNodes.filter((n) => n.projectId === projectId)
  }, [planNodes, projectId, nodes])

  const milestones = useMemo(() =>
    allProjectNodes.filter((n) => n.type === "milestone").sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
    [allProjectNodes])

  const milestoneMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const ms of milestones) m.set(ms.id, ms.title)
    return m
  }, [milestones])

  const projectNameMap = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  // Compute execution order via topological sort
  const executionOrderMap = useMemo(() => {
    const taskNodes = allProjectNodes.filter((n) => n.type !== "milestone")
    const sorted = topologicalSortNodes(taskNodes)
    const map = new Map<string, number>()
    sorted.forEach((n, i) => map.set(n.id, i + 1))
    return map
  }, [allProjectNodes])

  const columns = useMemo(() => makePlanColumns(project, milestoneMap, handleNodeUpdate, projectNameMap, executionOrderMap, handleManageLabels, handleExecute, showTaskNumbers), [project, milestoneMap, handleNodeUpdate, projectNameMap, executionOrderMap, handleManageLabels, handleExecute, showTaskNumbers])

  const tasks = useMemo(() => {
    // Exclude pruned from the active task list — they appear in a separate "Deprecated" group
    let filtered = allProjectNodes.filter((n) => n.type !== "milestone" && n.status !== "pruned")
    if (applyCompletedFilter && !displaySettings.showCompleted) {
      filtered = filtered.filter((n) => n.status !== "completed" && n.status !== "auto_verified")
    }
    const dir = displaySettings.orderDirection === "asc" ? 1 : -1
    return sortPlanNodes(filtered, displaySettings.orderBy, dir)
  }, [allProjectNodes, displaySettings.orderBy, displaySettings.orderDirection, displaySettings.showCompleted, applyCompletedFilter])

  // Pruned tasks shown in a separate "Deprecated" group at the bottom
  const prunedTasks = useMemo(() =>
    allProjectNodes.filter((n) => n.type !== "milestone" && n.status === "pruned"),
    [allProjectNodes],
  )

  const groups = useMemo((): ListGroup<PlanNode>[] => {
    let result: ListGroup<PlanNode>[]

    if (displaySettings.groupBy === "milestone") {
      result = []
      for (const m of milestones) {
        const grouped = tasks.filter((n) => n.milestoneId === m.id)
        const completedCount = grouped.filter((t) => t.status === "completed" || t.status === "auto_verified").length
        const completion = grouped.length > 0 ? Math.round((completedCount / grouped.length) * 100) : 0
        result.push({
          key: `milestone-${m.id}`,
          label: showTaskNumbers && m.number != null ? `${m.number}  ${m.title}` : m.title,
          icon: <Diamond className="h-3 w-3 text-primary" />,
          items: grouped,
          meta: (
            <div className="flex items-center gap-2">
              <Progress value={completion} className="h-1.5 w-16" indicatorClassName="bg-emerald-500" />
              <span className="text-[11px] text-muted-foreground whitespace-nowrap">{completedCount}/{grouped.length}</span>
            </div>
          ),
        })
      }
      const unassigned = tasks.filter((n) => !n.milestoneId)
      if (unassigned.length > 0) {
        result.push({
          key: "unassigned",
          label: "Unassigned",
          items: unassigned,
        })
      }
    } else if (displaySettings.groupBy === "status") {
      const grouped: Record<string, PlanNode[]> = {}
      for (const node of tasks) {
        const key = statusLabels[node.status] ?? node.status
        ;(grouped[key] ??= []).push(node)
      }
      result = Object.entries(grouped).map(([label, items]) => ({
        key: label,
        label,
        items,
      }))
    } else if (displaySettings.groupBy === "priority") {
      const grouped: Record<string, PlanNode[]> = {}
      for (const node of tasks) {
        const key = node.priority ? (node.priority.charAt(0).toUpperCase() + node.priority.slice(1)) : "No priority"
        ;(grouped[key] ??= []).push(node)
      }
      result = Object.entries(grouped).map(([label, items]) => ({
        key: label,
        label,
        items,
      }))
    } else if (displaySettings.groupBy === "project") {
      const grouped = new Map<string, ListGroup<PlanNode>>()
      const seededProjects = getProjectGroupSeedProjects(
        projects,
        nodes ? allProjectNodes.map((node) => node.projectId) : undefined,
      )
      for (const p of seededProjects) {
        const descriptor = getProjectGroupDescriptor(p)
        if (!grouped.has(descriptor.key)) {
          grouped.set(descriptor.key, {
            key: descriptor.key,
            label: descriptor.label,
            items: [],
            defaultCollapsed: descriptor.defaultCollapsed,
          })
        }
      }
      for (const node of tasks) {
        const descriptor = getProjectGroupDescriptorForId(node.projectId, projectsById)
        const existing = grouped.get(descriptor.key)
        if (existing) {
          existing.items.push(node)
          continue
        }
        grouped.set(descriptor.key, {
          key: descriptor.key,
          label: descriptor.label,
          items: [node],
          defaultCollapsed: descriptor.defaultCollapsed,
        })
      }
      result = Array.from(grouped.values())
    } else if (displaySettings.groupBy === "label") {
      const allLabels = project?.labels ?? []
      const labelMap = new Map(allLabels.map((l) => [l.id, l]))
      result = []
      for (const l of allLabels) {
        const grouped = tasks.filter((n) => n.labelIds?.includes(l.id))
        result.push({
          key: `label-${l.id}`,
          label: l.name,
          icon: (
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: l.color }}
            />
          ),
          items: grouped,
        })
      }
      const noLabel = tasks.filter(
        (n) => !n.labelIds?.length || !n.labelIds.some((lid) => labelMap.has(lid)),
      )
      if (noLabel.length > 0) {
        result.push({ key: "no-label", label: "No label", items: noLabel })
      }
    } else {
      result = [{ key: "all", label: "All Tasks", items: tasks }]
    }

    // Append "Deprecated" group at the bottom for pruned/abandoned tasks
    if (prunedTasks.length > 0) {
      result.push({
        key: "deprecated",
        label: "Deprecated",
        icon: <Scissors className="h-3 w-3 text-muted-foreground" />,
        items: prunedTasks,
        meta: <span className="text-[11px] text-muted-foreground">{prunedTasks.length} tasks</span>,
        defaultCollapsed: true,
        headerClassName: "bg-muted/50 border-t border-dashed border-border",
        itemClassName: "opacity-60",
      })
    }

    return result
  }, [tasks, prunedTasks, milestones, projects, projectsById, displaySettings.groupBy, project?.labels, nodes, allProjectNodes, showTaskNumbers])

  // Open creation row for the first group when Enter is pressed with no focused item
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) return
      // Only handle Enter when no item is focused (j/k not used yet) and in fast edit mode
      const { focusedId } = useKeyboardNavStore.getState()
      if (e.key === "Enter" && fastEdit && !focusedId && groups.length > 0 && creatingInGroup === null) {
        e.preventDefault()
        setCreatingInGroup(groups[0].key)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [groups, creatingInGroup, fastEdit])

  function renderAddTaskRow(groupKey: string) {
    const defaultMilestoneId = groupKey.startsWith("milestone-") ? groupKey.replace("milestone-", "") : undefined
    // For cross-project mode, extract projectId from group
    const targetProjectId = getProjectIdFromGroup?.(groupKey) ?? (projectId !== "cross-project-mode" ? projectId : undefined)

    if (!targetProjectId) return null

    if (creatingInGroup === groupKey) {
      return (
        <InlineListCreationRow
          projectId={targetProjectId}
          columns={columns}
          displaySettings={displaySettings}
          defaultMilestoneId={defaultMilestoneId}
          onCreated={() => setCreatingInGroup(null)}
          onMilestoneCreated={(milestoneId) => setCreatingInGroup(`milestone-${milestoneId}`)}
        />
      )
    }
    if (!fastEdit) return null
    return (
      <button
        type="button"
        onClick={() => setCreatingInGroup(groupKey)}
        className="flex items-center gap-2 px-6 h-9 w-full text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors cursor-pointer border-b border-border"
      >
        <span className="text-muted-foreground/50">Press Enter to add task</span>
      </button>
    )
  }

  // Reverse lookup: statusLabel → status key
  const reverseStatusLabels = useMemo(() => {
    const map: Record<string, string> = {}
    for (const [key, label] of Object.entries(statusLabels)) {
      map[label] = key
    }
    return map
  }, [])

  const handleGroupDrop = useCallback((itemId: string, _sourceGroupKey: string, targetGroupKey: string) => {
    const groupBy = displaySettings.groupBy
    if (groupBy === "milestone") {
      // Group keys: "milestone-<id>" or "unassigned"
      const milestoneId = targetGroupKey === "unassigned" ? undefined : targetGroupKey.replace("milestone-", "")
      updateNode(itemId, { milestoneId })
    } else if (groupBy === "status") {
      // Group keys are status display labels — reverse-lookup the status key
      const statusKey = reverseStatusLabels[targetGroupKey]
      if (statusKey) {
        updateNode(itemId, { status: statusKey as PlanNode["status"] })
      }
    } else if (groupBy === "priority") {
      // Group keys: capitalized priority or "No priority"
      const priority = targetGroupKey === "No priority" ? undefined : targetGroupKey.toLowerCase() as Priority
      updateNode(itemId, { priority })
    } else if (groupBy === "label") {
      // Group keys: "label-<id>" or "no-label"
      // For label groups, we add the label to the task (or clear all labels)
      const targetLabelId = targetGroupKey.startsWith("label-") ? targetGroupKey.replace("label-", "") : undefined
      const node = allProjectNodes.find((n) => n.id === itemId)
      if (!node) return
      if (targetLabelId) {
        // Add the target label if not already present
        const currentLabels = node.labelIds ?? []
        if (!currentLabels.includes(targetLabelId)) {
          updateNode(itemId, { labelIds: [...currentLabels, targetLabelId] })
        }
      } else {
        // Dropping into "no-label" clears labels
        updateNode(itemId, { labelIds: [] })
      }
    }
  }, [displaySettings.groupBy, updateNode, reverseStatusLabels, allProjectNodes])

  const handleSort = useCallback((sortKey: string) => {
    if (displaySettings.orderBy === sortKey) {
      updateDisplaySettings(displayViewKey, {
        orderDirection: displaySettings.orderDirection === "asc" ? "desc" : "asc",
      })
    } else {
      updateDisplaySettings(displayViewKey, { orderBy: sortKey, orderDirection: "asc" })
    }
  }, [displaySettings.orderBy, displaySettings.orderDirection, updateDisplaySettings, displayViewKey])

  // Show empty state if no tasks (with column headers)
  if (tasks.length === 0) {
    return <ListEmptyState projectId={projectId} columns={columns} />
  }

  // Ensure name column is always visible
  const visibleColumnsWithName = displaySettings.visibleProperties?.includes("name")
    ? displaySettings.visibleProperties
    : ["name", ...(displaySettings.visibleProperties || [])]

  return (
    <>
      {projectId && (
        <LabelManagerDialog
          open={labelManagerOpen}
          onOpenChange={setLabelManagerOpen}
          projectId={projectId}
        />
      )}
      <ItemListView
        columns={columns}
        groups={groups}
        visibleColumns={visibleColumnsWithName}
        onItemClick={(node) => {
          if (fastEdit) {
            setEditingTitle(node.title)
            setEditingNodeId(node.id)
          } else {
            onNodeSelect(node)
          }
        }}
        onItemActivate={(node) => {
          if (fastEdit) {
            // Open creation row in the same group as the focused node
            const group = groups.find((g) => g.items.some((item) => item.id === node.id))
            if (group) {
              setCreatingInGroup(group.key)
            }
          } else {
            onNodeSelect(node)
          }
        }}
        getItemId={(n) => n.id}
        getItemClass={(n) => cn(n.status === "pruned" && "opacity-50")}
        footer={renderAddTaskRow}
        batchActions={planBatchActions}
        sortColumn={displaySettings.orderBy}
        sortDirection={displaySettings.orderDirection}
        onSort={handleSort}
        onGroupDrop={displaySettings.groupBy !== "none" && displaySettings.groupBy !== "project" ? handleGroupDrop : undefined}
        renderItemName={fastEdit ? (node) => {
          if (editingNodeId === node.id) {
            return (
              <input
                autoFocus
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    const t = editingTitle.trim()
                    if (t && t !== node.title) updateNode(node.id, { title: t })
                    setEditingNodeId(null)
                  } else if (e.key === "Escape") {
                    e.preventDefault()
                    setEditingNodeId(null)
                  }
                  e.stopPropagation()
                }}
                onBlur={() => {
                  const t = editingTitle.trim()
                  if (t && t !== node.title) updateNode(node.id, { title: t })
                  setEditingNodeId(null)
                }}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 bg-transparent text-sm font-medium outline-none"
              />
            )
          }
          return (
            <span className={cn("text-sm truncate flex items-center gap-1.5", node.status === "pruned" && "line-through")}>
              <span className="truncate">{node.title}</span>
            </span>
          )
        } : undefined}
        renderMobileItem={(node) => (
          <TaskRow
            task={node}
            projectName={projectNameMap.get(node.projectId)}
            showProject={displaySettings.groupBy === "project" ? false : !!nodes}
            onClick={() => onNodeSelect(node)}
            className={cn(node.status === "pruned" && "opacity-50")}
          />
        )}
      />
    </>
  )
}

/** Lightweight inline row for adding a task directly in the timeline list */
function TimelineInlineAddRow({ projectId, onCreated, onCancel }: { projectId: string; onCreated: () => void; onCancel: () => void }) {
  const addNode = usePlanStore((s) => s.addNode)
  const [title, setTitle] = useState("")

  const commit = useCallback(() => {
    const t = title.trim()
    if (t) {
      const now = new Date()
      addNode({
        id: crypto.randomUUID(),
        projectId,
        type: "task",
        title: t,
        description: "",
        status: "planned",
        parentId: null,
        dependencies: [],
        verification: "auto",
        position: { x: 40, y: 40 },
        createdAt: now,
        updatedAt: now,
      })
      onCreated()
    } else {
      onCancel()
    }
  }, [title, projectId, addNode, onCreated, onCancel])

  return (
    <div className="flex items-center border-b border-border px-4 h-10">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit() }
          if (e.key === "Escape") { e.preventDefault(); onCancel() }
        }}
        onBlur={commit}
        placeholder="Task name"
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  )
}

// --- Timeline View ---
export function PlanTimelineView({
  projectId,
  nodes,
  onNodeSelect,
  applyCompletedFilter = true,
  displayViewKey = "plan-list",
}: {
  projectId: string
  nodes?: PlanNode[] // Optional: pre-filtered nodes for cross-project mode
  onNodeSelect: (node: PlanNode | null) => void
  applyCompletedFilter?: boolean // Whether to apply showCompleted filter (default true)
  displayViewKey?: ViewKey // Which display settings to use (default "plan-list")
}) {
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const rawPlanEdges = usePlanStore((s) => s.edges)
  const planEdges = useMemo(() => rawPlanEdges.filter(isLive), [rawPlanEdges])
  const updateNode = usePlanStore((s) => s.updateNode)
  const projects = useProjectStore((s) => s.projects)
  const displaySettings = useDisplaySettingsStore((s) => s.get(displayViewKey))
  const fastEdit = useDisplaySettingsStore((s) => s.fastEdit)
  const [isCreating, setIsCreating] = useState(false)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const allProjectNodes = useMemo(() => {
    // If nodes provided (cross-project mode), use those
    if (nodes) return nodes
    // Otherwise filter by projectId (single-project mode)
    return planNodes.filter((n) => n.projectId === projectId)
  }, [planNodes, projectId, nodes])

  const milestones = useMemo(() =>
    allProjectNodes.filter((n) => n.type === "milestone").sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
    [allProjectNodes])

  const tasks = useMemo(() => {
    // Always exclude pruned nodes — they are abandoned, not completed
    let filtered = allProjectNodes.filter((n) => n.type !== "milestone" && n.status !== "pruned")
    if (applyCompletedFilter && !displaySettings.showCompleted) {
      filtered = filtered.filter((n) => n.status !== "completed" && n.status !== "auto_verified")
    }
    const dir = displaySettings.orderDirection === "asc" ? 1 : -1
    return sortPlanNodes(filtered, displaySettings.orderBy, dir)
  }, [allProjectNodes, displaySettings.orderBy, displaySettings.orderDirection, displaySettings.showCompleted, applyCompletedFilter])

  const edges = useMemo(() => {
    const nodeIds = new Set(tasks.map((n) => n.id))
    return planEdges.filter((e) => nodeIds.has(e.source) || nodeIds.has(e.target))
  }, [tasks, planEdges])

  const datedTasks = useMemo(() => assignDefaultDates(tasks, edges), [tasks, edges])

  const timelineRows = useMemo((): TimelineRow<PlanNode>[] => {
    function nodeToRow(node: PlanNode): TimelineRow<PlanNode> {
      const dated = datedTasks.find((n) => n.id === node.id) ?? node
      return {
        kind: "item",
        item: node,
        timeline: {
          id: node.id,
          startDate: dated.startDate ?? "",
          endDate: dated.endDate ?? "",
          barClass: statusBarColors[node.status] ?? "bg-primary/70",
          progressClass: statusProgressColors[node.status],
          progressPct: statusProgressColors[node.status] ? 40 : undefined,
          label: node.title,
        },
      }
    }

    if (displaySettings.groupBy === "none") {
      return datedTasks.map(nodeToRow)
    }

    if (displaySettings.groupBy === "milestone") {
      const rows: TimelineRow<PlanNode>[] = []
      for (const m of milestones) {
        const grouped = datedTasks.filter((n) => n.milestoneId === m.id)
        rows.push({ kind: "header", label: m.title, count: grouped.length })
        for (const t of grouped) rows.push(nodeToRow(t))
      }
      const unassigned = datedTasks.filter((n) => !n.milestoneId)
      if (unassigned.length > 0) {
        rows.push({ kind: "header", label: "Unassigned", count: unassigned.length })
        for (const t of unassigned) rows.push(nodeToRow(t))
      }
      return rows
    }

    if (displaySettings.groupBy === "status") {
      const grouped: Record<string, PlanNode[]> = {}
      for (const node of datedTasks) {
        const key = statusLabels[node.status] ?? node.status
        ;(grouped[key] ??= []).push(node)
      }
      const rows: TimelineRow<PlanNode>[] = []
      for (const [label, items] of Object.entries(grouped)) {
        rows.push({ kind: "header", label, count: items.length })
        for (const item of items) rows.push(nodeToRow(item))
      }
      return rows
    }

    if (displaySettings.groupBy === "priority") {
      const grouped: Record<string, PlanNode[]> = {}
      for (const node of datedTasks) {
        const key = node.priority ? (node.priority.charAt(0).toUpperCase() + node.priority.slice(1)) : "No priority"
        ;(grouped[key] ??= []).push(node)
      }
      const rows: TimelineRow<PlanNode>[] = []
      for (const [label, items] of Object.entries(grouped)) {
        rows.push({ kind: "header", label, count: items.length })
        for (const item of items) rows.push(nodeToRow(item))
      }
      return rows
    }

    if (displaySettings.groupBy === "project") {
      const grouped: Record<string, PlanNode[]> = {}
      for (const node of datedTasks) {
        const key = getProjectGroupDescriptorForId(node.projectId, projectsById).label
        ;(grouped[key] ??= []).push(node)
      }
      const rows: TimelineRow<PlanNode>[] = []
      for (const [label, items] of Object.entries(grouped)) {
        rows.push({ kind: "header", label, count: items.length })
        for (const item of items) rows.push(nodeToRow(item))
      }
      return rows
    }

    return datedTasks.map(nodeToRow)
  }, [datedTasks, milestones, displaySettings.groupBy, projectsById])

  return (
    <ItemTimelineView
      rows={timelineRows}
      viewKey={displayViewKey}
      renderLeftCell={(node) => {
        if (fastEdit && editingNodeId === node.id) {
          return (
            <input
              autoFocus
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  const t = editingTitle.trim()
                  if (t && t !== node.title) updateNode(node.id, { title: t })
                  setEditingNodeId(null)
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  setEditingNodeId(null)
                }
                e.stopPropagation()
              }}
              onBlur={() => {
                const t = editingTitle.trim()
                if (t && t !== node.title) updateNode(node.id, { title: t })
                setEditingNodeId(null)
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-transparent text-sm font-medium outline-none"
            />
          )
        }
        return (
          <span className={cn(
            "text-sm truncate",
            node.status === "pruned" && "line-through opacity-50"
          )}>
            {node.title}
          </span>
        )
      }}
      onItemClick={(node) => {
        if (fastEdit) {
          setEditingTitle(node.title)
          setEditingNodeId(node.id)
        } else {
          onNodeSelect(node)
        }
      }}
      onDateChange={(nodeId, startDate, endDate) => updateNode(nodeId, { startDate, endDate })}
      footer={
        isCreating ? (
          <TimelineInlineAddRow
            projectId={projectId}
            onCreated={() => setIsCreating(false)}
            onCancel={() => setIsCreating(false)}
          />
        ) : (
          <TimelineAddTaskFooter onClick={() => setIsCreating(true)} />
        )
      }
    />
  )
}

// --- Board View Wrapper ---
export function PlanBoardView({
  projectId,
  nodes: providedNodes,
  onNodeSelect,
  applyCompletedFilter = true
}: {
  projectId: string
  nodes?: PlanNode[] // Optional: pre-filtered nodes for cross-project mode
  onNodeSelect: (node: PlanNode | null) => void
  applyCompletedFilter?: boolean // Whether to apply showCompleted filter (default true)
}) {
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const updateNode = usePlanStore((s) => s.updateNode)
  const boardSettings = useDisplaySettingsStore((s) => s.get("plan-board"))
  const fastEdit = useDisplaySettingsStore((s) => s.fastEdit)

  const nodes = useMemo(() => {
    // If nodes provided (cross-project mode), use those
    if (providedNodes) return providedNodes
    // Otherwise filter by projectId (single-project mode)
    return planNodes.filter((n) => n.projectId === projectId)
  }, [planNodes, projectId, providedNodes])

  const milestones = useMemo(() => {
    return nodes.filter((n) => n.type === "milestone").sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
  }, [nodes])

  const handleNodeUpdate = useCallback((id: string, updates: Partial<PlanNode>) => {
    updateNode(id, updates)
  }, [updateNode])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <BoardView
        nodes={nodes}
        columnBy={(boardSettings.columnBy ?? "status") as "status" | "priority" | "milestone"}
        visibleProperties={boardSettings.visibleProperties}
        showCompleted={applyCompletedFilter ? boardSettings.showCompleted : true}
        orderBy={boardSettings.orderBy}
        orderDirection={boardSettings.orderDirection}
        milestones={milestones}
        onNodeSelect={(node) => onNodeSelect(node)}
        onNodeUpdate={handleNodeUpdate}
        fastEdit={fastEdit}
        projectId={projectId}
      />
    </div>
  )
}

// --- Main Plan View Page ---
const VALID_VIEWS = new Set<ViewMode>(["graph", "list", "timeline", "board"])

export function PlanView() {
  const { t } = useTranslation('plan')
  const { id } = useParams()
  useProjectData(id) // Load full project data (content, executionOutput, streamText)
  const location = useLocation()
  const navigate = useNavigate()
  const project = useProjectStore((s) => s.projects.find((p) => p.id === id))
  const allProjects = useProjectStore((s) => s.projects)
  const updateProject = useProjectStore((s) => s.updateProject)
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const rawPlanEdges = usePlanStore((s) => s.edges)
  const planEdges = useMemo(() => rawPlanEdges.filter(isLive), [rawPlanEdges])
  const [selectedNode, setSelectedNode] = useState<PlanNode | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const focusedId = useKeyboardNavStore((s) => s.focusedId)
  const fastEditSetting = useDisplaySettingsStore((s) => s.fastEdit)
  const toggleFastEdit = useDisplaySettingsStore((s) => s.toggleFastEdit)
  const projectTaskCount = useMemo(() => planNodes.filter((n) => n.projectId === id && n.type !== "milestone").length, [planNodes, id])
  // Auto-enable fast edit when project has no tasks (empty plan)
  const fastEdit = fastEditSetting || projectTaskCount === 0

  /** Select a node: navigate to its task detail page */
  const handleNodeSelect = useCallback((node: PlanNode | null) => {
    if (node && id) {
      // In fast edit mode the view handles inline editing; skip navigation
      if (fastEdit) return
      const pathParts = location.pathname.split('/')
      const from = pathParts[pathParts.length - 1] || 'graph'
      const activeStatuses = new Set(['in_progress', 'dispatched', 'completed', 'auto_verified'])
      const tab = activeStatuses.has(node.status) ? 'activity' : 'content'
      navigate(`/project/${id}/task/${node.id}?from=${from}&tab=${tab}`)
    } else {
      setSelectedNode(null)
    }
  }, [id, navigate, location.pathname, fastEdit])

  /** Handle node ID click from chat messages */
  const handleChatNodeSelect = useCallback((nodeId: string) => {
    const node = planNodes.find((n) => n.id === nodeId)
    if (node) handleNodeSelect(node)
  }, [planNodes, handleNodeSelect])
  const [chatInitialMessage, setChatInitialMessage] = useState<string | undefined>()
  const [visionOpen, setVisionOpen] = useState(false)

  const [publishDialogOpen, setPublishDialogOpen] = useState(false)
  const isMobile = useMediaQuery("(max-width: 767px)")
  const [isRenaming, setIsRenaming] = useState(false)

  const handleRename = useCallback((newName: string) => {
    if (project) updateProject(project.id, { name: newName })
    setIsRenaming(false)
  }, [project, updateProject])

  const handleValidateRename = useCallback((name: string): string | null => {
    if (!project) return null
    return validateProjectName(name, project.id, allProjects)
  }, [project, allProjects])

  // Determine view mode and active tab from URL path
  const { viewMode, activeTab } = useMemo(() => {
    const pathParts = location.pathname.split('/')
    const lastPart = pathParts[pathParts.length - 1]

    // Check if the last part is a view mode
    if (lastPart === 'repo') {
      return { viewMode: 'graph' as ViewMode, activeTab: 'repo' as const }
    } else if (VALID_VIEWS.has(lastPart as ViewMode)) {
      return { viewMode: lastPart as ViewMode, activeTab: 'plan' as const }
    }

    // Default to list view in plan tab
    return { viewMode: 'list' as ViewMode, activeTab: 'plan' as const }
  }, [location.pathname])

  // Redirect bare /project/:id to /project/:id/list
  useEffect(() => {
    if (!id) return
    const pathParts = location.pathname.split('/')
    const lastPart = pathParts[pathParts.length - 1]
    if (lastPart === id || lastPart === 'overview' || lastPart === 'knowledge') {
      navigate(`/project/${id}/list`, { replace: true })
    }
  }, [location.pathname, id, navigate])

  // Close detail panel when switching view modes.
  // This effect legitimately syncs UI state (selectedNode) when the derived
  // viewMode changes from URL navigation. The guard avoids no-op renders.
  useEffect(() => { setSelectedNode(null) }, [viewMode, activeTab])

  // Sync keyboard-nav focused node → inspector selected node
  useEffect(() => {
    if (!inspectorOpen || !focusedId) return
    const node = planNodes.find((n) => n.id === focusedId)
    if (node) setSelectedNode(node)
  }, [focusedId, inspectorOpen, planNodes])

  // Keyboard shortcuts: 'i' to enter fast edit, 'Escape' to exit, 1-4 to switch views
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
      if (isEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'i' && !fastEditSetting) {
        e.preventDefault()
        toggleFastEdit()
      } else if (e.key === 'Escape' && fastEditSetting) {
        toggleFastEdit()
      } else if (id) {
        const viewMap: Record<string, ViewMode> = { '1': 'list', '2': 'board', '3': 'timeline', '4': 'graph' }
        const view = viewMap[e.key]
        if (view) { e.preventDefault(); navigate(`/project/${id}/${view}`) }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fastEditSetting, toggleFastEdit, id, navigate])

  // Show help tooltip on first visit to plan view
  const [showHelpTip, setShowHelpTip] = useState(() => {
    try { return !localStorage.getItem('astro-plan-help-seen') } catch { return true }
  })
  const dismissHelpTip = useCallback(() => {
    setShowHelpTip(false)
    try { localStorage.setItem('astro-plan-help-seen', '1') } catch { /* noop */ }
  }, [])

  // Handle decompose: open chat with pre-filled message
  const handleDecomposeNode = useCallback((nodeId: string) => {
    const node = planNodes.find((n) => n.id === nodeId)
    if (!node) return
    const message = `Decompose @${node.title} into smaller sub-tasks with minimal overlap. Each sub-task should be agent-solvable in one session.`
    setChatInitialMessage(message)
    setSelectedNode(null)
  }, [planNodes])

  // Auto-fetch file tree in the background when stale or missing
  useFileTreeRefresh(project)

  // Replan gate logic — only treat as GitHub project if projectType is 'github'
  // (projects converted from GitHub tasks keep githubOwner/githubRepo but have projectType 'plan')
  const gitHubEnabled = useFeatureFlag('github-integration')
  const isGitHubProject = gitHubEnabled && project?.projectType === 'github' && !!(project?.githubOwner && project?.githubRepo)


  const canSyncGitHub = isGitHubProject

  // GitHub issue sync handler
  const [syncing, setSyncing] = useState(false)
  const handleSyncGitHub = useCallback(async () => {
    if (!project) return
    setSyncing(true)
    try {
      const headers: Record<string, string> = {}
      const token = await getAccessToken()
      if (token) headers["Authorization"] = `Bearer ${token}`
      const res = await fetch(apiUrl(`/api/github/projects/${project.id}/sync-issues`), { method: "POST", headers })
      if (!res.ok) throw new Error("Failed to sync")
      const data = await res.json()
      await usePlanStore.getState().load()
      const parts = [`${data.created} new`, `${data.updated} updated`]
      if (data.cleared > 0) parts.push(`${data.cleared} completed issues cleared`)
      useToastStore.getState().add({ type: "success", title: "Issues synced", description: parts.join(", ") })
    } catch (err) {
      useToastStore.getState().add({ type: "error", title: "Sync failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setSyncing(false)
    }
  }, [project])

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Project not found
      </div>
    )
  }

  const inspectorProps = selectedNode ? {
    node: selectedNode,
    project,
    viewMode,
    onClose: () => { setSelectedNode(null); setInspectorOpen(false) },
    onNodeUpdate: setSelectedNode,
  } : null

  return (
    <div className="flex h-dvh md:h-full flex-col">
      {/* Header: project identity + Plan|Overview toggle + view mode + actions */}
      <header className="flex items-center gap-2 md:gap-3 border-b border-border/60 px-2 md:px-6 h-11 md:h-14 shrink-0">
        {/* Mobile back button */}
        <button
          onClick={() => navigate('/projects')}
          className="md:hidden flex items-center justify-center h-8 w-8 -ml-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        {/* Project identity */}
        <div className="flex items-center gap-3 shrink-0">
          <ColorIconBadge
            color={project.color}
            icon={project.icon}
            type="project"
            editable
            onColorChange={(color) => updateProject(project.id, { color })}
            onIconChange={(icon) => updateProject(project.id, { icon })}
            className="hidden md:flex"
          />
          {isRenaming ? (
            <InlineRenameInput
              value={project.name}
              onSave={handleRename}
              onCancel={() => setIsRenaming(false)}
              validate={handleValidateRename}
              className="text-lg font-semibold"
            />
          ) : (
            <span
              className="text-sm md:text-lg font-semibold shrink-0 truncate max-w-[140px] md:max-w-none group/name cursor-default"
              onDoubleClick={() => setIsRenaming(true)}
            >
              {project.name}
              <button className="hidden md:inline-flex items-center justify-center ml-1.5 p-1 -m-1 rounded opacity-40 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/name:opacity-50 hover:!opacity-100 transition-opacity cursor-pointer" onClick={(e) => { e.stopPropagation(); setIsRenaming(true); }}><Pencil className="h-3 w-3" /></button>
            </span>
          )}
        </div>

        {/* View mode switcher — desktop only */}
        <div className="hidden md:flex items-center gap-1 shrink-0">
          <div className="relative group/views">
            <button
              className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer text-accent-foreground border-b-2 border-accent flex items-center gap-1.5"
            >
              {viewMode === "list" ? <List className="h-3.5 w-3.5" />
                : viewMode === "board" ? <Columns3 className="h-3.5 w-3.5" />
                : viewMode === "timeline" ? <CalendarRange className="h-3.5 w-3.5" />
                : <Network className="h-3.5 w-3.5" />}
              {viewMode === "list" ? "List" : viewMode === "board" ? "Board" : viewMode === "timeline" ? "Timeline" : "Graph"}
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
            <div className="absolute top-full left-0 pt-1 invisible group-hover/views:visible opacity-0 group-hover/views:opacity-100 transition-all z-50">
              <div className="bg-popover border border-border rounded-lg shadow-lg p-1 min-w-[140px]">
                {([
                  { value: "list", label: "List", icon: List },
                  { value: "board", label: "Board", icon: Columns3 },
                  { value: "timeline", label: "Timeline", icon: CalendarRange },
                  { value: "graph", label: "Graph", icon: Network },
                ] as const).map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => navigate(`/project/${project.id}/${value}`)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors cursor-pointer",
                      viewMode === value ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {isGitHubProject && (
            <button
              onClick={() => navigate(`/project/${project.id}/repo`)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer",
                activeTab === "repo"
                  ? "text-accent-foreground border-b-2 border-accent"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t('tabs.repo', 'Repo Explorer')}
            </button>
          )}
        </div>

        <div className="flex-1 min-w-0" />

        {/* View mode toggle + Use Template + Publish - right-aligned, only visible when Plan is active */}
        {activeTab === "plan" && (
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {isServerMode() && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPublishDialogOpen(true)}
                    className="h-8 w-8 p-0"
                  >
                    <Globe className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Publish to Community</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={fastEdit ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => toggleFastEdit()}
                  className="h-8 w-8 p-0"
                >
                  <Pencil className={cn("h-3.5 w-3.5", fastEdit && "text-primary")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fast Edit</TooltipContent>
            </Tooltip>
            <DisplayPopover iconOnly config={{
              ...(viewMode === "list" ? planListDisplayConfig
                : viewMode === "timeline" ? planTimelineDisplayConfig
                : viewMode === "board" ? planBoardDisplayConfig
                : planGraphDisplayConfig),
              viewAsOptions: PLAN_VIEW_AS_OPTIONS,
              activeViewAs: viewMode,
              onViewAsChange: (v) => navigate(`/project/${project.id}/${v}`),
            }} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadBundle(exportProject(project.id))}
                  className="h-8 w-8 p-0"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export project</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const bundle = exportProject(project.id)
                      const res = await fetch(apiUrl("/api/share"), {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(bundle),
                      })
                      if (!res.ok) throw new Error("Failed to create share link")
                      const { id: shareId } = await res.json()
                      const url = `${window.location.origin}/share/${shareId}`
                      await navigator.clipboard.writeText(url)
                    } catch (err) {
                      console.error("[share] Failed:", err)
                    }
                  }}
                  className="h-8 w-8 p-0"
                >
                  <Link2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy share link</TooltipContent>
            </Tooltip>
            {canSyncGitHub ? (
              <div className="flex items-center gap-1.5">
                <SyncHealthDot projectId={project?.id} className="mr-0.5" />
                <div className="flex items-center gap-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSyncGitHub}
                        disabled={syncing}
                        className="text-xs rounded-l-full rounded-r-none border-r-0 pl-3 pr-2"
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", syncing && "animate-spin")} />
                        Sync
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Sync GitHub Issues</TooltipContent>
                  </Tooltip>
                  <GitHubSyncSettingsDialog
                    project={project}
                    trigger={
                      <Button variant="outline" size="sm" className="rounded-l-none rounded-r-full border-l-0 px-1.5 h-8">
                        <Settings2 className="h-3.5 w-3.5" />
                      </Button>
                    }
                  />
                </div>
              </div>
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={inspectorOpen ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => { setInspectorOpen(!inspectorOpen); if (inspectorOpen) setSelectedNode(null) }}
                  className="h-8 w-8 p-0"
                >
                  <PanelRight className={cn("h-3.5 w-3.5", inspectorOpen && "text-primary")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Node Inspector</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Plan history (archived plans restore) */}
        <PlanHistory projectId={project.id} />

        {/* Chat panel toggle */}
        {/* Mobile overflow menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="md:hidden flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {/* View mode options */}
            {([
              { value: "list", label: "List", icon: List },
              { value: "board", label: "Board", icon: Columns3 },
              { value: "timeline", label: "Timeline", icon: CalendarRange },
              { value: "graph", label: "Graph", icon: Network },
            ] as const).map(({ value, label, icon: Icon }) => (
              <DropdownMenuItem key={value} onClick={() => navigate(`/project/${project.id}/${value}`)}>
                <Icon className={cn("h-3.5 w-3.5 mr-2", viewMode === value && "text-primary")} />
                <span className={cn(viewMode === value && "font-medium")}>{label}</span>
              </DropdownMenuItem>
            ))}
            {isGitHubProject && (
              <DropdownMenuItem onClick={() => navigate(`/project/${project.id}/repo`)}>
                <GitBranch className="h-3.5 w-3.5 mr-2" />
                {t('tabs.repo', 'Repo Explorer')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {/* Actions */}
            <DropdownMenuItem onClick={() => setIsRenaming(true)}>
              <Pencil className="h-3.5 w-3.5 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleFastEdit()}>
              <Pencil className={cn("h-3.5 w-3.5 mr-2", fastEdit && "text-primary")} />
              {fastEdit ? "Exit Fast Edit" : "Fast Edit"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => downloadBundle(exportProject(project.id))}>
              <Download className="h-3.5 w-3.5 mr-2" />
              Export
            </DropdownMenuItem>
            <DropdownMenuItem onClick={async () => {
              try {
                const bundle = exportProject(project.id)
                const res = await fetch(apiUrl("/api/share"), {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(bundle),
                })
                if (!res.ok) throw new Error("Failed to create share link")
                const { id: shareId } = await res.json()
                const url = `${window.location.origin}/share/${shareId}`
                await navigator.clipboard.writeText(url)
              } catch (err) {
                console.error("[share] Failed:", err)
              }
            }}>
              <Link2 className="h-3.5 w-3.5 mr-2" />
              Share
            </DropdownMenuItem>
            {canSyncGitHub ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSyncGitHub} disabled={syncing}>
                  <RefreshCw className={cn("h-3.5 w-3.5 mr-2", syncing && "animate-spin")} />
                  Sync GitHub Issues
                </DropdownMenuItem>
                <GitHubSyncSettingsDialog
                  project={project}
                  trigger={
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                      <Settings2 className="h-3.5 w-3.5 mr-2" />
                      Sync Settings
                    </DropdownMenuItem>
                  }
                />
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Fork source lineage banner (if forked from community plan) */}
      <ForkSourceBanner project={project} />

      {/* First-visit keyboard shortcut hint */}
      {showHelpTip && activeTab === "plan" && (
        <div className="flex items-center gap-2 px-3 md:px-6 py-1.5 bg-primary/5 border-b border-primary/10 text-xs text-muted-foreground">
          <span>
            <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[11px]">J</kbd> / <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[11px]">K</kbd> navigate nodes,{" "}
            <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[11px]">I</kbd> fast edit,{" "}
            <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[11px]">Enter</kbd> confirm,{" "}
            <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[11px]">Esc</kbd> exit.{" "}
            <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[11px]">1</kbd>–<kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[11px]">4</kbd> switch views
          </span>
          <button
            type="button"
            onClick={dismissHelpTip}
            className="ml-auto text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Canvas/List + Detail/Chat pane */}
      <div className="flex flex-1 overflow-hidden flex-col">
        {/* Collapsible project info section */}
        {activeTab === "plan" && <ProjectInfoSection project={project} />}

        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 overflow-hidden relative">
            {activeTab === "repo" ? (
              isGitHubProject ? (
                <RepoExplorer project={project} />
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                  This project is not linked to a GitHub repository.
                </div>
              )
            ) : viewMode === "graph" ? (
              <div className="flex-1 relative overflow-hidden">
                <div className="absolute inset-0 touch-pan-x touch-pan-y">
                  <PlanCanvas projectId={project.id} onNodeSelect={handleNodeSelect} onDecomposeNode={handleDecomposeNode} />
                </div>
              </div>
            ) : viewMode === "list" ? (
              <div className="flex flex-1 flex-col overflow-hidden">
                <PlanListView projectId={project.id} onNodeSelect={handleNodeSelect} />
              </div>
            ) : viewMode === "board" ? (
              <div className="flex flex-1 flex-col overflow-hidden">
                <PlanBoardView projectId={project.id} onNodeSelect={handleNodeSelect} />
              </div>
            ) : (
              <div className="flex flex-1 flex-col overflow-hidden">
                <PlanTimelineView projectId={project.id} onNodeSelect={handleNodeSelect} />
              </div>
            )}

            {/* Node inspector pane — full-screen sheet on mobile, right sidebar on desktop */}
            {inspectorOpen && inspectorProps && (
              <>
                {isMobile && <NodeInspectorSheet open={!!selectedNode} {...inspectorProps} />}
                {!isMobile && <NodeInspectorSidebar {...inspectorProps} />}
              </>
            )}
            {inspectorOpen && !inspectorProps && !isMobile && (
              <div className="flex flex-col items-center justify-center border-l bg-card p-5 border-border w-[320px] shrink-0 text-muted-foreground text-sm">
                <PanelRight className="h-8 w-8 mb-2 text-muted-foreground/30" />
                <span>Use <kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono text-[11px]">J</kbd> / <kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono text-[11px]">K</kbd> to navigate</span>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Working directory bar — bottom of plan view */}
      <WorkdirBar project={project} />

      {/* Floating chat bubble — always visible */}
      <FloatingChat
        projectId={project.id}
        visionDoc={project.visionDoc}
        initialMessage={chatInitialMessage}
        onNodeSelect={handleChatNodeSelect}
        isMobile={isMobile}
      />

      {/* Vision Document Dialog */}
      <VisionDocDialog open={visionOpen} onOpenChange={setVisionOpen} project={project} />


      {/* Publish to Community Dialog */}
      <PublishDialog
        open={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
        project={project}
        nodes={planNodes}
        edges={planEdges}
      />
    </div>
  )
}

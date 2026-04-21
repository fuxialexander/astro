import { useState, useCallback, useEffect, useMemo } from "react"
import {
  ChevronLeft, Check, Wifi, FolderOpen, GitBranch, Play, Square, AlertCircle,
  Clock, ToggleLeft, ToggleRight
} from "lucide-react"
import { useNavigate } from "react-router"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RepoConfigDialog } from "@/components/repo-config-dialog"
import { ProviderAgentPicker } from "@/components/execution/provider-agent-picker"
import { MachineWorkdirPill } from "@/components/execution/machine-workdir-pill"
import { ScheduleForm } from "@/components/schedule/schedule-form"
import { useMachinesStore } from "@/stores/machines-store"
import { useExecutionStore, canExecuteNode, getProjectWorkingDir } from "@/stores/execution-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useScheduleStore } from "@/stores/schedule-store"
import { useContentSaveStore } from "@/stores/content-save-store"
import { useToastStore } from "@/stores/toast-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { EDITOR_APPS, type EditorAppId, buildEditorUrl, openWithEditor } from "@/lib/editor-utils"
import { AppIcon } from "@/components/editor-app-icon"
import { isDesktop } from "@/lib/desktop-detect"
import { deriveAvailableProviders } from "@/components/execution/provider-utils"
import { cn } from "@/lib/utils"
import type { PlanNode, Project, ProviderStatus } from "@/types"

interface TaskWorkdirBarProps {
  node: PlanNode
  project: Project
  viewMode?: string
  /** Whether the file browser sidebar is open (controlled by parent) */
  fileBrowserOpen?: boolean
  onToggleFileBrowser?: () => void
}

export function TaskWorkdirBar({ node, project, viewMode = "list", fileBrowserOpen, onToggleFileBrowser }: TaskWorkdirBarProps) {
  const navigate = useNavigate()

  // Editor app selection (persisted in settings)
  const editorType = useSettingsStore((s) => s.editorType)
  const setEditorType = useSettingsStore((s) => s.setEditorType)
  const [selectedApp, setSelectedApp] = useState<EditorAppId>(editorType === 'vscode' ? 'vscode' : 'cursor')

  // Remote toggle (stored per-project)
  const updateProject = useProjectStore((s) => s.updateProject)
  const useRemote = project.terminalOpenIn === 'remote'
  const toggleRemote = useCallback(() => {
    updateProject(project.id, { terminalOpenIn: useRemote ? 'local' : 'remote' })
  }, [project.id, useRemote, updateProject])

  // Worktree
  const [useWorktree, setUseWorktree] = useState(true)

  // Repo config dialog
  const [repoConfigOpen, setRepoConfigOpen] = useState(false)

  // Schedule dialog
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)
  const schedules = useScheduleStore((s) => s.schedules)
  const loadSchedules = useScheduleStore((s) => s.loadSchedules)
  useEffect(() => { loadSchedules(node.projectId) }, [node.projectId, loadSchedules])
  const nodeSchedule = schedules.find((s) => s.scope === 'node' && s.nodeId === node.id)

  // Machines
  const machines = useMachinesStore((s) => s.machines)
  const fetchMachines = useMachinesStore((s) => s.fetchMachines)
  useEffect(() => { if (machines.length === 0) fetchMachines() }, [machines.length, fetchMachines])

  const liveMachines = useExecutionStore((s) => s.machines)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const providers = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const getAvailableProvider = useExecutionStore((s) => s.getAvailableProvider)
  useEffect(() => { if (!machinesLoaded) loadMachines() }, [machinesLoaded, loadMachines])
  useEffect(() => { if (!providersLoaded) loadProviders() }, [providersLoaded, loadProviders])

  const profile = useUserProfileStore((s) => s.profile)
  const resolvedMachineId = node.machineId || project.defaultMachineId || profile.defaultMachineId || null
  const resolvedMachine = resolvedMachineId ? liveMachines.find((m) => m.machineId === resolvedMachineId) ?? null : null

  const registeredProviderIds = useMemo(() => {
    if (!resolvedMachineId) return null
    const reg = machines.find((m) => m.id === resolvedMachineId)
    return reg?.providers ?? null
  }, [resolvedMachineId, machines])

  const availableProviders: ProviderStatus[] = useMemo(() => {
    if (resolvedMachine?.providers?.length) return deriveAvailableProviders(resolvedMachine.providers, providers)
    if (registeredProviderIds?.length) {
      return registeredProviderIds.map((id) => ({
        id, name: id, available: true, installed: true,
        authStatus: "unknown" as ProviderStatus["authStatus"],
      }))
    }
    return providers
  }, [resolvedMachine, registeredProviderIds, providers])

  // Provider
  const defaultProvider = useSettingsStore((s) => s.defaultProvider)
  const setDefaultProvider = useSettingsStore((s) => s.setDefaultProvider)
  const getModelForProvider = useSettingsStore((s) => s.getModelForProvider)
  const selectedProvider = defaultProvider || ""
  const selectedModel = getModelForProvider(selectedProvider || undefined) || ''

  // Execution
  const isExecuting = useExecutionStore((s) => s.isExecuting(node.id))
  const startExecution = useExecutionStore((s) => s.startExecution)
  const cancelExecution = useExecutionStore((s) => s.cancelExecution)
  const resetExecution = useExecutionStore((s) => s.resetExecution)
  const flushPendingSaves = useContentSaveStore((s) => s.flushPendingSaves)

  const allNodes = usePlanStore((s) => s.nodes)
  const allEdges = usePlanStore((s) => s.edges)
  const liveNodes = useMemo(() => allNodes.filter(isLive), [allNodes])
  const liveEdges = useMemo(() => allEdges.filter(isLive), [allEdges])

  const dirCheck = getProjectWorkingDir(project)
  const workingDir = dirCheck.dir || ''
  const canExecuteResult = canExecuteNode(node, liveNodes, liveEdges)
  const availableProvider = getAvailableProvider()
  const hasExecutionTarget = resolvedMachine !== null || availableProvider !== null
  const executableStatuses: PlanNode["status"][] = ["planned", "in_progress", "awaiting_judgment", "completed", "auto_verified"]
  const canExecuteNow = canExecuteResult.ready && !isExecuting && executableStatuses.includes(node.status) && hasExecutionTarget && !!workingDir.trim()
  const isReexecution = node.status === "completed" || node.status === "auto_verified" || !!node.executionOutput

  const handleExecute = async () => {
    try {
      await flushPendingSaves([node.id])
    } catch {
      useToastStore.getState().add({ type: 'error', title: 'Failed to save changes', description: 'Could not save task content before execution.' })
      return
    }
    if (isReexecution) await resetExecution(node.id)
    startExecution(node.id, node.projectId, {
      preferredProvider: selectedProvider || undefined,
      model: selectedModel || undefined,
      useWorktree,
    })
    navigate(`/project/${project.id}/task/${node.id}${viewMode ? `?from=${viewMode}` : ''}`)
  }

  // Editor URL
  const defaultMachine = project.defaultMachineId
    ? machines.find((m) => m.id === project.defaultMachineId)
    : (machines.length === 1 ? machines[0] : undefined)
  const editorUrl = project.workingDirectory
    ? buildEditorUrl(selectedApp, project.workingDirectory, useRemote, defaultMachine?.name)
    : null
  const selectedAppDef = EDITOR_APPS.find((a) => a.id === selectedApp)!

  const handleSelectApp = useCallback((appId: EditorAppId) => {
    setSelectedApp(appId)
    if (appId === 'vscode' || appId === 'vscode-insiders') setEditorType('vscode')
    else if (appId === 'cursor') setEditorType('cursor')
    if (project.workingDirectory) openWithEditor(appId, project.workingDirectory, useRemote, defaultMachine?.name)
  }, [setEditorType, project.workingDirectory, useRemote, defaultMachine?.name])

  const pillClass = "flex h-6 items-center gap-1 px-2 rounded-full border border-border hover:bg-muted hover:text-foreground transition-colors cursor-pointer text-[11px] text-muted-foreground shrink-0"

  const hasWorkdir = !!(project.workingDirectory || project.repository)

  return (
    <>
      <RepoConfigDialog open={repoConfigOpen} onOpenChange={setRepoConfigOpen} project={project} />

      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{nodeSchedule ? 'Edit Schedule' : 'Create Schedule'}</DialogTitle>
          </DialogHeader>
          <ScheduleForm
            projectId={node.projectId}
            scope="node"
            nodeId={node.id}
            schedule={nodeSchedule}
            onSave={() => { setScheduleDialogOpen(false); loadSchedules(node.projectId) }}
            onCancel={() => setScheduleDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <div className="flex items-center gap-2 px-3 md:px-6 h-9 shrink-0 text-xs border-t border-border">
        {hasWorkdir ? (
          <>
            <MachineWorkdirPill project={project} onClick={() => setRepoConfigOpen(true)} />

            {project.workingDirectory && (
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="flex items-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        disabled={selectedApp !== 'finder' && !editorUrl}
                        onClick={() => { if (project.workingDirectory) openWithEditor(selectedApp, project.workingDirectory, useRemote, defaultMachine?.name) }}
                        className={cn(
                          "flex items-center justify-center h-6 w-6 rounded-l-full border border-border hover:bg-muted transition-colors",
                          !editorUrl && selectedApp !== 'finder' && "opacity-40 cursor-not-allowed"
                        )}
                      >
                        <AppIcon appId={selectedApp} className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Open in {selectedAppDef.label}</TooltipContent>
                  </Tooltip>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="flex items-center justify-center h-6 w-5 rounded-r-full border border-l-0 border-border hover:bg-muted transition-colors cursor-pointer">
                        <ChevronLeft className="h-3 w-3 text-muted-foreground rotate-[270deg]" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-1" align="start" side="top">
                      {EDITOR_APPS.filter((app) => !app.desktopOnly || isDesktop()).map((app) => (
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
                    </PopoverContent>
                  </Popover>
                </div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={toggleRemote}
                      className={cn(
                        "flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] font-medium transition-colors",
                        useRemote
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-muted"
                      )}
                    >
                      <Wifi className="h-3 w-3" />
                      Remote
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Open in Remote (SSH)</TooltipContent>
                </Tooltip>
              </div>
            )}

            <div className="flex items-center gap-2 ml-auto shrink-0">
              {/* File browser toggle */}
              {defaultMachine && project.workingDirectory && onToggleFileBrowser && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={onToggleFileBrowser}
                      className={cn(
                        "flex items-center justify-center h-6 w-6 rounded-full border transition-colors",
                        fileBrowserOpen
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border hover:bg-muted text-muted-foreground"
                      )}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{fileBrowserOpen ? "Close files" : "Browse files"}</TooltipContent>
                </Tooltip>
              )}

              <ProviderAgentPicker
                providers={availableProviders}
                value={selectedProvider}
                onChange={(id) => setDefaultProvider(id)}
                align="end"
              />

              {/* Worktree toggle */}
              {!node.executionId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setUseWorktree(!useWorktree)}
                      className={cn(pillClass, useWorktree && "border-primary/40 text-primary")}
                    >
                      <GitBranch className="h-3 w-3 shrink-0" />
                      {useWorktree ? <ToggleRight className="h-3 w-3 text-primary" /> : <ToggleLeft className="h-3 w-3" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{useWorktree ? "Worktree isolation on" : "Worktree off"}</TooltipContent>
                </Tooltip>
              )}

              {/* Schedule button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setScheduleDialogOpen(true)}
                    className={cn(
                      "flex items-center justify-center h-6 w-6 rounded-full border transition-colors",
                      nodeSchedule && nodeSchedule.enabled
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border hover:bg-muted text-muted-foreground"
                    )}
                  >
                    <Clock className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{nodeSchedule ? "Edit schedule" : "Add schedule"}</TooltipContent>
              </Tooltip>

              {/* Dependency/workdir warnings */}
              {!node.executionId && !canExecuteResult.ready && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex h-6 items-center gap-1 px-2 rounded-full bg-warning/10 border border-warning/30 text-[11px] text-warning shrink-0">
                      <AlertCircle className="h-3 w-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{canExecuteResult.reason}</TooltipContent>
                </Tooltip>
              )}
              {!node.executionId && dirCheck.source === 'auto-workspace' && (
                <button
                  type="button"
                  onClick={() => setRepoConfigOpen(true)}
                  className="flex h-6 items-center gap-1 px-2 rounded-full bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-600 shrink-0 hover:bg-amber-500/15 transition-colors cursor-pointer"
                >
                  <AlertCircle className="h-3 w-3" />
                </button>
              )}

              {/* Execute / Stop */}
              {!node.executionId && (
                isExecuting ? (
                  <button
                    type="button"
                    onClick={() => cancelExecution(node.id)}
                    className="flex h-6 items-center gap-1 px-3 rounded-full bg-destructive text-destructive-foreground text-[11px] font-medium shrink-0 hover:bg-destructive/90 transition-colors cursor-pointer"
                  >
                    <Square className="h-3 w-3" />
                  </button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={handleExecute}
                        disabled={!canExecuteNow}
                        className="flex h-6 items-center gap-1 px-2.5 rounded-full bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Play className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{isReexecution ? "Re-execute" : "Execute"}</TooltipContent>
                  </Tooltip>
                )
              )}
            </div>
          </>
        ) : (
          <div className="ml-auto shrink-0">
            <MachineWorkdirPill project={project} onClick={() => setRepoConfigOpen(true)} />
          </div>
        )}
      </div>
    </>
  )
}

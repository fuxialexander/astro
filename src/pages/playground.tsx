/**
 * Playground Page
 *
 * General-purpose AI coding session interface (like a cloud code session).
 * Uses the dispatch system with full execution access.
 *
 * Two-phase component:
 * 1. Landing Phase: Goal textarea + machine/directory selectors + history
 * 2. Activity Phase: Full-height streaming activity with file sidebar
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useSearchParams, useNavigate } from "react-router"
import {
  Terminal,
  Loader2,
  Laptop,
  FolderOpen,
  Bot,
  Send,
  ArrowDown,
  Clock,
  Play,
  Layers,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useExecutionStore, type MachineInfo } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useSettingsStore } from "@/stores/settings-store"
import { RemotePathBrowser } from "@/components/remote-path-browser"
import { PlaygroundHeader } from "@/components/playground/playground-header"
import { PlaygroundFileSidebar } from "@/components/playground/playground-file-sidebar"
import { InlineApprovalCard } from "@/components/plan-session/inline-approval-card"
import { TraceViewer } from "@/components/task-detail/trace-viewer"
import {
  groupActivityEvents,
  TextBlock,
  ToolBlock,
  ToolGroupBlock,
  SteerBlock,
  FileChangeBlock,
  ErrorBlock,
  type DisplayBlock,
} from "@/components/activity-blocks"
import { requestNotificationPermission } from "@/lib/notifications"
import { isServerMode } from "@/lib/app-mode"
import { cn } from "@/lib/utils"
import { deriveAvailableProviders, PROVIDER_NAMES } from "@/components/execution/provider-utils"
import type { TaskActivityEvent } from "@/types"

// Identify playground projects by the projectType field (persisted) or execution key (in-memory fallback)
function isPlaygroundProject(project: { projectType?: string; id: string }, executions: Map<string, unknown>): boolean {
  return project.projectType === 'playground' || executions.has(`playground-${project.id}`)
}

export function Playground() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const projectIdParam = searchParams.get("projectId")

  // Input phase state
  const [description, setDescription] = useState("")
  const [workingDir, setWorkingDir] = useState("")
  const [selectedMachine, setSelectedMachine] = useState<MachineInfo | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPathBrowser, setShowPathBrowser] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState("")
  const [selectedModel, setSelectedModel] = useState("")

  // Activity phase state
  const [activeProjectId, setActiveProjectId] = useState<string | null>(projectIdParam)
  const [fileSidebarOpen, setFileSidebarOpen] = useState(false)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [viewMode, setViewMode] = useState<"activity" | "trace">("activity")
  const viewModeAutoSwitched = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Stores
  const startPlaygroundSession = useExecutionStore((s) => s.startPlaygroundSession)
  const cancelPlaygroundSession = useExecutionStore((s) => s.cancelPlaygroundSession)
  const steerPlaygroundSession = useExecutionStore((s) => s.steerPlaygroundSession)
  const allExecutions = useExecutionStore((s) => s.executions)
  const execution = useExecutionStore((s) =>
    activeProjectId ? s.executions.get(`playground-${activeProjectId}`) : undefined
  )
  const project = useProjectStore((s) =>
    activeProjectId ? s.projects.find((p) => p.id === activeProjectId) : undefined
  )
  const allProjects = useProjectStore((s) => s.projects)

  // Machines
  const machines = useExecutionStore((s) => s.machines)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const realtimeMachines = useRealtimeStore((s) => s.machines)
  const registeredMachines = useMachinesStore((s) => s.machines)

  // Providers
  const globalProviders = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const availableProviders = useMemo(
    () => deriveAvailableProviders(selectedMachine?.providers, globalProviders),
    [selectedMachine?.providers, globalProviders]
  )

  // Settings — use configured model tier when user hasn't explicitly picked one
  const getModelForProvider = useSettingsStore((s) => s.getModelForProvider)

  // Realtime state for activity events
  const executionId = execution?.executionId || ""
  const taskStream = useRealtimeStore(useCallback((s) => s.taskStreams.get(executionId), [executionId]))
  const dynamicApprovalsMap = useRealtimeStore((s) => s.dynamicApprovals)
  const respondToDynamicApproval = useRealtimeStore((s) => s.respondToDynamicApproval)
  const addSteerMessage = useRealtimeStore((s) => s.addSteerMessage)

  // Load machines and providers on mount
  useEffect(() => {
    if (!machinesLoaded) loadMachines()
  }, [machinesLoaded, loadMachines])

  useEffect(() => {
    if (!providersLoaded) loadProviders()
  }, [providersLoaded, loadProviders])

  useEffect(() => {
    requestNotificationPermission()
  }, [])

  // Reset provider/model when machine changes
  const prevMachineIdRef = useRef(selectedMachine?.machineId)
  useEffect(() => {
    if (prevMachineIdRef.current !== selectedMachine?.machineId) {
      prevMachineIdRef.current = selectedMachine?.machineId
      setSelectedProvider("")
      setSelectedModel("")
    }
  }, [selectedMachine?.machineId])

  // If URL has projectId, transition to activity phase
  useEffect(() => {
    if (projectIdParam && !activeProjectId) {
      setActiveProjectId(projectIdParam)
    }
  }, [projectIdParam, activeProjectId])

  // Machine name for display
  const machineName = (() => {
    if (!execution?.machineId) return undefined
    const realtimeM = realtimeMachines.get(execution.machineId)
    if (realtimeM) return realtimeM.name
    const registeredM = registeredMachines.find((m) => m.id === execution.machineId)
    if (registeredM) return registeredM.name
    return execution.machineId
  })()

  // All machines (relay + realtime deduplicated)
  const allMachines = useMemo<MachineInfo[]>(() => [
    ...machines,
    ...Array.from(realtimeMachines.values()).map((m) => ({
      machineId: m.machineId,
      name: m.name,
      status: 'online' as const,
      providers: m.providers.map((p) => ({ type: p.type, status: p.status })),
    })),
  ].filter((m, i, arr) => arr.findIndex((a) => a.machineId === m.machineId) === i), [machines, realtimeMachines])

  // Playground session history
  const playgroundHistory = useMemo(() => {
    return allProjects
      .filter((p) => isPlaygroundProject(p, allExecutions))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 20)
  }, [allProjects, allExecutions])

  // Merge activity events from execution + realtime
  const activityEvents: TaskActivityEvent[] = useMemo(() => {
    const execEvents = execution?.activityEvents || []
    const streamEvents = taskStream?.activityEvents || []

    if (execEvents.length === 0) return streamEvents
    if (streamEvents.length === 0) return execEvents

    const steerAndApprovalEvents = streamEvents.filter(
      e => e.type === 'steer' || e.type === 'approval_request' || e.type === 'approval_response'
    )
    if (steerAndApprovalEvents.length === 0) return execEvents

    const filteredExecEvents = execEvents.filter(
      e => !(e.type === 'tool_use' && (e as { toolName?: string }).toolName === 'AskUserQuestion')
    )

    const seenRequestIds = new Set<string>()
    const deduped = [...filteredExecEvents, ...steerAndApprovalEvents]
    deduped.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    for (let i = deduped.length - 1; i >= 0; i--) {
      const e = deduped[i]
      if (e.type === 'approval_request') {
        const rid = (e as { requestId: string }).requestId
        if (seenRequestIds.has(rid)) {
          deduped.splice(i, 1)
        } else {
          seenRequestIds.add(rid)
        }
      }
    }
    return deduped
  }, [execution?.activityEvents, taskStream?.activityEvents])

  const displayBlocks = useMemo(() => groupActivityEvents(activityEvents), [activityEvents])

  const pendingApprovals = useMemo(() => {
    if (!execution?.executionId) return []
    return Array.from(dynamicApprovalsMap.values()).filter(
      (a) => a.taskId === execution.executionId
    )
  }, [dynamicApprovalsMap, execution?.executionId])

  const answeredRequestIds = useMemo(() => {
    const ids = new Set<string>()
    for (const event of activityEvents) {
      if (event.type === 'approval_response') {
        ids.add(event.requestId)
      }
    }
    return ids
  }, [activityEvents])

  const isRunning = execution?.status === "pending" || execution?.status === "running"

  const headerStatus = execution?.status === "success" || execution?.status === "failure"
    ? (execution.error ? 'error' : 'completed')
    : pendingApprovals.length > 0
      ? 'waiting'
      : 'running'

  // Auto-switch to trace view when activity events are empty after refresh (not running)
  useEffect(() => {
    if (activeProjectId && execution && !isRunning && activityEvents.length === 0 && execution.executionId && !viewModeAutoSwitched.current) {
      viewModeAutoSwitched.current = true
      setViewMode("trace")
    }
  }, [activeProjectId, execution, isRunning, activityEvents.length])

  // Auto-scroll
  const eventsLength = activityEvents.length
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [eventsLength, autoScroll, displayBlocks.length])

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50)
  }, [])

  // Submit new playground session
  const handleSubmit = useCallback(async () => {
    if (!description.trim() || isSubmitting || !selectedMachine || !workingDir.trim()) return
    setIsSubmitting(true)

    try {
      // Resolve model: explicit selection > settings store default for the provider
      const effectiveModel = selectedModel || getModelForProvider(selectedProvider || undefined)
      const { projectId } = await startPlaygroundSession(
        description.trim(),
        {
          targetMachineId: selectedMachine.machineId,
          workingDirectory: workingDir.trim(),
          preferredProvider: selectedProvider || undefined,
          model: effectiveModel,
        }
      )

      setActiveProjectId(projectId)
      setSearchParams({ projectId })
    } catch (error) {
      console.error("[playground] Failed to start:", error)
    } finally {
      setIsSubmitting(false)
    }
  }, [description, isSubmitting, selectedMachine, workingDir, selectedProvider, selectedModel, getModelForProvider, startPlaygroundSession, setSearchParams])

  // Send steer message
  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sending || !isRunning || !activeProjectId) return

    setSending(true)
    const savedInput = input
    setInput("")

    if (execution?.executionId) {
      addSteerMessage(execution.executionId, text)
    }

    try {
      const ok = await steerPlaygroundSession(activeProjectId, text)
      if (!ok) {
        setInput(savedInput)
      }
    } catch {
      setInput(savedInput)
    } finally {
      setSending(false)
    }
  }, [input, sending, isRunning, activeProjectId, execution?.executionId, addSteerMessage, steerPlaygroundSession])

  // Handle approval response
  const handleApprovalResponse = useCallback(async (requestId: string, answer: string) => {
    if (!execution?.executionId) return
    await respondToDynamicApproval(execution.executionId, requestId, answer)
  }, [execution?.executionId, respondToDynamicApproval])

  // Render a display block
  const renderBlock = useCallback((block: DisplayBlock, index: number) => {
    const isLastBlock = index === displayBlocks.length - 1
    switch (block.type) {
      case 'text':
        return <TextBlock key={index} events={block.events} isStreaming={isRunning && isLastBlock} />
      case 'tool':
        return <ToolBlock key={index} events={block.events} isRunning={isRunning} />
      case 'tool_group':
        return <ToolGroupBlock key={index} events={block.events} isRunning={isRunning} />
      case 'steer':
        return <SteerBlock key={index} event={block.events[0] as Extract<TaskActivityEvent, { type: 'steer' }>} />
      case 'file_change':
        return <FileChangeBlock key={index} event={block.events[0] as Extract<TaskActivityEvent, { type: 'file_change' }>} />
      case 'error':
        return <ErrorBlock key={index} event={block.events[0] as Extract<TaskActivityEvent, { type: 'error' }>} />
      case 'approval_request': {
        const event = block.events[0] as Extract<TaskActivityEvent, { type: 'approval_request' }>
        const isAnswered = answeredRequestIds.has(event.requestId)
        const responseEvent = activityEvents.find(
          (e): e is Extract<TaskActivityEvent, { type: 'approval_response' }> =>
            e.type === 'approval_response' && e.requestId === event.requestId
        )
        return (
          <InlineApprovalCard
            key={index}
            requestId={event.requestId}
            question={event.question}
            options={event.options}
            answered={isAnswered}
            answer={responseEvent?.answer}
            onRespond={handleApprovalResponse}
          />
        )
      }
      case 'approval_response':
        return null
      default:
        return null
    }
  }, [displayBlocks.length, isRunning, answeredRequestIds, activityEvents, handleApprovalResponse])

  // Go back to landing phase
  const handleBack = useCallback(() => {
    setActiveProjectId(null)
    setSearchParams({})
    setInput("")
    setFileSidebarOpen(false)
  }, [setSearchParams])

  // Navigate to plan creation with playground context
  const handleStartPlan = useCallback(() => {
    if (!activeProjectId) return
    navigate('/projects/new/plan', { state: { fromPlaygroundId: activeProjectId } })
  }, [activeProjectId, navigate])

  // View a past session
  const viewSession = useCallback((projectId: string) => {
    setActiveProjectId(projectId)
    setSearchParams({ projectId })
    setViewMode("activity")
    viewModeAutoSwitched.current = false
  }, [setSearchParams])

  // ─── Loading / Not Found State ─────────────────────────────────────
  if (activeProjectId && !execution) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading session...</p>
        <Button variant="outline" size="sm" onClick={handleBack}>
          Go back
        </Button>
      </div>
    )
  }

  // ─── Activity Phase ──────────────────────────────────────────────
  if (activeProjectId && execution) {
    const sessionTitle = project?.name || "Playground Session"

    return (
      <div className="flex h-full">
        <div className="flex flex-col flex-1 min-w-0 relative">
          <PlaygroundHeader
            title={sessionTitle}
            status={headerStatus as 'running' | 'waiting' | 'completed' | 'error'}
            machineName={machineName}
            workingDirectory={project?.workingDirectory || workingDir || undefined}
            fileSidebarOpen={fileSidebarOpen}
            onBack={handleBack}
            onAbort={() => cancelPlaygroundSession(activeProjectId)}
            onToggleFileSidebar={() => setFileSidebarOpen(!fileSidebarOpen)}
            onStartPlan={handleStartPlan}
          />

          {/* View mode tabs — Activity / Trace */}
          {execution?.executionId && (
            <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-background shrink-0">
              <button
                onClick={() => setViewMode("activity")}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                  viewMode === "activity"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
              >
                Activity
              </button>
              <button
                onClick={() => setViewMode("trace")}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
                  viewMode === "trace"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
              >
                <Layers className="h-3 w-3" />
                Trace
              </button>
            </div>
          )}

          {/* Trace View */}
          {viewMode === "trace" && execution?.executionId ? (
            <div className="flex-1 min-h-0">
              <TraceViewer executionId={execution.executionId} isRunning={isRunning} />
            </div>
          ) : (
            <>
              {/* Activity Timeline */}
              <div
                ref={containerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-auto py-3 bg-muted/20"
              >
                {execution?.status === "failure" && execution.error && displayBlocks.length === 0 && (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center max-w-md px-4">
                      <p className="text-sm font-medium text-destructive mb-1">Session failed</p>
                      <p className="text-xs text-muted-foreground">{execution.error}</p>
                    </div>
                  </div>
                )}

                {displayBlocks.length === 0 && execution?.status !== "failure" && (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    {isRunning ? "Starting session..." : "No activity yet"}
                  </div>
                )}

                {displayBlocks.map((block, i) => renderBlock(block, i))}
              </div>

              {/* Scroll to bottom button */}
              {!autoScroll && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="absolute bottom-16 right-4 h-8 gap-1.5 shadow-md z-10"
                  onClick={() => {
                    setAutoScroll(true)
                    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: "smooth" })
                  }}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  Bottom
                </Button>
              )}
            </>
          )}

          {/* Completion Footer */}
          {!isRunning && execution?.status === "success" && (
            <div className="border-t border-border bg-background shrink-0 px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Session completed</span>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleStartPlan}>
                <Sparkles className="h-3.5 w-3.5" />
                Start Planning from This
              </Button>
            </div>
          )}

          {/* Input Bar */}
          {isRunning && (
            <div className="border-t border-border bg-background shrink-0">
              <div className="flex items-end gap-2 p-3">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="Send a message..."
                  rows={1}
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
                <Button
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* File Sidebar */}
        {fileSidebarOpen && execution?.machineId && (project?.workingDirectory || workingDir) && (
          <PlaygroundFileSidebar
            machineId={execution.machineId}
            machineName={machineName}
            workingDirectory={project?.workingDirectory || workingDir}
            onClose={() => setFileSidebarOpen(false)}
          />
        )}
      </div>
    )
  }

  // ─── Landing Phase ───────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-start min-h-full p-6 overflow-auto">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8 mt-8">
          <h1 className="text-2xl font-bold font-sans mb-2">Playground</h1>
          <p className="text-sm text-muted-foreground">
            Start a coding session. The agent has full access to your codebase — no safety checks, no planning overhead.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {/* Goal textarea */}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder="What would you like to work on?"
            rows={6}
            autoFocus
            className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />

          {/* Machine selector */}
          {(isServerMode() || allMachines.length > 0) && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                Machine <span className="text-destructive">*</span>
              </span>
              <div className="flex flex-wrap gap-2">
                {allMachines.map((m) => (
                  <button
                    key={m.machineId}
                    onClick={() => setSelectedMachine(
                      selectedMachine?.machineId === m.machineId ? null : m
                    )}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors cursor-pointer",
                      selectedMachine?.machineId === m.machineId
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted"
                    )}
                  >
                    <Laptop className="h-3 w-3" />
                    {m.name}
                  </button>
                ))}
                {allMachines.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No machines connected. Start an agent runner first.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Provider selector */}
          {availableProviders.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Provider:</span>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => { setSelectedProvider(""); setSelectedModel("") }}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors cursor-pointer",
                    !selectedProvider
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted"
                  )}
                >
                  <Bot className="h-3 w-3" />
                  Auto
                </button>
                {availableProviders.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedProvider(selectedProvider === p.id ? "" : p.id)
                      setSelectedModel("")
                    }}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors cursor-pointer",
                      selectedProvider === p.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted"
                    )}
                  >
                    <Bot className="h-3 w-3" />
                    {PROVIDER_NAMES[p.id] || p.name || p.id}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Working directory — required, shown when a machine is selected */}
          {selectedMachine && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                Working directory <span className="text-destructive">*</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPathBrowser(true)}
                  title="Browse directories"
                  className="shrink-0 rounded-md border border-border p-1.5 hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
                <input
                  type="text"
                  value={workingDir}
                  onChange={(e) => setWorkingDir(e.target.value)}
                  placeholder="/path/to/project"
                  className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          )}

          {/* Submit button */}
          <div className="flex items-center justify-end gap-3">
            <p className="text-[10px] text-muted-foreground">
              Cmd+Enter to submit
            </p>
            <Button
              onClick={handleSubmit}
              disabled={!description.trim() || !selectedMachine || !workingDir.trim() || isSubmitting}
              className="gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Terminal className="h-4 w-4" />
              )}
              {isSubmitting ? "Starting..." : "Start Session"}
            </Button>
          </div>
        </div>

        {/* Playground History */}
        {playgroundHistory.length > 0 && (
          <div className="mt-10">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Recent Sessions
            </h2>
            <div className="flex flex-col gap-1">
              {playgroundHistory.map((p) => {
                const exec = allExecutions.get(`playground-${p.id}`)
                const statusLabel = exec?.status === 'running' ? 'Running'
                  : exec?.status === 'success' ? 'Completed'
                  : exec?.status === 'failure' ? 'Failed'
                  : exec?.status === 'cancelled' ? 'Cancelled'
                  : 'Pending'
                const statusColor = exec?.status === 'running' ? 'bg-primary'
                  : exec?.status === 'success' ? 'bg-success'
                  : exec?.status === 'failure' ? 'bg-destructive'
                  : 'bg-muted-foreground'

                return (
                  <button
                    key={p.id}
                    onClick={() => viewSession(p.id)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left group"
                  >
                    <span className={cn("h-2 w-2 rounded-full shrink-0", statusColor)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate font-mono">
                        {p.workingDirectory || "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-[10px]">
                        {statusLabel}
                      </Badge>
                      {exec?.status !== 'running' && exec?.status !== 'pending' && (
                        <Play className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Remote path browser dialog */}
        {selectedMachine && (
          <RemotePathBrowser
            open={showPathBrowser}
            onOpenChange={setShowPathBrowser}
            machineId={selectedMachine.machineId}
            machineName={selectedMachine.name}
            currentPath={workingDir || undefined}
            onSelect={(path) => setWorkingDir(path)}
          />
        )}
      </div>
    </div>
  )
}

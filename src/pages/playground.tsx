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
import { useTranslation } from "react-i18next"
import { useSearchParams, useNavigate } from "react-router"
import {
  Terminal,
  Loader2,
  Send,
  Square,
  ArrowDown,
  Clock,
  Sparkles,
  X,
  Pencil,
  Zap,
  RefreshCw,
} from "lucide-react"
import { TypingIndicator } from "@/components/ui/typing-indicator"
import { Button } from "@/components/ui/button"
import { MachineWorkdirSelector } from "@/components/machine-workdir-selector"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useExecutionStore, type MachineInfo } from "@/stores/execution-store"
import { useToastStore } from "@/stores/toast-store"
import { useProjectStore } from "@/stores/project-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useSettingsStore } from "@/stores/settings-store"
import { RemotePathBrowser } from "@/components/remote-path-browser"
import { PlaygroundHeader } from "@/components/playground/playground-header"
import { InlineRenameInput } from "@/components/inline-rename-input"
import { FileBrowser } from "@/components/file-browser"
import { resolveFilePathForBrowsing } from "@/components/task-detail/file-path-utils"
import { ActivityBlockRenderer } from "@/components/activity-block-renderer"
import { SessionPickerDialog } from "@/components/playground/session-picker-dialog"
import { useClaudeSessionsStore, type ClaudeCodeSession } from "@/stores/claude-sessions-store"
import { useSessionStore } from "@/stores/session-store"
import { requestNotificationPermission } from "@/lib/notifications"
import { isServerMode } from "@/lib/app-mode"
import { cn } from "@/lib/utils"
import { deriveAvailableProviders, PROVIDER_NAMES } from "@/components/execution/provider-utils"
import { ProviderDropdown } from "@/components/execution/provider-dropdown"
import { InstructionPicker } from "@/components/execution/instruction-picker"
import { useMachineInstructionStore } from "@/stores/machine-instruction-store"
import type { TaskActivityEvent } from "@/types"
import { useAutoScroll } from "@/hooks/use-auto-scroll"
import { useChatSession } from "@/hooks/use-chat-session"
import { useActivityFeed } from "@/hooks/use-activity-feed"

// Identify playground projects by the projectType field (persisted) or execution key (in-memory fallback)
function isPlaygroundProject(project: { projectType?: string; id: string }, executions: Map<string, unknown>): boolean {
  return project.projectType === 'playground' || executions.has(`playground-${project.id}`)
}

export function Playground() {
  const { t } = useTranslation('nav')
  const isMobile = useMediaQuery("(max-width: 767px)")
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const projectIdParam = searchParams.get("projectId")
  // URL params for pre-filling machine/workdir from command palette "Start Playground In..."
  const machineParam = searchParams.get("machine")
  const workdirParam = searchParams.get("workdir")

  // Input phase state
  const [description, setDescription] = useState("")
  const [workingDir, setWorkingDir] = useState("")
  const [selectedMachine, setSelectedMachine] = useState<MachineInfo | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPathBrowser, setShowPathBrowser] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false)

  // Activity phase state
  const [activeProjectId, setActiveProjectId] = useState<string | null>(projectIdParam)
  const [fileSidebarOpen, setFileSidebarOpen] = useState(false)
  const [initialFilePath, setInitialFilePath] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  // pendingSteerText removed: pending steers now render inline in activityEvents
  // queuedMessage removed: steer messages are now persisted to streaming_events
  // with status 'pending' and batch-drained by the relay when the agent is ready.
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  // Track provider during activity phase (for mid-session switching and follow-up chat)
  const [activeProvider, setActiveProvider] = useState("")
  // Track whether user explicitly switched providers (for model name display)
  const [providerExplicitlyChanged, setProviderExplicitlyChanged] = useState(false)
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
  const updateProject = useProjectStore((s) => s.updateProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)

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

  // Auto-select the first available provider when none is selected
  useEffect(() => {
    if (!selectedProvider && availableProviders.length > 0) {
      setSelectedProvider(availableProviders[0].id)
    }
  }, [selectedProvider, availableProviders])

  // Settings — use configured model tier when user hasn't explicitly picked one
  const getModelForProvider = useSettingsStore((s) => s.getModelForProvider)

  // Realtime state for activity events
  const executionId = execution?.executionId || ""
  const dynamicApprovalsMap = useRealtimeStore((s) => s.dynamicApprovals)
  const respondToDynamicApproval = useRealtimeStore((s) => s.respondToDynamicApproval)
  const addSteerMessage = useRealtimeStore((s) => s.addSteerMessage)

  // Task stream stats for header monitoring indicators
  const taskStreamModel = useRealtimeStore(
    useCallback((s) => executionId ? s.taskStreams.get(executionId)?.model : undefined, [executionId])
  )
  const taskStreamToolCount = useRealtimeStore(
    useCallback((s) => executionId ? s.taskStreams.get(executionId)?.toolTraces.length : undefined, [executionId])
  )

  // Sessions store (Claude Code sessions picker)
  const loadSessions = useClaudeSessionsStore((s) => s.loadSessions)

  // Session store for mount tracking
  const registerMounted = useSessionStore((s) => s.registerMounted)
  const unregisterMounted = useSessionStore((s) => s.unregisterMounted)
  const playgroundYolo = useSettingsStore((s) => s.playgroundYoloMode)

  // Machine instructions
  const miLoaded = useMachineInstructionStore((s) => s.loaded)
  const miLoad = useMachineInstructionStore((s) => s.load)
  const miAssign = useMachineInstructionStore((s) => s.assignToMachine)

  // Load machines, providers, and sessions on mount
  useEffect(() => {
    if (!machinesLoaded) loadMachines()
  }, [machinesLoaded, loadMachines])

  useEffect(() => {
    if (!providersLoaded) loadProviders()
  }, [providersLoaded, loadProviders])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  useEffect(() => {
    if (!miLoaded) miLoad()
  }, [miLoaded, miLoad])

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

  // Sync URL → state: if URL gains a projectId we don't have, adopt it.
  // But ignore when URL still has the stale param during handleBack (activeProjectId was just cleared).
  const backingRef = useRef(false)
  const urlExecProviderId = useExecutionStore((s) =>
    projectIdParam ? s.executions.get(`playground-${projectIdParam}`)?.providerId : undefined
  )
  useEffect(() => {
    if (backingRef.current) {
      backingRef.current = false
      return
    }
    if (projectIdParam && projectIdParam !== activeProjectId) {
      setActiveProvider(urlExecProviderId || "")
      setActiveProjectId(projectIdParam)
    }
    if (!projectIdParam && activeProjectId) {
      setActiveProjectId(null)
    }
  }, [projectIdParam, activeProjectId, urlExecProviderId])

  // Machine name for display — check execution store first, fall back to taskStream
  // (taskStream always gets machineId from task:init SSE; execution store may lag)
  const taskStreamMachineId = useRealtimeStore(
    useCallback((s) => executionId ? s.taskStreams.get(executionId)?.machineId : undefined, [executionId])
  )
  const machineName = (() => {
    const mid = execution?.machineId || taskStreamMachineId
    if (!mid) return undefined
    const realtimeM = realtimeMachines.get(mid)
    if (realtimeM) return realtimeM.name
    const registeredM = registeredMachines.find((m) => m.id === mid)
    if (registeredM) return registeredM.name
    return mid
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

  // Consume machine/workdir URL params to pre-fill landing phase fields.
  // Runs once machines are loaded to ensure we can resolve the machine object.
  const prefillConsumedRef = useRef(false)
  useEffect(() => {
    if (prefillConsumedRef.current) return
    if (!machineParam && !workdirParam) return
    // Wait until machines have loaded before attempting to resolve
    if (!machinesLoaded) return

    prefillConsumedRef.current = true

    try {
      if (workdirParam) {
        setWorkingDir(decodeURIComponent(workdirParam))
      }
      if (machineParam) {
        const machineId = decodeURIComponent(machineParam)
        const found = allMachines.find((m) => m.machineId === machineId)
        if (found) setSelectedMachine(found)
      }
    } catch {
      // Malformed URI component — ignore prefill
    }

    // Clear the params from the URL after consuming them
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('machine')
      next.delete('workdir')
      return next
    }, { replace: true })
  }, [machineParam, workdirParam, machinesLoaded, allMachines, setSearchParams])

  // Providers for the active session (derived from the execution's machine)
  const activeSessionProviders = useMemo(() => {
    if (!execution?.machineId) return globalProviders
    const machine = allMachines.find((m) => m.machineId === execution.machineId)
    return deriveAvailableProviders(machine?.providers, globalProviders)
  }, [execution?.machineId, allMachines, globalProviders])

  // Playground session history
  const [historyDisplayLimit, setHistoryDisplayLimit] = useState(20)
  const allPlaygroundHistory = useMemo(() => {
    return allProjects
      .filter((p) => isPlaygroundProject(p, allExecutions))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [allProjects, allExecutions])
  const playgroundHistory = useMemo(() => {
    return allPlaygroundHistory.slice(0, historyDisplayLimit)
  }, [allPlaygroundHistory, historyDisplayLimit])

  const isRunning = execution?.status === "pending" || execution?.status === "running"

  // Timeout warning — show if running but no init event received within 30s
  const [showTimeout, setShowTimeout] = useState(false)
  useEffect(() => {
    if (!isRunning || execution?.executionId) {
      setShowTimeout(false)
      return
    }
    const timer = setTimeout(() => setShowTimeout(true), 30_000)
    return () => clearTimeout(timer)
  }, [isRunning, execution?.executionId])

  // Chat session (post-completion follow-up) — shared hook handles lookup, creation, lazy-load
  const playgroundNodeId = activeProjectId ? `playground-${activeProjectId}` : ''
  const { chatSession, isChatStreaming, addMessage, sendPlaygroundChat, abortChatStream } =
    useChatSession({
      projectId: activeProjectId || '',
      type: "task-chat",
      nodeId: playgroundNodeId || undefined,
    })

  const chatSessionId = chatSession?.id || ''

  // Register/unregister mounted state for background notification detection
  useEffect(() => {
    if (!chatSessionId) return
    registerMounted(chatSessionId)
    return () => unregisterMounted(chatSessionId)
  }, [chatSessionId, registerMounted, unregisterMounted])

  // Unified activity feed — merges execution + chat events with playground dedup
  const playgroundSessionMessages = useMemo(() => chatSession?.messages || [], [chatSession?.messages])
  const {
    execActivityEvents: activityEvents,
    allActivityEvents, displayBlocks, answeredRequestIds, approvalResponseMap, isRestoring,
  } = useActivityFeed({
    executionId: executionId || undefined,
    chatSessionId: chatSession?.id,
    execution,
    chatMessages: playgroundSessionMessages,
  })

  const pendingApprovals = useMemo(() => {
    if (!execution?.executionId) return []
    return Array.from(dynamicApprovalsMap.values()).filter(
      (a) => a.taskId === execution.executionId
    )
  }, [dynamicApprovalsMap, execution?.executionId])

  const headerStatus = execution?.status === "cancelled"
    ? 'stopped'
    : isChatStreaming
      ? 'running'
      : execution?.status === "success" || execution?.status === "failure"
        ? (execution.error ? 'error' : 'completed')
        : pendingApprovals.length > 0
          ? 'waiting'
          : 'running'

  // Auto-scroll
  const { autoScroll, handleScroll, scrollToBottom } = useAutoScroll(
    containerRef,
    [allActivityEvents.length, displayBlocks.length],
  )

  // Submit new playground session
  const handleSubmit = useCallback(async () => {
    if (!description.trim() || isSubmitting || !selectedMachine) return
    setIsSubmitting(true)

    try {
      // Resolve model: explicit selection > settings store default for the provider
      const effectiveModel = selectedModel || getModelForProvider(selectedProvider || undefined)
      const { projectId } = await startPlaygroundSession(
        description.trim(),
        {
          targetMachineId: selectedMachine.machineId,
          workingDirectory: workingDir.trim() || undefined,
          preferredProvider: selectedProvider || undefined,
          model: effectiveModel,
        }
      )

      setActiveProjectId(projectId)
      setActiveProvider(selectedProvider)
      setSearchParams({ projectId })
    } catch (error) {
      console.error("[playground] Failed to start:", error)
    } finally {
      setIsSubmitting(false)
    }
  }, [description, isSubmitting, selectedMachine, workingDir, selectedProvider, selectedModel, getModelForProvider, startPlaygroundSession, setSearchParams])

  // Fork a Claude Code session
  const handleForkSession = useCallback(async (session: ClaudeCodeSession) => {
    if (isSubmitting) return
    setIsSubmitting(true)

    // Find matching machine from allMachines
    const machine = allMachines.find((m) => m.machineId === session.machineId)
    if (!machine) {
      console.error("[playground] Machine not found for session fork:", session.machineId)
      setIsSubmitting(false)
      return
    }

    try {
      const title = session.customTitle || session.summary || session.firstPrompt || "Forked session"
      const { projectId } = await startPlaygroundSession(
        `Fork: ${title}`,
        {
          targetMachineId: session.machineId,
          workingDirectory: session.cwd || undefined,
          resumeSessionId: session.sessionId,
          forkSession: true,
        }
      )

      setActiveProvider("") // Forks don't specify a provider — start fresh
      setActiveProjectId(projectId)
      setSearchParams({ projectId })
    } catch (error) {
      console.error("[playground] Failed to fork session:", error)
    } finally {
      setIsSubmitting(false)
    }
  }, [isSubmitting, allMachines, startPlaygroundSession, setSearchParams])

  // Provider change handler — notify user when switching during a running session
  const handleProviderChange = useCallback((providerId: string) => {
    setActiveProvider(providerId)
    setProviderExplicitlyChanged(true)
    if (isRunning) {
      const providerName = providerId
        ? (PROVIDER_NAMES[providerId] || providerId)
        : "Auto"
      useToastStore.getState().add({
        type: 'info',
        title: `Switched to ${providerName}`,
        description: 'The current execution continues with its original provider. Your next follow-up message will use the new provider.',
        duration: 5000,
      })
    }
  }, [isRunning])

  // Steer message handler (while running)
  // Write-first: the server persists the message as 'pending' before attempting
  // relay delivery. If delivery fails, the message is batch-drained later.
  const handleSteer = useCallback(async (text: string) => {
    if (!text || sending || !activeProjectId) return
    setSending(true)

    // Add to activity feed immediately as pending (shows clock indicator)
    if (execution?.executionId) {
      addSteerMessage(execution.executionId, text)
    }

    try {
      const result = await steerPlaygroundSession(activeProjectId, text)
      if (!result.success) {
        if (result.error === 'no-machine') {
          useToastStore.getState().add({
            type: 'error',
            title: 'Cannot send guidance',
            description: 'No connected machine found. The agent may not have started yet.',
            duration: 5000,
          })
        } else if (result.error === 'send-failed') {
          useToastStore.getState().add({
            type: 'error',
            title: 'Guidance delivery failed',
            description: 'Failed to send guidance to the agent. Please try again.',
            duration: 4000,
          })
        }
      }
    } catch {
      // Unexpected error — steerPlaygroundSession returns structured results and
      // should not throw, but guard here for safety.
    } finally {
      setSending(false)
    }
  }, [sending, activeProjectId, execution?.executionId, addSteerMessage, steerPlaygroundSession])

  // Chat message handler (post-completion) — delegates to store-owned SSE
  // No isChatStreaming guard: the store queues messages sent while streaming
  const handleChat = useCallback((text: string) => {
    if (!text || !chatSession || !activeProjectId) return

    const sid = chatSession.id

    // Store user message + empty assistant placeholder in session for conversation history.
    // The placeholder is streamed into by sendPlaygroundChat's onText callback.
    addMessage(sid, { role: "user", content: text })
    addMessage(sid, { role: "assistant", content: "" })

    // Re-read messages from store after adding user msg + placeholder (avoids stale closure)
    const freshSession = useSessionStore.getState().sessions.get(sid)
    const freshMessages = freshSession?.messages || []
    const historyMessages = freshMessages
      .slice(0, -2) // remove the just-added user msg + empty assistant placeholder
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content.length > 0))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

    const sessionTitle = project?.name || "Playground Session"

    // Delegate to store-owned SSE — survives navigation
    sendPlaygroundChat({
      sessionId: sid,
      projectId: activeProjectId,
      nodeId: playgroundNodeId,
      message: text,
      taskTitle: sessionTitle,
      taskDescription: `Playground coding session: ${sessionTitle}`,
      taskOutput: activityEvents
        .filter((e): e is Extract<TaskActivityEvent, { type: 'text' | 'tool_use' | 'tool_result' }> =>
          e.type === 'text' || e.type === 'tool_use' || e.type === 'tool_result')
        .map((e) => {
          if (e.type === 'text') return e.content
          if (e.type === 'tool_use') return `[Tool: ${e.toolName}]`
          if (e.type === 'tool_result') return `[Result: ${e.toolName} — ${e.success ? 'success' : 'failed'}]`
          return ''
        })
        .join(''),
      visionDoc: project?.visionDoc,
      providerId: activeProvider || undefined,
      messages: historyMessages,
    })
  }, [chatSession, activeProjectId, playgroundNodeId, project, activeProvider, activityEvents, addMessage, sendPlaygroundChat])

  // Route: steer during execution, chat after completion
  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || !activeProjectId) return
    setInput("")

    if (isRunning) {
      handleSteer(text)
    } else {
      handleChat(text)
    }
  }, [input, activeProjectId, isRunning, handleSteer, handleChat])

  // Auto-send queued message removed: steer messages are now DB-backed
  // with batch drain on session_init and between turns.

  // Handle approval response
  const handleApprovalResponse = useCallback(async (requestId: string, answer: string) => {
    if (!execution?.executionId) return
    await respondToDynamicApproval(execution.executionId, requestId, answer)
  }, [execution?.executionId, respondToDynamicApproval])

  // Handle sendPrompt from VisualWidget iframes
  const handleSendPrompt = useCallback((text: string) => {
    if (!activeProjectId) return
    setInput(text)
    // Auto-send after a tick so the input state updates
    setTimeout(() => {
      if (isRunning) {
        handleSteer(text)
      } else {
        handleChat(text)
      }
    }, 0)
  }, [activeProjectId, isRunning, handleSteer, handleChat])

  // Listen for send_chat_message events from json-render OptionCard specs.
  // Note: chat-panel.tsx has an identical listener but they are mutually exclusive
  // by routing — playground and project pages are never mounted simultaneously.
  useEffect(() => {
    const handler = (e: Event) => {
      const message = (e as CustomEvent<{ message: string }>).detail?.message
      if (message) handleSendPrompt(message)
    }
    window.addEventListener('astro:send-chat-message', handler)
    return () => window.removeEventListener('astro:send-chat-message', handler)
  }, [handleSendPrompt])

  // Go back to landing phase — clean slate (no pre-filled prompt)
  const handleBack = useCallback(() => {
    backingRef.current = true
    setActiveProjectId(null)
    setActiveProvider("")
    setProviderExplicitlyChanged(false)
    setDescription("")
    setWorkingDir("")
    setSelectedMachine(null)
    setSelectedProvider("")
    setSelectedModel("")
    setSearchParams({})
    setInput("")
    setFileSidebarOpen(false)
    setEditingPrompt(null)
  }, [setSearchParams])

  // Edit & Retry: enter inline edit mode on the prompt bubble
  const handleRetry = useCallback(() => {
    if (!project) return
    setEditingPrompt(project.description || project.name || "")
  }, [project])

  // Submit edited prompt — starts a new session with the same machine/dir/provider
  const handleEditedSubmit = useCallback(async () => {
    if (!editingPrompt?.trim() || isSubmitting || !execution?.machineId) return
    setIsSubmitting(true)

    try {
      const provider = activeProvider || execution?.providerId || ""
      const effectiveModel = getModelForProvider(provider || undefined)
      const { projectId } = await startPlaygroundSession(
        editingPrompt.trim(),
        {
          targetMachineId: execution.machineId,
          workingDirectory: project?.workingDirectory || workingDir || undefined,
          preferredProvider: provider || undefined,
          model: effectiveModel,
        }
      )

      setEditingPrompt(null)
      setActiveProjectId(projectId)
      setActiveProvider(provider)
      setSearchParams({ projectId })
    } catch (error) {
      console.error("[playground] Failed to start edited session:", error)
    } finally {
      setIsSubmitting(false)
    }
  }, [editingPrompt, isSubmitting, execution?.machineId, execution?.providerId, activeProvider, project?.workingDirectory, workingDir, getModelForProvider, startPlaygroundSession, setSearchParams])

  // View a past session — restore the provider from the execution
  const viewSession = useCallback((projectId: string) => {
    const exec = allExecutions.get(`playground-${projectId}`)
    setActiveProvider(exec?.providerId || "")
    setActiveProjectId(projectId)
    setSearchParams({ projectId })
  }, [allExecutions, setSearchParams])

  // Delete a playground session (project + execution)
  const deleteSession = useCallback((projectId: string) => {
    // If deleting the currently active session, go back to landing
    if (activeProjectId === projectId) {
      setActiveProjectId(null)
      setSearchParams({})
    }
    // Remove the in-memory execution entry
    allExecutions.delete(`playground-${projectId}`)
    // Delete the project (also cleans up plan nodes/edges)
    deleteProject(projectId)
  }, [activeProjectId, allExecutions, deleteProject, setSearchParams])

  // Retry a failed playground session — pre-fill the landing form with the same prompt/machine/dir
  const handleRetrySession = useCallback((projectId: string) => {
    const exec = useExecutionStore.getState().executions.get(`playground-${projectId}`)
    // Guard: don't retry if the session is still active
    if (exec?.status === 'pending' || exec?.status === 'running') return

    const proj = useProjectStore.getState().projects.find((p) => p.id === projectId)
    if (!proj) return

    // Pre-fill the landing form
    setDescription(proj.description || proj.name || "")
    if (proj.workingDirectory) setWorkingDir(proj.workingDirectory)
    if (exec?.machineId) {
      const machine = allMachines.find((m) => m.machineId === exec.machineId)
      if (machine) setSelectedMachine(machine)
    }
    if (exec?.providerId) setSelectedProvider(exec.providerId)

    // Clear active project so we go to landing phase
    setActiveProjectId(null)
    setSearchParams({})
  }, [allMachines, setSearchParams])

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
            status={headerStatus as 'running' | 'waiting' | 'completed' | 'error' | 'stopped'}
            machineName={machineName}
            workingDirectory={project?.workingDirectory || workingDir || undefined}
            fileSidebarOpen={fileSidebarOpen}
            activeProvider={activeProvider}
            availableProviders={activeSessionProviders}
            onProviderChange={handleProviderChange}
            onBack={handleBack}
            onAbort={() => {
              if (isChatStreaming && chatSession) abortChatStream(chatSession.id)
              cancelPlaygroundSession(activeProjectId)
            }}
            onRetry={handleRetry}
            onToggleFileSidebar={() => setFileSidebarOpen(!fileSidebarOpen)}
            onRename={(newTitle) => updateProject(activeProjectId, { name: newTitle })}
            startedAt={execution.startedAt ? new Date(execution.startedAt) : undefined}
            toolCallCount={taskStreamToolCount}
            modelName={taskStreamModel || (providerExplicitlyChanged && activeProvider ? (PROVIDER_NAMES[activeProvider] || activeProvider) : undefined)}
          />

          {/* Activity Timeline — always visible (playground IS the activity view) */}
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-auto py-3 bg-muted/20"
          >
            {execution?.status === "failure" && execution.error && displayBlocks.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-md px-4">
                  <p className="text-sm font-medium text-destructive mb-1">Session failed</p>
                  <p className="text-xs text-muted-foreground mb-3">{execution.error}</p>
                  <Button variant="default" size="sm" onClick={() => handleRetrySession(activeProjectId!)}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    Retry
                  </Button>
                </div>
              </div>
            )}

            {displayBlocks.length === 0 && execution?.status !== "failure" && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-sm text-muted-foreground">
                {isRunning ? (
                  <>
                    <span className="flex items-center gap-2">
                      <TypingIndicator className="text-muted-foreground" />
                      Starting session...
                    </span>
                    {showTimeout && (
                      <div className="text-center max-w-sm px-4">
                        <p className="text-xs text-warning font-medium mb-1">Taking longer than expected</p>
                        <p className="text-[11px] text-muted-foreground">
                          The agent may be busy or unreachable. Check if the machine is connected in Environments, or try a different machine.
                        </p>
                      </div>
                    )}
                  </>
                ) : isRestoring ? (
                  <span className="flex items-center gap-2">
                    <TypingIndicator className="text-muted-foreground" />
                    Loading activity...
                  </span>
                ) : "No activity yet"}
              </div>
            )}

            {/* Original prompt bubble — inline editable */}
            {(project?.description || project?.name) && (
              <div className="flex flex-col items-end gap-1 px-4 py-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">You</span>
                {editingPrompt !== null ? (
                  <div className="w-full max-w-[80%] flex flex-col gap-2">
                    <textarea
                      autoFocus
                      value={editingPrompt}
                      onChange={(e) => setEditingPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          handleEditedSubmit()
                        }
                        if (e.key === "Escape") setEditingPrompt(null)
                      }}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring min-h-[60px]"
                      rows={Math.min(8, (editingPrompt.match(/\n/g) || []).length + 2)}
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingPrompt(null)}
                        className="h-7 text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleEditedSubmit}
                        disabled={!editingPrompt.trim() || isSubmitting}
                        className="h-7 text-xs gap-1"
                      >
                        {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                        Run
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="group/prompt relative rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground max-w-[80%]">
                    <p className="whitespace-pre-wrap">{project.description || project.name}</p>
                    {!isRunning && (
                      <button
                        onClick={handleRetry}
                        className="absolute -left-8 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover/prompt:opacity-60 hover:!opacity-100 transition-opacity text-muted-foreground hover:text-foreground cursor-pointer"
                        title="Edit & retry"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <ActivityBlockRenderer
              blocks={displayBlocks}
              isStreaming={isRunning || isChatStreaming}
              isRunning={isRunning || isChatStreaming}
              onSendPrompt={handleSendPrompt}
              onFileSelect={(path) => {
                const baseDir = project?.workingDirectory || workingDir
                if (baseDir) setInitialFilePath(resolveFilePathForBrowsing(path, baseDir))
                setFileSidebarOpen(true)
              }}
              onLinkClick={(href) => {
                // Intercept file-path links so they don't navigate away
                if (href.startsWith('astro:')) return false
                if (href.startsWith('http://') || href.startsWith('https://')) return false
                // Relative file path — open the file sidebar and navigate to the file
                const baseDir = project?.workingDirectory || workingDir
                if (execution?.machineId && baseDir) {
                  setInitialFilePath(resolveFilePathForBrowsing(href, baseDir))
                  setFileSidebarOpen(true)
                }
                // Always prevent default to avoid broken relative URL navigation
                return true
              }}
              onEditMessage={!isRunning && !isChatStreaming ? (msg) => { setInput(msg); inputRef.current?.focus() } : undefined}
              onApprovalResponse={handleApprovalResponse}
              answeredApprovals={answeredRequestIds}
              approvalResponses={approvalResponseMap}
            />

            {/* Pending steer bubble removed: addSteerMessage now adds pending
                events directly to activityEvents, rendered inline above */}

            {/* Queued message indicator removed: pending steers now appear
                inline in the activity feed with clock indicators */}

            {/* Chat streaming indicator */}
            {isChatStreaming && (
              <div className="flex items-center gap-2 px-4 py-2">
                <TypingIndicator className="text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Scroll to bottom button */}
          {!autoScroll && (
            <Button
              variant="secondary"
              size="sm"
              className="absolute bottom-16 right-4 h-8 gap-1.5 shadow-md z-10"
              onClick={scrollToBottom}
            >
              <ArrowDown className="h-3.5 w-3.5" />
              Bottom
            </Button>
          )}

          {/* Input Bar — always visible for running sessions and resuming stopped ones */}
          <div className="border-t border-border/60 bg-background shrink-0">
            <div className="flex items-end gap-2 p-3">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  // Auto-resize: reset to 1 row then expand to scrollHeight
                  e.target.style.height = 'auto'
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder={isRunning ? t('sendMessage', { defaultValue: 'Send a message...' }) : t('askSession', { defaultValue: 'Ask about this session...' })}
                rows={1}
                className="flex-1 rounded-lg border border-border/20 bg-muted/30 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring/50 focus:bg-muted/40 transition-colors resize-none"
              />
              {(isRunning || isChatStreaming) && (
                <Button
                  size="icon"
                  variant="destructive"
                  className="h-9 w-9 shrink-0"
                  onClick={() => {
                    if (isChatStreaming && chatSession) abortChatStream(chatSession.id)
                    if (isRunning) cancelPlaygroundSession(activeProjectId!)
                  }}
                  title={isRunning ? "Stop session" : "Stop response"}
                >
                  <Square className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={handleSend}
                disabled={!input.trim() || sending}
                title="Send (⌘+Enter)"
              >
                {sending ? (
                  <TypingIndicator className="text-current scale-75" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* File Sidebar — Sheet on mobile, inline on desktop */}
        {isMobile ? (
          <Sheet open={fileSidebarOpen} onOpenChange={(open) => { setFileSidebarOpen(open); if (!open) setInitialFilePath(null) }}>
            <SheetContent side="bottom" className="h-[70vh] w-full p-0">
              <SheetHeader className="px-4 pt-4 pb-2">
                <SheetTitle>Files</SheetTitle>
              </SheetHeader>
              {execution?.machineId && (project?.workingDirectory || workingDir) && (
                <FileBrowser
                  machineId={execution.machineId}
                  machineName={machineName}
                  workingDirectory={project?.workingDirectory || workingDir}
                  onClose={() => { setFileSidebarOpen(false); setInitialFilePath(null) }}
                  initialFilePath={initialFilePath}
                  embedded
                />
              )}
            </SheetContent>
          </Sheet>
        ) : (
          fileSidebarOpen && execution?.machineId && (project?.workingDirectory || workingDir) && (
            <FileBrowser
              machineId={execution.machineId}
              machineName={machineName}
              workingDirectory={project?.workingDirectory || workingDir}
              onClose={() => { setFileSidebarOpen(false); setInitialFilePath(null) }}
              initialFilePath={initialFilePath}
            />
          )
        )}
      </div>
    )
  }

  // ─── Landing Phase ───────────────────────────────────────────────
  return (
    <div className="flex h-full">
    <div className="flex flex-col items-center justify-start min-h-full p-4 md:p-6 overflow-auto flex-1">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8 mt-4 md:mt-8">
          <h1 className="text-xl md:text-2xl font-bold font-sans mb-2">{t('playground')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('playgroundDesc', { defaultValue: 'An agent (e.g., Claude Code or Codex) session on any of your machines.' })}
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {/* Goal textarea + session resume */}
          <div className="flex flex-col rounded-xl border border-border/20 bg-muted/30 overflow-hidden shadow-[0_1px_6px_-2px_rgba(0,0,0,0.06)] focus-within:ring-1 focus-within:ring-ring/50 focus-within:bg-muted/40 transition-all duration-200">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder={t('playgroundGoalPlaceholder', { defaultValue: 'What would you like to work on?' })}
              rows={5}
              autoFocus
              className="w-full px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none resize-none bg-transparent"
            />
            <div className="flex justify-end px-4 pb-1">
              <span className="text-[10px] text-muted-foreground/40">{t('cmdEnterStart', { defaultValue: '⌘+Enter to start' })}</span>
            </div>

            {/* OR divider + resume button */}
            {(allMachines.length > 0 || playgroundHistory.length > 0) && (
              <div className="px-4 pb-3">
                <div className="flex items-center gap-3 mb-2.5">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">or</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <button
                  type="button"
                  onClick={() => setSessionPickerOpen(true)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <Terminal className="h-3.5 w-3.5" />
                  {t('resumeSession', { defaultValue: 'Resume a previous session' })}
                </button>
              </div>
            )}
          </div>

          {/* Machine + Working directory selector */}
          {(isServerMode() || allMachines.length > 0) && (
            <MachineWorkdirSelector
              machines={allMachines}
              selectedMachine={selectedMachine}
              onMachineChange={setSelectedMachine}
              workingDir={workingDir}
              onWorkingDirChange={setWorkingDir}
              onBrowse={() => setShowPathBrowser(true)}
              dirRequired
              renderMachineExtra={(m) => {
                const reg = registeredMachines.find((r) => r.id === m.machineId)
                return (
                  <div className="relative">
                    <InstructionPicker
                      currentInstructionId={reg?.defaultInstructionId}
                      onSelect={(id) => miAssign(m.machineId, id)}
                    />
                  </div>
                )
              }}
            />
          )}

          {/* Submit row */}
          <div className="flex items-center justify-end gap-2">
            {availableProviders.length > 1 && (
              <ProviderDropdown
                providers={availableProviders}
                selectedProvider={selectedProvider}
                onSelect={(id) => { setSelectedProvider(id); setSelectedModel("") }}
                compact
              />
            )}
            <button
              type="button"
              onClick={() => useSettingsStore.getState().setPlaygroundYoloMode(!playgroundYolo)}
              className={cn(
                "flex items-center gap-1.5 h-7 px-2 rounded-md border text-[11px] transition-colors cursor-pointer",
                playgroundYolo
                  ? "border-warning/50 bg-warning/10 text-warning"
                  : "border-border hover:bg-muted text-muted-foreground"
              )}
              title={playgroundYolo ? "YOLO ON — auto-approve all agent decisions" : "YOLO OFF — agent will ask before acting"}
            >
              <Zap className={cn("h-3.5 w-3.5", playgroundYolo && "fill-warning")} />
              YOLO
            </button>
            <Button
              onClick={handleSubmit}
              disabled={!description.trim() || !selectedMachine || isSubmitting}
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
                const isFailed = exec?.status === 'failure'
                const timestamp = p.updatedAt || p.createdAt
                const statusLabel = exec?.status === 'running' ? 'Running'
                  : exec?.status === 'pending' ? 'Pending'
                  : exec?.status === 'success' ? 'Completed'
                  : isFailed ? 'Failed'
                  : exec?.status === 'cancelled' ? 'Stopped'
                  : ''
                const statusColor = exec?.status === 'running' ? 'bg-primary'
                  : exec?.status === 'pending' ? 'bg-muted-foreground'
                  : exec?.status === 'success' ? 'bg-success'
                  : isFailed || exec?.status === 'cancelled' ? 'bg-destructive'
                  : 'bg-muted-foreground'

                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => renamingSessionId !== p.id && viewSession(p.id)}
                    onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && renamingSessionId !== p.id) viewSession(p.id) }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-all duration-200 text-left group cursor-pointer"
                  >
                    <span className={cn("h-2 w-2 rounded-full shrink-0", statusColor)} />
                    <div className="flex-1 min-w-0">
                      {renamingSessionId === p.id ? (
                        <InlineRenameInput
                          value={p.name}
                          onSave={(newName) => {
                            updateProject(p.id, { name: newName })
                            setRenamingSessionId(null)
                          }}
                          onCancel={() => setRenamingSessionId(null)}
                          validate={(v) => v.trim().length === 0 ? "Name cannot be empty" : null}
                          className="text-sm"
                        />
                      ) : (
                        <div className="group/name flex items-center gap-1">
                          <p
                            className={cn("text-sm truncate", isFailed && "text-muted-foreground")}
                            onDoubleClick={(e) => {
                              e.stopPropagation()
                              setRenamingSessionId(p.id)
                            }}
                          >
                            {p.name}
                          </p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setRenamingSessionId(p.id)
                            }}
                            className="p-0.5 rounded opacity-0 group-hover/name:opacity-60 hover:!opacity-100 transition-opacity shrink-0"
                            title="Rename session"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <p className="text-[10px] text-muted-foreground truncate font-mono">
                          {p.workingDirectory || "—"}
                        </p>
                        {exec?.providerId && (
                          <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">
                            {PROVIDER_NAMES[exec.providerId] || exec.providerName || exec.providerId}
                          </Badge>
                        )}
                        {timestamp && (
                          <span className="text-[10px] text-muted-foreground/60 shrink-0">
                            {new Date(timestamp).toLocaleString(undefined, {
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {statusLabel && (
                        <Badge
                          variant={isFailed ? "destructive" : "outline"}
                          className="text-[10px] hidden md:inline-flex"
                        >
                          {statusLabel}
                        </Badge>
                      )}
                      {isFailed && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px] gap-1 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity hidden md:inline-flex"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRetrySession(p.id)
                          }}
                        >
                          <RefreshCw className="h-3 w-3" />
                          Retry
                        </Button>
                      )}
                      {exec?.status === 'success' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px] gap-1 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity hidden md:inline-flex"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate('/plan', { state: { fromPlaygroundId: p.id } })
                          }}
                        >
                          <Sparkles className="h-3 w-3" />
                          Plan
                        </Button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteSession(p.id)
                        }}
                        className="p-0.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 [@media(hover:none)]:opacity-60 hover:bg-destructive/10 transition-all text-destructive"
                        title="Delete session"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
              {allPlaygroundHistory.length > historyDisplayLimit && (
                <button
                  onClick={() => setHistoryDisplayLimit((prev) => prev + 20)}
                  className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Show more ({allPlaygroundHistory.length - historyDisplayLimit} remaining)
                </button>
              )}
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

    {/* Session picker dialog */}
    <SessionPickerDialog
      open={sessionPickerOpen}
      onOpenChange={setSessionPickerOpen}
      onSelectSession={handleForkSession}
      playgroundSessions={playgroundHistory}
      onSelectPlaygroundSession={viewSession}
    />
    </div>
  )
}

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
  Loader2,
  Send,
  Square,
  ArrowDown,
  Pencil,
  Zap,
  RefreshCw,
} from "lucide-react"
import { TypingIndicator } from "@/components/ui/typing-indicator"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useExecutionStore, getNodeIdForProject, type MachineInfo } from "@/stores/execution-store"
import { useToastStore } from "@/stores/toast-store"
import { useProjectStore } from "@/stores/project-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useSettingsStore, resolveModel } from "@/stores/settings-store"
import { PlaygroundHeader } from "@/components/playground/playground-header"
import { FileBrowser } from "@/components/file-browser"
import { resolveFilePathForBrowsing } from "@/components/task-detail/file-path-utils"
import { ActivityBlockRenderer } from "@/components/activity-block-renderer"
import { useClaudeSessionsStore } from "@/stores/claude-sessions-store"
import { useSessionStore } from "@/stores/session-store"
import { requestNotificationPermission } from "@/lib/notifications"
import { deriveAvailableProviders, PROVIDER_NAMES } from "@/components/execution/provider-utils"
import { useMachineInstructionStore } from "@/stores/machine-instruction-store"
import type { TaskActivityEvent } from "@/types"
import { useAutoScroll } from "@/hooks/use-auto-scroll"
import { useChatSession } from "@/hooks/use-chat-session"
import { useActivityFeed } from "@/hooks/use-activity-feed"

export function Playground() {
  const { t } = useTranslation('nav')
  const isMobile = useMediaQuery("(max-width: 767px)")
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const projectIdParam = searchParams.get("projectId")

  // Activity phase state
  const [activeProjectId, setActiveProjectId] = useState<string | null>(projectIdParam)
  const [fileSidebarOpen, setFileSidebarOpen] = useState(false)
  const [initialFilePath, setInitialFilePath] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null)
  // Track provider during activity phase (for mid-session switching and follow-up chat)
  const [activeProvider, setActiveProvider] = useState("")
  // Track whether user explicitly switched providers (for model name display)
  const [providerExplicitlyChanged, setProviderExplicitlyChanged] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Stores
  const startSession = useExecutionStore((s) => s.startSession)
  const cancelSession = useExecutionStore((s) => s.cancelSession)
  const steerSession = useExecutionStore((s) => s.steerSession)
  const execution = useExecutionStore((s) => {
    if (!activeProjectId) return undefined
    // Try session- first, then playground- for backward compat
    return s.executions.get(`session-${activeProjectId}`) || s.executions.get(`playground-${activeProjectId}`)
  })
  const project = useProjectStore((s) =>
    activeProjectId ? s.projects.find((p) => p.id === activeProjectId) : undefined
  )
  const updateProject = useProjectStore((s) => s.updateProject)

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

  // Settings — use configured model tier when user hasn't explicitly picked one
  const getModelForProvider = useSettingsStore((s) => s.getModelForProvider)
  const modelTier = useSettingsStore((s) => s.modelTier)
  const customModelMap = useSettingsStore((s) => s.customModelMap)
  const effectivePlaygroundModel = resolveModel(modelTier, activeProvider || undefined, customModelMap)

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

  // Machine instructions
  const miLoaded = useMachineInstructionStore((s) => s.loaded)
  const miLoad = useMachineInstructionStore((s) => s.load)

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

  // Sync URL → state: if URL gains a projectId we don't have, adopt it.
  // But ignore when URL still has the stale param during handleBack (activeProjectId was just cleared).
  const backingRef = useRef(false)
  const urlExecProviderId = useExecutionStore((s) => {
    if (!projectIdParam) return undefined
    const nodeId = getNodeIdForProject(projectIdParam, s.executions)
    return nodeId ? s.executions.get(nodeId)?.providerId : undefined
  })
  useEffect(() => {
    if (backingRef.current) {
      backingRef.current = false
      return
    }
    if (projectIdParam && projectIdParam !== activeProjectId) {
      setActiveProvider(urlExecProviderId || "")
      setProviderExplicitlyChanged(false)
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

  // Providers for the active session (derived from the execution's machine)
  const activeSessionProviders = useMemo(() => {
    if (!execution?.machineId) return globalProviders
    const machine = allMachines.find((m) => m.machineId === execution.machineId)
    return deriveAvailableProviders(machine?.providers, globalProviders)
  }, [execution?.machineId, allMachines, globalProviders])

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
  const playgroundNodeId = useExecutionStore((s) => {
    if (!activeProjectId) return ''
    return getNodeIdForProject(activeProjectId, s.executions) || `session-${activeProjectId}`
  })
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


  // Provider change handler — notify user when switching during a running session
  const handleProviderChange = useCallback((providerId: string) => {
    if (providerId === activeProvider) return // no-op — same provider selected
    setActiveProvider(providerId)
    setProviderExplicitlyChanged(true)
    // Read live execution status to avoid stale closure over isRunning
    const exec = activeProjectId
      ? (() => {
          const execs = useExecutionStore.getState().executions
          const nid = getNodeIdForProject(activeProjectId, execs)
          return nid ? execs.get(nid) : undefined
        })()
      : undefined
    const currentlyRunning = exec?.status === 'pending' || exec?.status === 'running'
    if (currentlyRunning) {
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
  }, [activeProvider, activeProjectId])

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
      const result = await steerSession(activeProjectId, text)
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
      // Unexpected error — steer returns structured results and
      // should not throw, but guard here for safety.
    } finally {
      setSending(false)
    }
  }, [sending, activeProjectId, execution?.executionId, addSteerMessage, steerSession])

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
      model: effectivePlaygroundModel,
      providerId: activeProvider || undefined,
      messages: historyMessages,
    })
  }, [chatSession, activeProjectId, playgroundNodeId, project, activeProvider, activityEvents, addMessage, sendPlaygroundChat, effectivePlaygroundModel])

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

  // Go back to inbox
  const handleBack = useCallback(() => {
    backingRef.current = true
    setActiveProjectId(null)
    setActiveProvider("")
    setProviderExplicitlyChanged(false)
    setSearchParams({})
    setInput("")
    setFileSidebarOpen(false)
    setEditingPrompt(null)
    navigate("/dashboard")
  }, [setSearchParams, navigate])

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
      const { projectId } = await startSession(
        editingPrompt.trim(),
        editingPrompt.trim().split('\n')[0].slice(0, 60) || "New Session",
        {
          targetMachineId: execution.machineId,
          workingDirectory: project?.workingDirectory || undefined,
          preferredProvider: provider || undefined,
          model: effectiveModel,
        }
      )

      setEditingPrompt(null)
      setActiveProjectId(projectId)
      setActiveProvider(provider)
      setProviderExplicitlyChanged(false)
      setSearchParams({ projectId })
    } catch (error) {
      console.error("[playground] Failed to start edited session:", error)
    } finally {
      setIsSubmitting(false)
    }
  }, [editingPrompt, isSubmitting, execution?.machineId, execution?.providerId, activeProvider, project?.workingDirectory, getModelForProvider, startSession, setSearchParams])

  // Retry a failed playground session — navigate back to inbox
  const handleRetrySession = useCallback(() => {
    navigate("/dashboard")
  }, [navigate])

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
            workingDirectory={project?.workingDirectory || undefined}
            fileSidebarOpen={fileSidebarOpen}
            activeProvider={activeProvider}
            availableProviders={activeSessionProviders}
            onProviderChange={handleProviderChange}
            onBack={handleBack}
            onAbort={() => {
              if (isChatStreaming && chatSession) abortChatStream(chatSession.id)
              cancelSession(activeProjectId)
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
                  <Button variant="default" size="sm" onClick={handleRetrySession}>
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
                const baseDir = project?.workingDirectory
                if (baseDir) setInitialFilePath(resolveFilePathForBrowsing(path, baseDir))
                setFileSidebarOpen(true)
              }}
              onLinkClick={(href) => {
                // Intercept file-path links so they don't navigate away
                if (href.startsWith('astro:')) return false
                if (href.startsWith('http://') || href.startsWith('https://')) return false
                // Relative file path — open the file sidebar and navigate to the file
                const baseDir = project?.workingDirectory
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
                    if (isRunning) cancelSession(activeProjectId!)
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
              {execution?.machineId && (project?.workingDirectory) && (
                <FileBrowser
                  machineId={execution.machineId}
                  machineName={machineName}
                  workingDirectory={project?.workingDirectory}
                  onClose={() => { setFileSidebarOpen(false); setInitialFilePath(null) }}
                  initialFilePath={initialFilePath}
                  embedded
                />
              )}
            </SheetContent>
          </Sheet>
        ) : (
          fileSidebarOpen && execution?.machineId && (project?.workingDirectory) && (
            <FileBrowser
              machineId={execution.machineId}
              machineName={machineName}
              workingDirectory={project?.workingDirectory}
              onClose={() => { setFileSidebarOpen(false); setInitialFilePath(null) }}
              initialFilePath={initialFilePath}
            />
          )
        )}
      </div>
    )
  }

  // ─── No active session — redirect to inbox ───────────────────────
  // Landing form now lives on the inbox page. Redirect if accessed directly.
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <p className="text-sm text-muted-foreground">Start a session from the inbox.</p>
      <Button variant="outline" size="sm" onClick={() => navigate("/dashboard")}>
        Go to Inbox
      </Button>
    </div>
  )
}

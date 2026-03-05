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
  Sparkles,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useExecutionStore, type MachineInfo } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useSettingsStore } from "@/stores/settings-store"
import { RemotePathBrowser } from "@/components/remote-path-browser"
import { PlaygroundHeader } from "@/components/playground/playground-header"
import { FileBrowser } from "@/components/file-browser"
import { InlineApprovalCard } from "@/components/plan-session/inline-approval-card"
import {
  groupActivityEvents,
  TextBlock,
  ToolBlock,
  ToolGroupBlock,
  SteerBlock,
  FileChangeBlock,
  ErrorBlock,
  ChatUserBlock,
  ChatAssistantBlock,
  type DisplayBlock,
} from "@/components/activity-blocks"
import { SessionPickerDialog } from "@/components/playground/session-picker-dialog"
import { useClaudeSessionsStore, type ClaudeCodeSession } from "@/stores/claude-sessions-store"
import { useSessionStore } from "@/stores/session-store"
import { chatWithTask } from "@/lib/api-client"
import { requestNotificationPermission } from "@/lib/notifications"
import { isServerMode } from "@/lib/app-mode"
import { cn } from "@/lib/utils"
import { deriveAvailableProviders, PROVIDER_NAMES } from "@/components/execution/provider-utils"
import type { TaskActivityEvent } from "@/types"
import { useRestoredExecution } from "@/hooks/use-restored-execution"
import { useChatStreamEvents } from "@/hooks/use-chat-stream-events"
import { useChatActivityEvents } from "@/hooks/use-chat-activity-events"

// Identify playground projects by the projectType field (persisted) or execution key (in-memory fallback)
function isPlaygroundProject(project: { projectType?: string; id: string }, executions: Map<string, unknown>): boolean {
  return project.projectType === 'playground' || executions.has(`playground-${project.id}`)
}

export function Playground() {
  const isMobile = useMediaQuery("(max-width: 767px)")
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
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false)

  // Activity phase state
  const [activeProjectId, setActiveProjectId] = useState<string | null>(projectIdParam)
  const [fileSidebarOpen, setFileSidebarOpen] = useState(false)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [pendingSteerText, setPendingSteerText] = useState<string | null>(null)
  const [isChatStreaming, setIsChatStreaming] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

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

  // Settings — use configured model tier when user hasn't explicitly picked one
  const getModelForProvider = useSettingsStore((s) => s.getModelForProvider)

  // Realtime state for activity events
  const executionId = execution?.executionId || ""
  const taskStream = useRealtimeStore(useCallback((s) => s.taskStreams.get(executionId), [executionId]))
  const dynamicApprovalsMap = useRealtimeStore((s) => s.dynamicApprovals)
  const respondToDynamicApproval = useRealtimeStore((s) => s.respondToDynamicApproval)
  const addSteerMessage = useRealtimeStore((s) => s.addSteerMessage)

  // Sessions store (Claude Code sessions picker)
  const loadSessions = useClaudeSessionsStore((s) => s.loadSessions)

  // Session store for post-completion chat
  const sessionsLoaded = useSessionStore((s) => s.loaded)
  const createSessionAction = useSessionStore((s) => s.createSession)
  const addMessage = useSessionStore((s) => s.addMessage)
  const setProviderSessionId = useSessionStore((s) => s.setProviderSessionId)
  const settingsModel = useSettingsStore((s) => s.model)

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
  useEffect(() => {
    if (backingRef.current) {
      backingRef.current = false
      return
    }
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

  // Get or create a chat session for this playground
  const playgroundNodeId = activeProjectId ? `playground-${activeProjectId}` : ''
  const allSessions = useSessionStore((s) => s.sessions)
  const chatSession = useMemo(() => {
    if (!playgroundNodeId) return undefined
    let latest: ReturnType<typeof allSessions.get> | undefined
    for (const session of allSessions.values()) {
      if (session.nodeId === playgroundNodeId && session.type === "task-chat") {
        if (!latest || session.createdAt > latest.createdAt) latest = session
      }
    }
    return latest
  }, [allSessions, playgroundNodeId])
  useEffect(() => {
    if (sessionsLoaded && activeProjectId && !chatSession) {
      createSessionAction({ type: "task-chat", projectId: activeProjectId, nodeId: playgroundNodeId })
    }
  }, [sessionsLoaded, chatSession, createSessionAction, activeProjectId, playgroundNodeId])

  // Get activity events — live during execution, restored from observations after refresh
  const { activityEvents, isRestoring } = useRestoredExecution(
    executionId,
    execution,
    taskStream,
    isRunning,
  )

  // Chat stream events (proper text/tool_use/tool_result tracking for live streaming)
  const {
    chatEventsRef,
    chatEventsVersion,
    pushChatEvent,
    flushChatEvents,
    chatToolCounterRef,
  } = useChatStreamEvents()

  // Hydrate chat events from streaming_events DB after page refresh
  const playgroundSessionMessages = useMemo(() => chatSession?.messages || [], [chatSession?.messages])
  const { activityEvents: hydratedChatEvents } = useChatActivityEvents(
    chatSession?.id,
    playgroundSessionMessages,
    isChatStreaming,
  )

  // Merge: during live streaming use chatEventsRef; after refresh use hydrated events
  const allActivityEvents: TaskActivityEvent[] = useMemo(() => {
    void chatEventsVersion
    const chatEvents = chatEventsRef.current.length > 0 ? chatEventsRef.current : hydratedChatEvents
    return [...activityEvents, ...chatEvents]
  // eslint-disable-next-line react-hooks/exhaustive-deps -- chatEventsRef is a stable ref
  }, [activityEvents, chatEventsVersion, hydratedChatEvents])

  const displayBlocks = useMemo(() => groupActivityEvents(allActivityEvents), [allActivityEvents])

  const pendingApprovals = useMemo(() => {
    if (!execution?.executionId) return []
    return Array.from(dynamicApprovalsMap.values()).filter(
      (a) => a.taskId === execution.executionId
    )
  }, [dynamicApprovalsMap, execution?.executionId])

  const answeredRequestIds = useMemo(() => {
    const ids = new Set<string>()
    for (const event of allActivityEvents) {
      if (event.type === 'approval_response') {
        ids.add(event.requestId)
      }
    }
    return ids
  }, [allActivityEvents])

  const headerStatus = execution?.status === "cancelled"
    ? 'stopped'
    : execution?.status === "success" || execution?.status === "failure"
      ? (execution.error ? 'error' : 'completed')
      : pendingApprovals.length > 0
        ? 'waiting'
        : 'running'

  // Auto-scroll
  const eventsLength = allActivityEvents.length
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
          workingDirectory: session.cwd || "~",
          resumeSessionId: session.sessionId,
          forkSession: true,
        }
      )

      setActiveProjectId(projectId)
      setSearchParams({ projectId })
    } catch (error) {
      console.error("[playground] Failed to fork session:", error)
    } finally {
      setIsSubmitting(false)
    }
  }, [isSubmitting, allMachines, startPlaygroundSession, setSearchParams])

  // Steer message handler (while running)
  const handleSteer = useCallback(async (text: string) => {
    if (!text || sending || !activeProjectId) return
    setSending(true)
    setPendingSteerText(text)

    if (execution?.executionId) {
      addSteerMessage(execution.executionId, text)
    }

    try {
      const ok = await steerPlaygroundSession(activeProjectId, text)
      if (!ok) {
        // steer failed, but we already cleared input — leave pending indicator
      }
    } catch {
      // steer failed
    } finally {
      setSending(false)
      setPendingSteerText(null)
    }
  }, [sending, activeProjectId, execution?.executionId, addSteerMessage, steerPlaygroundSession])

  // Chat message handler (post-completion)
  const handleChat = useCallback(async (text: string) => {
    if (!text || isChatStreaming || !chatSession || !activeProjectId) return

    const sid = chatSession.id

    // Add user event for display
    pushChatEvent({ type: 'chat_user', message: text, timestamp: new Date() })

    // Store in session for conversation history (sent to backend on subsequent turns)
    addMessage(sid, { role: "user", content: text })

    setIsChatStreaming(true)
    abortRef.current = new AbortController()

    const historyMessages = (chatSession.messages || [])
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content.length > 0))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

    const sessionTitle = project?.name || "Playground Session"
    let rawText = ""
    try {
      await chatWithTask(
        {
          message: text,
          sessionId: chatSession.providerSessionId,
          streamId: sid,
          nodeId: playgroundNodeId,
          projectId: activeProjectId,
          taskTitle: sessionTitle,
          taskDescription: `Playground coding session: ${sessionTitle}`,
          taskOutput: activityEvents
            .filter((e): e is Extract<TaskActivityEvent, { type: 'text' }> => e.type === 'text')
            .map((e) => e.content)
            .join(''),
          visionDoc: project?.visionDoc,
          model: settingsModel,
          messages: historyMessages,
        },
        {
          onText: (chunk) => {
            rawText += chunk
            pushChatEvent({ type: 'text', content: chunk, timestamp: new Date() })
          },
          onToolUse: (data) => {
            const id = `chat-tool-${++chatToolCounterRef.current}`
            pushChatEvent({
              type: 'tool_use',
              id,
              toolName: data.toolName,
              toolInput: data.toolInput,
              timestamp: new Date(),
            })
          },
          onToolResult: (data) => {
            const events = chatEventsRef.current
            let matchId = `chat-tool-result-${++chatToolCounterRef.current}`
            for (let i = events.length - 1; i >= 0; i--) {
              const e = events[i]
              if (e.type === 'tool_use' && e.toolName === data.toolName) {
                const hasResult = events.some(r => r.type === 'tool_result' && r.id === e.id)
                if (!hasResult) {
                  matchId = e.id
                  break
                }
              }
            }
            pushChatEvent({
              type: 'tool_result',
              id: matchId,
              toolName: data.toolName,
              toolResult: data.result,
              success: data.success,
              timestamp: new Date(),
            })
          },
          onDone: (newSessionId) => {
            if (newSessionId) setProviderSessionId(sid, newSessionId)
            addMessage(sid, { role: "assistant", content: rawText })
            flushChatEvents()
            setIsChatStreaming(false)
          },
          onError: (error) => {
            pushChatEvent({ type: 'error', error, timestamp: new Date() })
            flushChatEvents()
            setIsChatStreaming(false)
          },
        },
        abortRef.current.signal,
      )
    } catch {
      flushChatEvents()
      setIsChatStreaming(false)
    }
  }, [isChatStreaming, chatSession, activeProjectId, playgroundNodeId, project, settingsModel, activityEvents, addMessage, pushChatEvent, flushChatEvents, chatEventsRef, chatToolCounterRef, setProviderSessionId])

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
        return <ToolBlock key={index} events={block.events} isRunning={isRunning || isChatStreaming} />
      case 'tool_group':
        return <ToolGroupBlock key={index} events={block.events} isRunning={isRunning || isChatStreaming} />
      case 'steer':
        return <SteerBlock key={index} event={block.events[0] as Extract<TaskActivityEvent, { type: 'steer' }>} />
      case 'file_change':
        return <FileChangeBlock key={index} event={block.events[0] as Extract<TaskActivityEvent, { type: 'file_change' }>} onFileSelect={() => setFileSidebarOpen(true)} />
      case 'error':
        return <ErrorBlock key={index} event={block.events[0] as Extract<TaskActivityEvent, { type: 'error' }>} />
      case 'chat_user':
        return <ChatUserBlock key={index} event={block.events[0] as Extract<TaskActivityEvent, { type: 'chat_user' }>} />
      case 'chat_assistant':
        return <ChatAssistantBlock key={index} event={block.events[0] as Extract<TaskActivityEvent, { type: 'chat_assistant' }>} />
      case 'approval_request': {
        const event = block.events[0] as Extract<TaskActivityEvent, { type: 'approval_request' }>
        const isAnswered = answeredRequestIds.has(event.requestId)
        const responseEvent = allActivityEvents.find(
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
            autoApproved={responseEvent?.autoApproved}
            onRespond={handleApprovalResponse}
          />
        )
      }
      case 'approval_response':
        return null
      default:
        return null
    }
  }, [displayBlocks.length, isRunning, isChatStreaming, answeredRequestIds, allActivityEvents, handleApprovalResponse])

  // Go back to landing phase
  const handleBack = useCallback(() => {
    backingRef.current = true
    setActiveProjectId(null)
    setSearchParams({})
    setInput("")
    setFileSidebarOpen(false)
  }, [setSearchParams])


  // View a past session
  const viewSession = useCallback((projectId: string) => {
    setActiveProjectId(projectId)
    setSearchParams({ projectId })
  }, [setSearchParams])

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
            onBack={handleBack}
            onAbort={() => cancelPlaygroundSession(activeProjectId)}
            onToggleFileSidebar={() => setFileSidebarOpen(!fileSidebarOpen)}

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
                  <p className="text-xs text-muted-foreground">{execution.error}</p>
                </div>
              </div>
            )}

            {displayBlocks.length === 0 && execution?.status !== "failure" && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-sm text-muted-foreground">
                {isRunning ? (
                  <>
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
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
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading activity...
                  </span>
                ) : "No activity yet"}
              </div>
            )}

            {displayBlocks.map((block, i) => renderBlock(block, i))}

            {/* Pending steer bubble */}
            {pendingSteerText && (
              <div className="flex flex-col items-end gap-1 px-4 py-1.5">
                <div className="rounded-lg px-3 py-2 text-sm max-w-[80%] bg-primary/50 text-primary-foreground">
                  <p className="whitespace-pre-wrap">{pendingSteerText}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">Sending...</span>
                </div>
              </div>
            )}

            {/* Chat streaming indicator */}
            {isChatStreaming && (
              <div className="flex items-center gap-2 px-4 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Thinking...</span>
              </div>
            )}
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

          {/* Input Bar — always visible for running sessions and resuming stopped ones */}
          <div className="border-t border-border bg-background shrink-0">
            <div className="flex items-end gap-2 p-3">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder={isRunning ? "Send a message..." : "Ask about this session..."}
                rows={1}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={handleSend}
                disabled={!input.trim() || sending || isChatStreaming}
              >
                {sending || isChatStreaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* File Sidebar — Sheet on mobile, inline on desktop */}
        {isMobile ? (
          <Sheet open={fileSidebarOpen} onOpenChange={setFileSidebarOpen}>
            <SheetContent side="bottom" className="h-[70vh] w-full p-0">
              <SheetHeader className="px-4 pt-4 pb-2">
                <SheetTitle>Files</SheetTitle>
              </SheetHeader>
              {execution?.machineId && (project?.workingDirectory || workingDir) && (
                <FileBrowser
                  machineId={execution.machineId}
                  machineName={machineName}
                  workingDirectory={project?.workingDirectory || workingDir}
                  onClose={() => setFileSidebarOpen(false)}
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
              onClose={() => setFileSidebarOpen(false)}
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
          <h1 className="text-xl md:text-2xl font-bold font-sans mb-2">Playground</h1>
          <p className="text-sm text-muted-foreground">
            A regular Claude Code session in any of your machines.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {/* Goal textarea + session resume */}
          <div className="flex flex-col rounded-lg border border-border bg-background overflow-hidden focus-within:ring-2 focus-within:ring-ring">
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
              rows={5}
              autoFocus
              className="w-full px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none resize-none bg-transparent"
            />

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
                  Resume a previous session
                </button>
              </div>
            )}
          </div>

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
            <div className="animate-reveal flex flex-col gap-1.5">
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
            <p className="text-[10px] text-muted-foreground hidden md:block">
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
                  : exec?.status === 'pending' ? 'Pending'
                  : exec?.status === 'success' ? 'Completed'
                  : exec?.status === 'failure' ? 'Failed'
                  : exec?.status === 'cancelled' ? 'Stopped'
                  : ''
                const statusColor = exec?.status === 'running' ? 'bg-primary'
                  : exec?.status === 'pending' ? 'bg-muted-foreground'
                  : exec?.status === 'success' ? 'bg-success'
                  : exec?.status === 'failure' || exec?.status === 'cancelled' ? 'bg-destructive'
                  : 'bg-muted-foreground'

                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => viewSession(p.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') viewSession(p.id) }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left group cursor-pointer"
                  >
                    <span className={cn("h-2 w-2 rounded-full shrink-0", statusColor)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate font-mono">
                        {p.workingDirectory || "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {statusLabel && (
                        <Badge variant="outline" className="text-[10px] hidden md:inline-flex">
                          {statusLabel}
                        </Badge>
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

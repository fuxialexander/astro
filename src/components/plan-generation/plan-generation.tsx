/**
 * Plan Generation Component
 *
 * Full-height streaming activity view for interactive plan generation.
 * Subscribes to execution-store and realtime-store for events.
 * Renders activity blocks, inline approvals, and plan result card.
 */

import { useState, useRef, useEffect, useMemo } from "react"
import { Send, Square, ArrowDown, Sparkles, AlertCircle, Monitor, Clock, Pencil } from "lucide-react"
import { TypingIndicator } from "@/components/ui/typing-indicator"
import { useNavigate } from "react-router"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useExecutionStore } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useToastStore } from "@/stores/toast-store"
import { useNotificationStore } from "@/stores/notification-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useSessionStore } from "@/stores/session-store"
import { useUsageStore } from "@/stores/usage-store"
import { usePlanStore } from "@/stores/plan-store"
import { projectChatWithAgent, fetchStreamingEventsCatchUp, replayChatCatchUpEvents, type ChatPlanNodeContext, type ChatPlanEdgeContext } from "@/lib/api-client"
import { groupActivityEvents } from "@/components/activity-blocks"
import { ActivityBlockRenderer } from "@/components/activity-block-renderer"
import { PlanResultCard } from "./plan-result-card"
import { PlanGenerationHeader } from "./plan-generation-header"
import type { TaskActivityEvent } from "@/types"
import { useStreamEvents } from "@/hooks/use-stream-events"
import { Link } from "react-router"

interface PlanGenerationProps {
  projectId: string
  projectName: string
  machineName?: string
  workingDirectory?: string
  /** Called when user navigates back to the landing page */
  onBack?: () => void
  /** Called when user wants to start a new plan session */
  onNewPlan?: () => void
}

export function PlanGeneration({
  projectId,
  projectName,
  machineName,
  workingDirectory,
  onBack,
  onNewPlan,
}: PlanGenerationProps) {
  const navigate = useNavigate()
  const yoloMode = useSettingsStore((s) => s.yoloMode)
  const nodeId = `plan-${projectId}`
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  // pendingSteerText removed: pending steers now render inline in activityEvents
  const [isChatStreaming, setIsChatStreaming] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [pendingSteer, setPendingSteer] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** Tracks per-turn streamId and last-seen seq for disconnect catch-up */
  const chatStreamRef = useRef<{ streamId: string; lastSeq: number }>({ streamId: '', lastSeq: 0 })

  // Execution state — stable selectors (Map.get returns same ref)
  const execution = useExecutionStore((s) => s.executions.get(nodeId))
  const cancelPlanGeneration = useExecutionStore((s) => s.cancelPlanGeneration)
  const steerPlanGeneration = useExecutionStore((s) => s.steerPlanGeneration)

  // Realtime state — select stable refs, derive filtered data in useMemo
  const executionId = execution?.executionId || ""
  const dynamicApprovalsMap = useRealtimeStore((s) => s.dynamicApprovals)
  const respondToDynamicApproval = useRealtimeStore((s) => s.respondToDynamicApproval)
  const addSteerMessage = useRealtimeStore((s) => s.addSteerMessage)
  const pushActivityEvent = useRealtimeStore((s) => s.pushActivityEvent)
  const hydrateFromCatchUp = useRealtimeStore((s) => s.hydrateFromCatchUp)

  // Session store for post-completion chat (messages stored for conversation history only)
  const sessionsLoaded = useSessionStore((s) => s.loaded)
  const createSessionAction = useSessionStore((s) => s.createSession)
  const addMessage = useSessionStore((s) => s.addMessage)
  const setProviderSessionId = useSessionStore((s) => s.setProviderSessionId)
  // Don't send model to plan chat — the compute backend (Claude Code CLI)
  // uses its own configured model. Sending display names like "Haiku 4.5"
  // causes API errors since they aren't valid model identifiers.

  // Get or create a chat session for this plan node — wait for sessions to load first
  const allSessions = useSessionStore((s) => s.sessions)
  const chatSession = useMemo(() => {
    let latest: ReturnType<typeof allSessions.get> | undefined
    for (const session of allSessions.values()) {
      if (session.nodeId === nodeId && session.type === "project-chat") {
        if (!latest || session.createdAt > latest.createdAt) latest = session
      }
    }
    return latest
  }, [allSessions, nodeId])
  useEffect(() => {
    if (sessionsLoaded && !chatSession) {
      createSessionAction({ type: "project-chat", projectId, nodeId })
    }
  }, [sessionsLoaded, chatSession, createSessionAction, nodeId, projectId])

  // Plan data — select full array, filter in useMemo to avoid unstable getSnapshot
  const allPlanNodes = usePlanStore((s) => s.nodes)
  const allPlanEdges = usePlanStore((s) => s.edges)
  const planNodes = useMemo(() => allPlanNodes.filter((n) => n.projectId === projectId), [allPlanNodes, projectId])

  // Build lean plan context for the API (mirrors chat-panel.tsx)
  const planNodeContext: ChatPlanNodeContext[] = useMemo(() => {
    return planNodes.map((n) => ({
      id: n.id,
      title: n.title,
      description: n.description ?? '',
      status: n.status,
      type: n.type,
      priority: n.priority,
      estimate: n.estimate,
      milestoneId: n.milestoneId,
      dependencies: n.dependencies,
      startDate: n.startDate,
      endDate: n.endDate,
    }))
  }, [planNodes])

  const planEdgeContext: ChatPlanEdgeContext[] = useMemo(() => {
    const projectNodeIds = new Set(planNodes.map((n) => n.id))
    return allPlanEdges
      .filter((e) => projectNodeIds.has(e.source) || projectNodeIds.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, type: e.type }))
  }, [planNodes, allPlanEdges])

  // Check if this plan originated from a playground session
  const projectVisionDoc = useProjectStore((s) =>
    s.projects.find((p) => p.id === projectId)?.visionDoc
  )
  const isFromPlayground = projectVisionDoc?.includes("Context from Prior Playground Session") ?? false

  const isRunning = execution?.status === "pending" || execution?.status === "running"

  // Lazy-load full session data (messages) after page refresh
  const ensureFullSession = useSessionStore((s) => s.ensureFullSession)
  const ensuredSessionRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const sid = chatSession?.id
    if (sid && sid !== ensuredSessionRef.current && chatSession.messages.length === 0 && !isChatStreaming) {
      ensuredSessionRef.current = sid
      ensureFullSession(sid)
    }
  }, [chatSession?.id, chatSession?.messages.length, isChatStreaming, ensureFullSession])

  // Unified stream events for the execution activity timeline.
  // Execution events come from taskStreams keyed by executionId.
  // Chat events come from taskStreams keyed by chatSession.id.
  const sessionMessages = useMemo(() => chatSession?.messages || [], [chatSession?.messages])
  const { activityEvents: execActivityEvents, isHydrating: isRestoring } = useStreamEvents(
    executionId || undefined,
    { execution, projectId },
  )
  const { activityEvents: chatActivityEvents } = useStreamEvents(
    chatSession?.id,
    { legacySessionMessages: sessionMessages },
  )

  const allActivityEvents: TaskActivityEvent[] = useMemo(() => {
    return [...execActivityEvents, ...chatActivityEvents]
  }, [execActivityEvents, chatActivityEvents])

  // Group events for display
  const displayBlocks = useMemo(() => groupActivityEvents(allActivityEvents), [allActivityEvents])

  // Find pending approvals for this execution
  const pendingApprovals = useMemo(() => {
    if (!execution?.executionId) return []
    return Array.from(dynamicApprovalsMap.values()).filter(
      (a) => a.taskId === execution.executionId
    )
  }, [dynamicApprovalsMap, execution?.executionId])

  // Answered approvals (from activity events)
  const { answeredRequestIds, approvalResponseMap } = useMemo(() => {
    const ids = new Set<string>()
    const responses = new Map<string, Extract<TaskActivityEvent, { type: 'approval_response' }>>()
    for (const event of allActivityEvents) {
      if (event.type === 'approval_response') {
        ids.add(event.requestId)
        responses.set(event.requestId, event)
      }
    }
    return { answeredRequestIds: ids, approvalResponseMap: responses }
  }, [allActivityEvents])

  // Check if plan was extracted
  const hasPlan = planNodes.length > 0
  const milestoneNames = planNodes.filter((n) => n.type === "milestone").map((n) => n.title)

  // Compute status for header
  // If execution succeeded but no plan was extracted, the model likely asked
  // clarification questions — show "waiting for input" so the user knows to respond.
  const headerStatus = !execution
    ? 'stopped' as const
    : execution.status === "cancelled"
      ? 'stopped' as const
      : isChatStreaming
        ? 'planning' as const
        : execution.status === "success" || execution.status === "failure"
          ? (execution.error ? 'error' as const : !hasPlan ? 'waiting' as const : 'completed' as const)
          : pendingApprovals.length > 0
            ? 'waiting' as const
            : 'planning' as const

  // YOLO auto-navigation: when plan completes successfully in YOLO mode,
  // auto-navigate to the project view. executeAllProject is already triggered
  // by the execution-store's autoExecuteProjectIds mechanism.
  //
  // Guard: only navigate if the execution was observed transitioning through a
  // live (pending/running) state during this mount. If the execution was already
  // terminal (success/failure) when the component mounted, we're viewing a past
  // session and must not redirect. This is derived from store state (backed by
  // DB), not from which UI button was clicked.
  const yoloNavigated = useRef(false)
  // Using state (not ref) so changes trigger re-render and YOLO nav re-evaluates.
  // yoloNavigated stays as ref because it's a one-shot guard that should NOT cause re-renders.
  const [executionWasLive, setExecutionWasLive] = useState(false)
  // Track which projectId the executionWasLive flag belongs to, so a stale `true`
  // from a previous project can't trigger navigation after a projectId switch.
  const liveProjectIdRef = useRef<string | null>(null)
  const planNotified = useRef(false)
  // Reset all guards when projectId changes
  useEffect(() => {
    yoloNavigated.current = false
    planNotified.current = false
    setExecutionWasLive(false)
    liveProjectIdRef.current = null
  }, [projectId])
  // Track live execution transitions (source of truth: execution-store → DB)
  useEffect(() => {
    if (execution?.status === 'pending' || execution?.status === 'running') {
      setExecutionWasLive(true)
      liveProjectIdRef.current = projectId
    }
  }, [execution?.status, projectId])
  useEffect(() => {
    if (executionWasLive && liveProjectIdRef.current === projectId && yoloMode && workingDirectory && headerStatus === 'completed' && hasPlan && !yoloNavigated.current) {
      yoloNavigated.current = true
      useToastStore.getState().add({
        type: 'success',
        title: 'Plan generated — starting execution...',
        description: `Navigating to project view.`,
        duration: 4000,
      })
      useNotificationStore.getState().add({
        type: 'success',
        title: 'Plan generated',
        description: `Plan for "${projectName || 'project'}" has been generated and execution is starting.`,
        projectId,
      })
      // Small delay for the toast to be visible before navigation
      const timer = setTimeout(() => {
        navigate(`/project/${projectId}`)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [executionWasLive, yoloMode, workingDirectory, headerStatus, hasPlan, projectId, projectName, navigate])

  // Non-YOLO: notify when plan generation completes
  useEffect(() => {
    if (planNotified.current) return
    if (executionWasLive && liveProjectIdRef.current === projectId && !yoloMode && headerStatus === 'completed' && hasPlan) {
      planNotified.current = true
      useToastStore.getState().add({
        type: 'success',
        title: 'Plan generated',
        description: `Plan for "${projectName || 'project'}" is ready for review.`,
        duration: 5000,
      })
      useNotificationStore.getState().add({
        type: 'success',
        title: 'Plan generated',
        description: `Plan for "${projectName || 'project'}" is ready for review.`,
        projectId,
      })
    }
  }, [executionWasLive, yoloMode, headerStatus, hasPlan, projectId, projectName])

  // Auto-scroll
  const eventsLength = allActivityEvents.length
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [eventsLength, autoScroll, displayBlocks.length])

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50)
  }

  // Steer message handler (while running)
  async function handleSteer(text: string) {
    if (!text || sending) return

    // If executionId isn't available yet (agent hasn't sent init), queue the message
    if (!execution?.executionId || !execution?.machineId) {
      setPendingSteer(text)
      return
    }

    setPendingSteer(null)
    setSending(true)

    addSteerMessage(execution.executionId, text)

    try {
      const result = await steerPlanGeneration(projectId, text)
      if (!result.success) {
        if (result.error === 'no-machine') {
          useToastStore.getState().add({
            type: 'error',
            title: 'Cannot send guidance',
            description: 'No connected machine found. The agent may not have started yet — your message will be queued.',
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
    } finally {
      setSending(false)
    }
  }

  // Auto-send pending steer when executionId becomes available
  useEffect(() => {
    if (pendingSteer && execution?.executionId && execution?.machineId && !sending) {
      const msg = pendingSteer
      setPendingSteer(null)
      setSending(true)
      addSteerMessage(execution.executionId, msg)
      steerPlanGeneration(projectId, msg).then((result) => {
        if (!result.success && result.error === 'send-failed') {
          useToastStore.getState().add({
            type: 'error',
            title: 'Guidance delivery failed',
            description: 'Failed to send queued guidance to the agent. Please try again.',
            duration: 4000,
          })
        }
      }).finally(() => setSending(false))
    }
  }, [pendingSteer, execution?.executionId, execution?.machineId, sending, projectId, addSteerMessage, steerPlanGeneration])

  // Chat message handler (post-completion)
  async function handleChat(text: string) {
    if (!text || isChatStreaming || !chatSession) return

    const sid = chatSession.id

    // Use stable session ID as streamId so all turns persist under one key
    const turnStreamId = sid
    chatStreamRef.current = { streamId: turnStreamId, lastSeq: 0 }

    // Add user message as activity event for display
    pushActivityEvent(sid, { type: 'chat_user', message: text, timestamp: new Date() })

    // Store in session for conversation history (sent to backend on subsequent turns)
    addMessage(sid, { role: "user", content: text })

    setIsChatStreaming(true)
    abortRef.current = new AbortController()

    const project = useProjectStore.getState().projects.find((p) => p.id === projectId)

    // Build conversation history: include original plan generation context on first turn
    const sessionMessages = chatSession.messages || [] as Array<{ role: string; content: string }>
    const chatHistory = sessionMessages
      .filter((m: { role: string; content: string }) => m.role === "user" || (m.role === "assistant" && m.content.length > 0))
      .map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content }))

    // Session resume handles context continuity — no need to inject streamText.
    // On the first chat turn, execution.sessionId is passed as resumeSessionId
    // so the provider restores the full plan generation conversation automatically.
    const historyMessages = [...chatHistory]

    let rawText = ""
    let rawTextAtLastSeq = ""
    // Track whether astro-cli MCP tools mutated the plan (same pattern as ChatPanel)
    const PLAN_MUTATING_TOOLS = new Set(["create_task", "update_task", "delete_task", "create_dependency", "Bash"])
    let needsPlanRefresh = false
    const finalizeChatTurn = async (assistantText: string, newSessionId?: string) => {
      if (newSessionId) setProviderSessionId(sid, newSessionId)

      // If astro-cli MCP tools mutated the plan, reload from server
      if (needsPlanRefresh) {
        console.log(`[plan-chat] Plan mutating tools detected, refreshing plan from server`)
        await usePlanStore.getState().load()
      }

      if (needsPlanRefresh) {
        const updatedNodes = usePlanStore.getState().nodes.filter((n) => n.projectId === projectId)
        const updatedEdgeSet = new Set(updatedNodes.map((n) => n.id))
        const updatedEdges = usePlanStore.getState().edges.filter(
          (e) => updatedEdgeSet.has(e.source) || updatedEdgeSet.has(e.target)
        )
        if (updatedNodes.length > 0) {
          pushActivityEvent(sid, {
            type: 'plan_result',
            nodes: updatedNodes.map((n) => ({ id: n.id, title: n.title, type: n.type, status: n.status })),
            edges: updatedEdges.map((e) => ({ source: e.source, target: e.target })),
            projectName,
            timestamp: new Date(),
          })
        }
      }

      // Store full text in session message for conversation history
      addMessage(sid, { role: "assistant", content: assistantText })
      chatStreamRef.current = { streamId: '', lastSeq: 0 }
      setIsChatStreaming(false)
    }
    try {
      await projectChatWithAgent(
        {
          message: text,
          sessionId: chatSession.providerSessionId || execution?.sessionId || undefined,
          streamId: turnStreamId,
          projectId,
          visionDoc: project?.visionDoc,
          planNodes: planNodeContext,
          planEdges: planEdgeContext,
          messages: historyMessages,
          taskType: 'plan',
        },
        {
          onText: (chunk) => {
            rawText += chunk
          },
          onOperational: () => {},
          onToolUse: (data) => {
            if (PLAN_MUTATING_TOOLS.has(data.toolName)) needsPlanRefresh = true
          },
          onToolResult: (data) => {
            if (PLAN_MUTATING_TOOLS.has(data.toolName)) needsPlanRefresh = true
          },
          onDone: async (newSessionId) => {
            await finalizeChatTurn(rawText, newSessionId)
          },
          onError: (error) => {
            pushActivityEvent(sid, { type: 'error', error, timestamp: new Date() })
            chatStreamRef.current = { streamId: '', lastSeq: 0 }
            setIsChatStreaming(false)
          },
          onSeq: (seq) => {
            chatStreamRef.current.lastSeq = seq
            // Snapshot rawText at each heartbeat — text up to here is persisted
            // in DB and won't be re-fetched by catch-up.
            rawTextAtLastSeq = rawText
          },
          onMetrics: (m) => {
            useUsageStore.getState().addTaskMetrics({
              durationMs: m.durationMs,
              inputTokens: m.inputTokens,
              outputTokens: m.outputTokens,
              estimatedCostUsd: m.totalCost,
              model: m.model,
              turnsUsed: m.numTurns,
            }, true)
          },
        },
        abortRef.current.signal,
      )
    } catch (e: unknown) {
      // User-initiated abort — no catch-up needed
      if (e instanceof Error && e.name === 'AbortError') {
        setIsChatStreaming(false)
        return
      }

      // Network error — attempt catch-up using stored streamId and lastSeq.
      // Rendering events (text, tool_use, tool_result) are handled by the global SSE
      // reconnect in the realtime store. We only need to catch up rawText for plan
      // extraction and handle onDone lifecycle.
      const { streamId: catchUpStreamId, lastSeq } = chatStreamRef.current
      if (catchUpStreamId) {
        try {
          await hydrateFromCatchUp([catchUpStreamId], lastSeq)
          const { events } = await fetchStreamingEventsCatchUp([catchUpStreamId], lastSeq)
          if (events.length > 0) {
            // Roll back rawText to last checkpoint — text after that seq is in
            // the catch-up batch and would be double-counted.
            rawText = rawTextAtLastSeq
            const { completed } = replayChatCatchUpEvents(events, {
              onText: (chunk) => {
                rawText += chunk
              },
              onToolUse: (data) => {
                if (PLAN_MUTATING_TOOLS.has(data.toolName)) needsPlanRefresh = true
              },
              onToolResult: (data) => {
                if (PLAN_MUTATING_TOOLS.has(data.toolName)) needsPlanRefresh = true
              },
              onDone: (newSessionId) => {
                void finalizeChatTurn(rawText, newSessionId)
              },
              onError: (error) => {
                pushActivityEvent(sid, { type: 'error', error, timestamp: new Date() })
              },
            })
            if (completed) {
              chatStreamRef.current = { streamId: '', lastSeq: 0 }
            }
          } else {
            pushActivityEvent(sid, { type: 'error', error: 'Connection lost during chat', timestamp: new Date() })
          }
        } catch {
          // Catch-up also failed — surface the connection error
          chatStreamRef.current = { streamId: '', lastSeq: 0 }
          pushActivityEvent(sid, { type: 'error', error: 'Connection lost — unable to recover', timestamp: new Date() })
        }
      } else {
        pushActivityEvent(sid, { type: 'error', error: 'Connection lost', timestamp: new Date() })
      }

      setIsChatStreaming(false)
    }
  }

  // Route: steer during execution, chat after completion
  function handleSend() {
    const text = input.trim()
    if (!text) return
    setInput("")
    // Reset auto-resize height — onChange doesn't fire when React sets the value
    if (inputRef.current) inputRef.current.style.height = 'auto'

    if (isRunning) {
      handleSteer(text)
    } else {
      handleChat(text)
    }
  }

  // Handle approval response
  async function handleApprovalResponse(requestId: string, answer: string) {
    if (!execution?.executionId) return
    await respondToDynamicApproval(execution.executionId, requestId, answer)
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <PlanGenerationHeader
        projectName={projectName}
        status={headerStatus}
        machineName={machineName}
        workingDirectory={workingDirectory}
        onAbort={() => cancelPlanGeneration(projectId)}
        onBack={onBack}
        onNewPlan={onNewPlan}
      />
      {isFromPlayground && (
        <div className="px-4 py-1.5 border-b border-border bg-background shrink-0">
          <Badge variant="outline" className="text-[10px]">
            <Sparkles className="h-3 w-3 mr-1" /> From Playground
          </Badge>
        </div>
      )}

      {/* Activity Timeline — always visible (project-chat IS the activity view) */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto py-3 bg-muted/20 max-md:pb-16"
      >
        {/* Error state */}
        {execution?.status === "failure" && execution.error && (
          <div className="flex items-center justify-center h-full" role="alert" aria-live="assertive" aria-describedby="plan-error-title plan-error-message">
            <div className="text-center max-w-md px-4">
              <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-3" aria-label="Error" />
              <p id="plan-error-title" className="text-sm font-medium text-destructive mb-2">Planning session failed</p>
              {/* TODO: Replace string matching with typed error codes from backend (e.g., error.code === 'MACHINE_UNAVAILABLE') */}
              {execution.error.toLowerCase().includes("no available machine") ? (
                <div className="space-y-3">
                  <p id="plan-error-message" className="text-xs text-muted-foreground">
                    {machineName
                      ? `No machine is connected (expected: ${machineName}). Connect an agent runner to start planning.`
                      : "No machine is connected. Connect an agent runner to start planning."}
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <Link to="/environments">
                      <Button variant="outline" size="sm">
                        <Monitor className="h-3.5 w-3.5 mr-1.5" />
                        Set Up Machine
                      </Button>
                    </Link>
                    {onBack && (
                      <Button variant="ghost" size="sm" onClick={onBack}>
                        Go Back
                      </Button>
                    )}
                  </div>
                </div>
              ) : execution.error.toLowerCase().includes("not found or not authorized") ? (
                <div className="space-y-3">
                  <p id="plan-error-message" className="text-xs text-muted-foreground">
                    {machineName
                      ? `The selected machine "${machineName}" is no longer available. It may have disconnected.`
                      : "The selected machine is no longer available. It may have disconnected."}
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <Link to="/environments">
                      <Button variant="outline" size="sm">
                        <Monitor className="h-3.5 w-3.5 mr-1.5" />
                        Check Machines
                      </Button>
                    </Link>
                    {onBack && (
                      <Button variant="ghost" size="sm" onClick={onBack}>
                        Go Back
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p id="plan-error-message" className="text-xs text-muted-foreground">{execution.error}</p>
                  {onBack && (
                    <Button variant="ghost" size="sm" onClick={onBack}>
                      Go Back
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {displayBlocks.length === 0 && execution?.status !== "failure" && (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {isRunning ? (
              <span className="flex items-center gap-2">
                <TypingIndicator className="text-muted-foreground" />
                Starting planning session...
              </span>
            ) : isRestoring ? (
              <span className="flex items-center gap-2">
                <TypingIndicator className="text-muted-foreground" />
                Loading activity...
              </span>
            ) : "No activity yet"}
          </div>
        )}

        {/* Activity blocks */}
        <ActivityBlockRenderer
          blocks={displayBlocks}
          isStreaming={isRunning || isChatStreaming}
          isRunning={isRunning || isChatStreaming}
          onEditMessage={!isRunning && !isChatStreaming ? (msg) => { setInput(msg); inputRef.current?.focus() } : undefined}
          onApprovalResponse={handleApprovalResponse}
          answeredApprovals={answeredRequestIds}
          approvalResponses={approvalResponseMap}
        />

        {/* Pending steer bubble removed: addSteerMessage now adds pending
            events directly to activityEvents, rendered inline above */}

        {/* Chat streaming indicator */}
        {isChatStreaming && (
          <div className="flex items-center gap-2 px-4 py-2">
            <TypingIndicator className="text-muted-foreground" />
          </div>
        )}

        {/* Plan result card */}
        {!isRunning && hasPlan && (
          <PlanResultCard
            projectId={projectId}
            projectName={projectName}
            nodeCount={planNodes.length}
            edgeCount={planEdgeContext.length}
            milestoneNames={milestoneNames}
            status="success"
          />
        )}

        {/* Pending steer indicator — shown when user sent a message before executionId is available */}
        {pendingSteer && (
          <div className="mx-3 my-2 flex items-start gap-2 rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-sm">
            <Clock className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground animate-pulse" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground mb-0.5">Queued — will deliver when the agent session starts</p>
              <p className="text-foreground whitespace-pre-wrap break-words">{pendingSteer}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setInput(pendingSteer)
                setPendingSteer(null)
              }}
              title="Edit message"
            >
              <Pencil className="h-3 w-3" />
            </Button>
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

      {/* Input Bar — always visible for running sessions and resuming stopped ones.
          On mobile: fixed above the floating tab bar so it doesn't scroll with content.
          On desktop: normal flex shrink-0 within the panel. */}
      <div className="border-t border-border bg-background shrink-0 max-md:fixed max-md:bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] max-md:left-0 max-md:right-0 max-md:z-40">
        <div className="flex items-end gap-2 p-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              // Auto-resize: reset to auto then expand to scrollHeight
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, window.innerHeight * 0.5)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={isRunning ? "Guide the planning session..." : !hasPlan && headerStatus === 'waiting' ? "Answer the questions or provide more details..." : "Describe changes to the plan, add constraints, or ask questions..."}
            rows={3}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none overflow-y-auto"
            style={{ maxHeight: '50vh' }}
          />
          {isChatStreaming ? (
            <Button
              size="icon"
              variant="destructive"
              className="h-9 w-9 shrink-0"
              onClick={() => { abortRef.current?.abort() }}
              title="Stop response"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={handleSend}
              disabled={!input.trim() || sending || !!pendingSteer}
            >
              {sending ? (
                <TypingIndicator className="text-current scale-75" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

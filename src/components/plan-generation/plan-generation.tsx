/**
 * Plan Generation Component
 *
 * Full-height streaming activity view for interactive plan generation.
 * Subscribes to execution-store and realtime-store for events.
 * Renders activity blocks, inline approvals, and plan result card.
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { Send, Loader2, ArrowDown, Sparkles, AlertCircle, Monitor } from "lucide-react"
import { useNavigate } from "react-router"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useExecutionStore } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useToastStore } from "@/stores/toast-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useSessionStore } from "@/stores/session-store"
import { useUsageStore } from "@/stores/usage-store"
import { usePlanStore } from "@/stores/plan-store"
import { projectChatWithAgent, fetchStreamingEventsCatchUp, replayChatCatchUpEvents, type ChatPlanNodeContext, type ChatPlanEdgeContext } from "@/lib/api-client"
import { extractMutations, applyMutationsToStore } from "@/lib/plan-mutations"
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
  GitHubCommentBlock,
  SystemPromptBlock,
  PlanGraphBlock,
  type DisplayBlock,
} from "@/components/activity-blocks"
import { InlineApprovalCard } from "./inline-approval-card"
import { PlanResultCard } from "./plan-result-card"
import { PlanGenerationHeader } from "./plan-generation-header"
import type { TaskActivityEvent } from "@/types"
import { useRestoredExecution } from "@/hooks/use-restored-execution"
import { useChatStreamEvents } from "@/hooks/use-chat-stream-events"
import { useChatActivityEvents } from "@/hooks/use-chat-activity-events"
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
  const [pendingSteerText, setPendingSteerText] = useState<string | null>(null)
  const [isChatStreaming, setIsChatStreaming] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
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
  const taskStream = useRealtimeStore(useCallback((s) => s.taskStreams.get(executionId), [executionId]))
  const dynamicApprovalsMap = useRealtimeStore((s) => s.dynamicApprovals)
  const respondToDynamicApproval = useRealtimeStore((s) => s.respondToDynamicApproval)
  const addSteerMessage = useRealtimeStore((s) => s.addSteerMessage)

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
    trimChatEvents,
    chatToolCounterRef,
  } = useChatStreamEvents()

  // Hydrate chat events from streaming_events DB after page refresh
  const sessionMessages = useMemo(() => chatSession?.messages || [], [chatSession?.messages])
  const { activityEvents: hydratedChatEvents } = useChatActivityEvents(
    chatSession?.id,
    sessionMessages,
    isChatStreaming,
  )

  // Merge: combine historical hydrated events with current-mount live events.
  // hydratedChatEvents = DB events at mount time (all previous turns).
  // chatEventsRef.current = live events from the current mount's chat turns.
  // These two sets are non-overlapping: hydrated covers pre-mount history,
  // ref covers post-mount activity. Concatenating both ensures a new browser
  // (chatEventsRef empty, hydrated = all) and same browser mid-session
  // (chatEventsRef has current turns, hydrated has prior turns) show the same
  // complete history instead of diverging.
  const allActivityEvents: TaskActivityEvent[] = useMemo(() => {
    void chatEventsVersion // re-compute when chat events change
    const liveChatEvents = chatEventsRef.current
    const chatEvents = liveChatEvents.length > 0
      ? [...hydratedChatEvents, ...liveChatEvents]
      : hydratedChatEvents
    return [...activityEvents, ...chatEvents]
  // eslint-disable-next-line react-hooks/exhaustive-deps -- chatEventsRef is a stable ref
  }, [activityEvents, chatEventsVersion, hydratedChatEvents])

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
  const answeredRequestIds = useMemo(() => {
    const ids = new Set<string>()
    for (const event of allActivityEvents) {
      if (event.type === 'approval_response') {
        ids.add(event.requestId)
      }
    }
    return ids
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
  const [executionWasLive, setExecutionWasLive] = useState(false)
  // Reset both guards when projectId changes
  useEffect(() => {
    yoloNavigated.current = false
    setExecutionWasLive(false)
  }, [projectId])
  // Track live execution transitions (source of truth: execution-store → DB)
  // Using state (not ref) so changes trigger re-render and YOLO nav re-evaluates.
  useEffect(() => {
    if (execution?.status === 'pending' || execution?.status === 'running') {
      setExecutionWasLive(true)
    }
  }, [execution?.status])
  useEffect(() => {
    if (executionWasLive && yoloMode && headerStatus === 'completed' && hasPlan && !yoloNavigated.current) {
      yoloNavigated.current = true
      useToastStore.getState().add({
        type: 'success',
        title: 'Plan generated — starting execution...',
        description: `Navigating to project view.`,
        duration: 4000,
      })
      // Small delay for the toast to be visible before navigation
      const timer = setTimeout(() => {
        navigate(`/project/${projectId}`)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [executionWasLive, yoloMode, headerStatus, hasPlan, projectId, navigate])

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
    setSending(true)
    setPendingSteerText(text)

    if (execution?.executionId) {
      addSteerMessage(execution.executionId, text)
    }

    try {
      await steerPlanGeneration(projectId, text)
    } finally {
      setSending(false)
      setPendingSteerText(null)
    }
  }

  // Chat message handler (post-completion)
  async function handleChat(text: string) {
    if (!text || isChatStreaming || !chatSession) return

    const sid = chatSession.id

    // Use stable session ID as streamId so all turns persist under one key
    const turnStreamId = sid
    chatStreamRef.current = { streamId: turnStreamId, lastSeq: 0 }

    // Add user message as activity event for display
    pushChatEvent({ type: 'chat_user', message: text, timestamp: new Date() })

    // Store in session for conversation history (sent to backend on subsequent turns)
    addMessage(sid, { role: "user", content: text })

    setIsChatStreaming(true)
    abortRef.current = new AbortController()

    const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
    const historyMessages = (chatSession.messages || [] as Array<{ role: string; content: string }>)
      .filter((m: { role: string; content: string }) => m.role === "user" || (m.role === "assistant" && m.content.length > 0))
      .map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content }))

    // Shared callback helpers for both live stream and catch-up replay
    const handleToolUse = (data: { toolName: string; toolInput: unknown }) => {
      const id = `chat-tool-${++chatToolCounterRef.current}`
      pushChatEvent({
        type: 'tool_use',
        id,
        toolName: data.toolName,
        toolInput: data.toolInput,
        timestamp: new Date(),
      })
    }
    const handleToolResult = (data: { toolName: string; success: boolean; result: unknown }) => {
      // Match with the last unmatched tool_use of the same tool name
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
    }

    let rawText = ""
    // Checkpoint: snapshot of rawText and chatEventsRef length at the last
    // heartbeat seq. Used to roll back before catch-up replay so text received
    // live after the last heartbeat isn't appended twice (once from live SSE,
    // once from the catch-up DB fetch).
    // Initialize from current ref length so that if the stream drops before
    // the first heartbeat, the rollback only removes events from this turn
    // (not prior turns already in chatEventsRef).
    let rawTextAtLastSeq = ""
    let chatEventsCountAtLastSeq = chatEventsRef.current.length
    try {
      await projectChatWithAgent(
        {
          message: text,
          sessionId: chatSession.providerSessionId || undefined,
          streamId: turnStreamId,
          projectId,
          visionDoc: project?.visionDoc,
          planNodes: planNodeContext,
          planEdges: planEdgeContext,
          messages: historyMessages,
        },
        {
          onText: (chunk) => {
            rawText += chunk
            pushChatEvent({ type: 'text', content: chunk, timestamp: new Date() })
          },
          onToolUse: handleToolUse,
          onToolResult: handleToolResult,
          onDone: (newSessionId) => {
            if (newSessionId) setProviderSessionId(sid, newSessionId)
            // Extract and apply any mutation blocks before storing the message
            const { mutations } = extractMutations(rawText)
            const hasMutations = mutations.nodeUpdates.length > 0 || mutations.edgeOps.length > 0 || mutations.newNodes.length > 0
            if (hasMutations) {
              const { affectedNodeIds } = applyMutationsToStore(projectId, mutations)
              if (affectedNodeIds.length > 0) {
                usePlanStore.getState().markNodesAsUpdating(affectedNodeIds)
              }
              // Emit plan_result for inline graph after mutations
              const updatedNodes = usePlanStore.getState().nodes.filter((n) => n.projectId === projectId)
              const updatedEdgeSet = new Set(updatedNodes.map((n) => n.id))
              const updatedEdges = usePlanStore.getState().edges.filter(
                (e) => updatedEdgeSet.has(e.source) || updatedEdgeSet.has(e.target)
              )
              pushChatEvent({
                type: 'plan_result',
                nodes: updatedNodes.map((n) => ({ id: n.id, title: n.title, type: n.type, status: n.status })),
                edges: updatedEdges.map((e) => ({ source: e.source, target: e.target })),
                projectName: projectName,
                timestamp: new Date(),
              })
            }
            // Store full text in session message for conversation history
            addMessage(sid, { role: "assistant", content: rawText })
            chatStreamRef.current = { streamId: '', lastSeq: 0 }
            flushChatEvents()
            setIsChatStreaming(false)
          },
          onError: (error) => {
            pushChatEvent({ type: 'error', error, timestamp: new Date() })
            chatStreamRef.current = { streamId: '', lastSeq: 0 }
            flushChatEvents()
            setIsChatStreaming(false)
          },
          onSeq: (seq) => {
            chatStreamRef.current.lastSeq = seq
            // Snapshot at each heartbeat seq — text and events up to here
            // are persisted in DB and won't be re-fetched by catch-up.
            rawTextAtLastSeq = rawText
            chatEventsCountAtLastSeq = chatEventsRef.current.length
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
        flushChatEvents()
        setIsChatStreaming(false)
        return
      }

      // Network error — attempt catch-up using stored streamId and lastSeq
      const { streamId: catchUpStreamId, lastSeq } = chatStreamRef.current
      if (catchUpStreamId) {
        try {
          const { events } = await fetchStreamingEventsCatchUp([catchUpStreamId], lastSeq)
          if (events.length > 0) {
            // Roll back to the last heartbeat checkpoint before replaying.
            // Text received live after the last heartbeat has seq > lastSeq
            // in DB, so it appears in this catch-up batch — without rollback
            // it would be appended to rawText and chatEventsRef a second time.
            rawText = rawTextAtLastSeq
            trimChatEvents(chatEventsCountAtLastSeq)
            const { completed } = replayChatCatchUpEvents(events, {
              onText: (chunk) => {
                rawText += chunk
                pushChatEvent({ type: 'text', content: chunk, timestamp: new Date() })
              },
              onToolUse: handleToolUse,
              onToolResult: handleToolResult,
              onDone: (newSessionId) => {
                if (newSessionId) setProviderSessionId(sid, newSessionId)
                // Extract and apply mutations from catch-up text
                const { mutations: catchUpMutations } = extractMutations(rawText)
                const hasCatchUpMutations = catchUpMutations.nodeUpdates.length > 0 || catchUpMutations.edgeOps.length > 0 || catchUpMutations.newNodes.length > 0
                if (hasCatchUpMutations) {
                  const { affectedNodeIds } = applyMutationsToStore(projectId, catchUpMutations)
                  if (affectedNodeIds.length > 0) {
                    usePlanStore.getState().markNodesAsUpdating(affectedNodeIds)
                  }
                }
                addMessage(sid, { role: "assistant", content: rawText })
              },
              onError: (error) => {
                pushChatEvent({ type: 'error', error, timestamp: new Date() })
              },
            })
            if (completed) {
              chatStreamRef.current = { streamId: '', lastSeq: 0 }
            }
          } else {
            pushChatEvent({ type: 'error', error: 'Connection lost during chat', timestamp: new Date() })
          }
        } catch {
          // Catch-up also failed — surface the connection error
          chatStreamRef.current = { streamId: '', lastSeq: 0 }
          pushChatEvent({ type: 'error', error: 'Connection lost — unable to recover', timestamp: new Date() })
        }
      } else {
        pushChatEvent({ type: 'error', error: 'Connection lost', timestamp: new Date() })
      }

      flushChatEvents()
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

  // Render a display block
  function renderBlock(block: DisplayBlock, index: number) {
    const isLastBlock = index === displayBlocks.length - 1
    const isActivelyStreaming = isRunning || isChatStreaming
    switch (block.type) {
      case 'text':
        return <TextBlock key={index} events={block.events} isStreaming={isActivelyStreaming && isLastBlock} />
      case 'tool':
        return <ToolBlock key={index} events={block.events} isRunning={isActivelyStreaming} />
      case 'tool_group':
        return <ToolGroupBlock key={index} events={block.events} isRunning={isActivelyStreaming} />
      case 'steer':
        return <SteerBlock key={index} event={block.events[0] as Extract<TaskActivityEvent, { type: 'steer' }>} />
      case 'file_change':
        return <FileChangeBlock key={index} event={block.events[0] as Extract<TaskActivityEvent, { type: 'file_change' }>} />
      case 'error':
        return <ErrorBlock key={index} event={block.events[0] as Extract<TaskActivityEvent, { type: 'error' }>} />
      case 'chat_user':
        return <ChatUserBlock key={index} event={block.events[0] as Extract<TaskActivityEvent, { type: 'chat_user' }>} onEdit={!isRunning && !isChatStreaming ? (msg) => { setInput(msg); inputRef.current?.focus() } : undefined} />
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
        // Already rendered inline with the request
        return null
      case 'github_comment':
        return <GitHubCommentBlock key={index} event={block.events[0] as Extract<TaskActivityEvent, { type: 'github_comment' }>} />
      case 'system_prompt':
        return <SystemPromptBlock key={index} event={block.events[0] as Extract<TaskActivityEvent, { type: 'system_prompt' }>} />
      case 'plan_result':
        return <PlanGraphBlock key={index} event={block.events[0] as Extract<TaskActivityEvent, { type: 'plan_result' }>} />
      default:
        return null
    }
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
            {isRunning ? "Starting planning session..." : isRestoring ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading activity...
              </span>
            ) : "No activity yet"}
          </div>
        )}

        {/* Activity blocks */}
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
  )
}

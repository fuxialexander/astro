/**
 * Plan Chat Phase Component
 *
 * Full-height streaming activity view for interactive plan sessions.
 * Subscribes to execution-store and realtime-store for events.
 * Renders activity blocks, inline approvals, and plan result card.
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { Send, Loader2, ArrowDown, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useExecutionStore } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useSessionStore } from "@/stores/session-store"
import { useSettingsStore } from "@/stores/settings-store"
import { usePlanStore } from "@/stores/plan-store"
import { planChatWithAgent, type ChatPlanNodeContext, type ChatPlanEdgeContext } from "@/lib/api-client"
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
import { InlineApprovalCard } from "./inline-approval-card"
import { PlanResultCard } from "./plan-result-card"
import { PlanSessionHeader } from "./plan-session-header"
import type { TaskActivityEvent } from "@/types"
import { useRestoredExecution } from "@/hooks/use-restored-execution"
import { useChatStreamEvents } from "@/hooks/use-chat-stream-events"

interface PlanChatPhaseProps {
  projectId: string
  projectName: string
  machineName?: string
  workingDirectory?: string
  /** Called when user navigates back to the landing page */
  onBack?: () => void
  /** Called when user wants to start a new plan session */
  onNewPlan?: () => void
}

export function PlanChatPhase({
  projectId,
  projectName,
  machineName,
  workingDirectory,
  onBack,
  onNewPlan,
}: PlanChatPhaseProps) {
  const nodeId = `plan-${projectId}`
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [pendingSteerText, setPendingSteerText] = useState<string | null>(null)
  const [isChatStreaming, setIsChatStreaming] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Execution state — stable selectors (Map.get returns same ref)
  const execution = useExecutionStore((s) => s.executions.get(nodeId))
  const cancelPlanSession = useExecutionStore((s) => s.cancelPlanSession)
  const steerPlanSession = useExecutionStore((s) => s.steerPlanSession)

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
  const model = useSettingsStore((s) => s.model)

  // Get or create a chat session for this plan node — wait for sessions to load first
  const allSessions = useSessionStore((s) => s.sessions)
  const chatSession = useMemo(() => {
    let latest: ReturnType<typeof allSessions.get> | undefined
    for (const session of allSessions.values()) {
      if (session.nodeId === nodeId && session.type === "plan-chat") {
        if (!latest || session.createdAt > latest.createdAt) latest = session
      }
    }
    return latest
  }, [allSessions, nodeId])
  useEffect(() => {
    if (sessionsLoaded && !chatSession) {
      createSessionAction({ type: "plan-chat", projectId, nodeId })
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

  // Chat stream events (proper text/tool_use/tool_result tracking)
  const {
    chatEventsRef,
    chatEventsVersion,
    pushChatEvent,
    flushChatEvents,
    chatToolCounterRef,
  } = useChatStreamEvents()

  const allActivityEvents: TaskActivityEvent[] = useMemo(() => {
    void chatEventsVersion // re-compute when chat events change
    return [...activityEvents, ...chatEventsRef.current]
  // eslint-disable-next-line react-hooks/exhaustive-deps -- chatEventsRef is a stable ref
  }, [activityEvents, chatEventsVersion])

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
  const headerStatus = !execution
    ? 'stopped' as const
    : execution.status === "cancelled"
      ? 'stopped' as const
      : execution.status === "success" || execution.status === "failure"
        ? (execution.error ? 'error' as const : 'completed' as const)
        : pendingApprovals.length > 0
          ? 'waiting' as const
          : 'planning' as const

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
      await steerPlanSession(projectId, text)
    } finally {
      setSending(false)
      setPendingSteerText(null)
    }
  }

  // Chat message handler (post-completion)
  async function handleChat(text: string) {
    if (!text || isChatStreaming || !chatSession) return

    const sid = chatSession.id

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

    let rawText = ""
    try {
      await planChatWithAgent(
        {
          message: text,
          sessionId: chatSession.providerSessionId,
          streamId: executionId || undefined,
          projectId,
          visionDoc: project?.visionDoc,
          model,
          planNodes: planNodeContext,
          planEdges: planEdgeContext,
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
          },
          onDone: (newSessionId) => {
            if (newSessionId) setProviderSessionId(sid, newSessionId)
            // Store full text in session message for conversation history
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
  }

  // Route: steer during execution, chat after completion
  function handleSend() {
    const text = input.trim()
    if (!text) return
    setInput("")

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
        // Already rendered inline with the request
        return null
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <PlanSessionHeader
        projectName={projectName}
        status={headerStatus}
        machineName={machineName}
        workingDirectory={workingDirectory}
        onAbort={() => cancelPlanSession(projectId)}
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

      {/* Activity Timeline — always visible (plan-chat IS the activity view) */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto py-3 bg-muted/20"
      >
        {/* Error state */}
        {execution?.status === "failure" && execution.error && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md px-4">
              <p className="text-sm font-medium text-destructive mb-1">Planning session failed</p>
              <p className="text-xs text-muted-foreground">{execution.error}</p>
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
            edgeCount={0}
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
            placeholder={isRunning ? "Guide the planning session..." : "Ask about this plan..."}
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
  )
}

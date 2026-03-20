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
import { ActivityBlockRenderer } from "@/components/activity-block-renderer"
import { PlanResultCard } from "./plan-result-card"
import { PlanGenerationHeader } from "./plan-generation-header"
import { useAutoScroll } from "@/hooks/use-auto-scroll"
import { usePlanContext } from "@/hooks/use-plan-context"
import { useChatSession } from "@/hooks/use-chat-session"
import { useActivityFeed } from "@/hooks/use-activity-feed"
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
  const [pendingSteer, setPendingSteer] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Execution state — stable selectors (Map.get returns same ref)
  const execution = useExecutionStore((s) => s.executions.get(nodeId))
  const executionStoreLoaded = useExecutionStore((s) => s.loaded)
  const cancelPlanGeneration = useExecutionStore((s) => s.cancelPlanGeneration)
  const steerPlanGeneration = useExecutionStore((s) => s.steerPlanGeneration)

  // Realtime state — select stable refs, derive filtered data in useMemo
  const executionId = execution?.executionId || ""
  const dynamicApprovalsMap = useRealtimeStore((s) => s.dynamicApprovals)
  const respondToDynamicApproval = useRealtimeStore((s) => s.respondToDynamicApproval)
  const addSteerMessage = useRealtimeStore((s) => s.addSteerMessage)

  // ─── Shared Hooks ─────────────────────────────────────────────────
  // Chat session (post-completion follow-up). This stays in its own
  // plan-generation session instead of merging into project-chat.
  const { chatSession, isChatStreaming, addMessage, sendChatMessage, abortChatStream } =
    useChatSession({ projectId, type: "plan-generation" })

  // Plan context for API calls
  const { planNodes, planNodeContext, planEdgeContext } = usePlanContext(projectId)

  // Activity feed (execution + chat events merged)
  const sessionMessages = useMemo(() => chatSession?.messages || [], [chatSession?.messages])
  const {
    allActivityEvents, displayBlocks, answeredRequestIds, approvalResponseMap, isRestoring,
  } = useActivityFeed({
    executionId: executionId || undefined,
    chatSessionId: chatSession?.id,
    execution,
    projectId,
    chatMessages: sessionMessages,
  })

  // Auto-scroll
  const { autoScroll, handleScroll, scrollToBottom } = useAutoScroll(
    containerRef,
    [allActivityEvents.length, displayBlocks.length],
  )

  // ─── Derived State ────────────────────────────────────────────────
  const projectVisionDoc = useProjectStore((s) =>
    s.projects.find((p) => p.id === projectId)?.visionDoc
  )
  const isFromPlayground = projectVisionDoc?.includes("Context from Prior Playground Session") ?? false
  const isRunning = execution?.status === "pending" || execution?.status === "running"

  // Find pending approvals for this execution
  const pendingApprovals = useMemo(() => {
    if (!execution?.executionId) return []
    return Array.from(dynamicApprovalsMap.values()).filter(
      (a) => a.taskId === execution.executionId
    )
  }, [dynamicApprovalsMap, execution?.executionId])

  // Check if plan was extracted
  const hasPlan = planNodes.length > 0
  const milestoneNames = planNodes.filter((n) => n.type === "milestone").map((n) => n.title)

  // Compute status for header
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

  // ─── YOLO Auto-Navigation ────────────────────────────────────────
  const yoloNavigated = useRef(false)
  const [executionWasLive, setExecutionWasLive] = useState(false)
  const liveProjectIdRef = useRef<string | null>(null)
  const planNotified = useRef(false)

  useEffect(() => {
    yoloNavigated.current = false
    planNotified.current = false
    setExecutionWasLive(false)
    liveProjectIdRef.current = null
  }, [projectId])

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
      const timer = setTimeout(() => {
        navigate(`/project/${projectId}`)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [executionWasLive, yoloMode, workingDirectory, headerStatus, hasPlan, projectId, projectName, navigate])

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

  // ─── Steer Handler ───────────────────────────────────────────────
  async function handleSteer(text: string) {
    if (!text || sending) return

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

  // ─── Chat Handler (post-completion) ──────────────────────────────
  function handleChat(text: string) {
    if (!text || !chatSession) return

    const sid = chatSession.id
    const project = useProjectStore.getState().projects.find((p) => p.id === projectId)

    addMessage(sid, { role: "user", content: text })
    addMessage(sid, { role: "assistant", content: "" })

    const freshSession = useSessionStore.getState().sessions.get(sid)
    const freshMessages = freshSession?.messages || []
    const historyMessages = freshMessages
      .slice(0, -2)
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content.length > 0))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

    sendChatMessage({
      sessionId: sid,
      projectId,
      message: text,
      visionDoc: project?.visionDoc,
      planNodes: planNodeContext,
      planEdges: planEdgeContext,
      messages: historyMessages,
      taskType: "plan",
    })
  }

  // Route: steer during execution, chat after completion
  function handleSend() {
    const text = input.trim()
    if (!text) return
    setInput("")
    if (inputRef.current) inputRef.current.style.height = 'auto'

    if (isRunning) {
      handleSteer(text)
    } else {
      handleChat(text)
    }
  }

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

      {/* Activity Timeline */}
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
            ) : (!executionStoreLoaded || isRestoring) ? (
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

        {/* Pending steer indicator */}
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
          onClick={scrollToBottom}
        >
          <ArrowDown className="h-3.5 w-3.5" />
          Bottom
        </Button>
      )}

      {/* Input Bar */}
      <div className="border-t border-border bg-background shrink-0 max-md:fixed max-md:bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] max-md:left-0 max-md:right-0 max-md:z-40">
        <div className="flex items-end gap-2 p-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
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
          {(isRunning || isChatStreaming) && (
            <Button
              size="icon"
              variant="destructive"
              className="h-9 w-9 shrink-0"
              onClick={() => {
                if (isChatStreaming && chatSession) abortChatStream(chatSession.id)
                if (isRunning) cancelPlanGeneration(projectId)
              }}
              title={isRunning ? "Stop generation" : "Stop response"}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={handleSend}
            disabled={!input.trim() || sending || !!pendingSteer}
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
  )
}

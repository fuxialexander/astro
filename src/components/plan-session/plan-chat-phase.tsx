/**
 * Plan Chat Phase Component
 *
 * Full-height streaming activity view for interactive plan sessions.
 * Subscribes to execution-store and realtime-store for events.
 * Renders activity blocks, inline approvals, and plan result card.
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { Send, Loader2, ArrowDown, Layers, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useExecutionStore } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { usePlanStore } from "@/stores/plan-store"
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
import { InlineApprovalCard } from "./inline-approval-card"
import { PlanResultCard } from "./plan-result-card"
import { PlanSessionHeader } from "./plan-session-header"
import { TraceViewer } from "@/components/task-detail/trace-viewer"
import { cn } from "@/lib/utils"
import type { TaskActivityEvent } from "@/types"
import { useRestoredExecution } from "@/hooks/use-restored-execution"

interface PlanChatPhaseProps {
  projectId: string
  projectName: string
  machineName?: string
  workingDirectory?: string
  /** Called when user navigates back to the landing page */
  onBack?: () => void
}

export function PlanChatPhase({
  projectId,
  projectName,
  machineName,
  workingDirectory,
  onBack,
}: PlanChatPhaseProps) {
  const nodeId = `plan-${projectId}`
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [viewMode, setViewMode] = useState<"activity" | "trace">("activity")
  const viewModeAutoSwitched = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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

  // Plan data — select full array, filter in useMemo to avoid unstable getSnapshot
  const allPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => allPlanNodes.filter((n) => n.projectId === projectId), [allPlanNodes, projectId])

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

  // Auto-switch to trace view only if restoration also returned empty (legacy executions)
  useEffect(() => {
    if (!isRunning && !isRestoring && activityEvents.length === 0 && execution?.executionId && !viewModeAutoSwitched.current) {
      viewModeAutoSwitched.current = true
      setViewMode("trace")
    }
  }, [isRunning, isRestoring, activityEvents.length, execution?.executionId])

  // Group events for display
  const displayBlocks = useMemo(() => groupActivityEvents(activityEvents), [activityEvents])

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
    for (const event of activityEvents) {
      if (event.type === 'approval_response') {
        ids.add(event.requestId)
      }
    }
    return ids
  }, [activityEvents])

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
  const eventsLength = activityEvents.length
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

  // Send steer message (works for running sessions; stopped sessions get resumed)
  async function handleSend() {
    const text = input.trim()
    if (!text || sending) return

    setInput("")
    setSending(true)

    // Add steer message to realtime store for UI
    if (execution?.executionId) {
      addSteerMessage(execution.executionId, text)
    }

    try {
      await steerPlanSession(projectId, text)
    } finally {
      setSending(false)
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
      />
      {isFromPlayground && (
        <div className="px-4 py-1.5 border-b border-border bg-background shrink-0">
          <Badge variant="outline" className="text-[10px]">
            <Sparkles className="h-3 w-3 mr-1" /> From Playground
          </Badge>
        </div>
      )}

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
        </>
      )}

      {/* Input Bar — always visible for running sessions and resuming stopped ones */}
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
            placeholder={isRunning ? "Guide the planning session..." : "Send a message to resume..."}
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
    </div>
  )
}

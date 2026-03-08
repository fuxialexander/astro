import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { stripHtml } from "@/lib/html-utils"
import {
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowDown,
  Info,
  FolderOpen,
} from "lucide-react"
import { apiUrl } from "@/lib/api-url"
import { Button } from "@/components/ui/button"
import { FileCompletionTextarea } from "@/components/ui/file-completion-textarea"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { useRealtimeStore, type TaskStream } from "@/stores/realtime-store"
import { useProjectStore } from "@/stores/project-store"
import { useSessionStore } from "@/stores/session-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useUsageStore } from "@/stores/usage-store"
import { chatWithTask, fetchStreamingEventsCatchUp, replayChatCatchUpEvents } from "@/lib/api-client"
import { parseSSEStream } from "@/lib/sse-parser"
import { cn } from "@/lib/utils"
import type { PlanNode, TaskExecution, TaskActivityEvent } from "@/types"
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
  SummaryCard,
  GitHubCommentBlock,
  NewCommentComposer,
  BranchLinkedBlock,
  SystemPromptBlock,
  PlanGraphBlock,
} from "@/components/activity-blocks"
import { useGitHubCommentsStore } from "@/stores/github-comments-store"
import { InlineApprovalCard } from "@/components/plan-generation/inline-approval-card"
import { PrStatusCard } from "@/components/pr-status-card"
import type { PrData, PrCheckRun, PrReview } from "@/components/pr-status-card"
import { PRReviewThreads } from "@/components/pr-review-threads"
import { useRestoredExecution } from "@/hooks/use-restored-execution"
import { useChatStreamEvents } from "@/hooks/use-chat-stream-events"
import type { GitHubReviewThread } from "@/types"
import { FileBrowser } from "@/components/file-browser"
import { useMediaQuery } from "@/hooks/use-media-query"
import { projectWorktreePath, resolveFilePathForBrowsing } from "./file-path-utils"

const EMPTY_REVIEW_THREADS: GitHubReviewThread[] = []

interface UnifiedActivityViewProps {
  node: PlanNode
  projectId: string
  execution?: TaskExecution
  taskStream?: TaskStream
  isRunning: boolean
  executionId: string
  machineId: string
}

export function UnifiedActivityView({
  node,
  projectId,
  execution,
  taskStream,
  isRunning,
  executionId,
  machineId,
}: UnifiedActivityViewProps) {
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [pendingSteerText, setPendingSteerText] = useState<string | null>(null)
  const [isChatStreaming, setIsChatStreaming] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false)
  const [initialFilePath, setInitialFilePath] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isMobile = useMediaQuery("(max-width: 767px)")

  // Resizable file browser panel (desktop only)
  const [fileBrowserWidth, setFileBrowserWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("astro:fileBrowserWidth")
      if (stored) return Math.max(200, Math.min(500, parseInt(stored, 10)))
    }
    return 280
  })
  const isDraggingRef = useRef(false)
  const dragStartPosRef = useRef(0)
  const dragStartSizeRef = useRef(0)

  useEffect(() => {
    localStorage.setItem("astro:fileBrowserWidth", String(fileBrowserWidth))
  }, [fileBrowserWidth])

  useEffect(() => {
    const handleMove = (clientX: number) => {
      if (!isDraggingRef.current) return
      const delta = dragStartPosRef.current - clientX
      const maxW = Math.min(500, window.innerWidth * 0.5)
      setFileBrowserWidth(Math.max(200, Math.min(maxW, dragStartSizeRef.current + delta)))
    }
    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX)
    const handleTouchMove = (e: TouchEvent) => {
      if (isDraggingRef.current) e.preventDefault()
      handleMove(e.touches[0].clientX)
    }
    const handleEnd = () => { isDraggingRef.current = false }
    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleEnd)
    document.addEventListener("touchmove", handleTouchMove, { passive: false })
    document.addEventListener("touchend", handleEnd)
    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleEnd)
      document.removeEventListener("touchmove", handleTouchMove)
      document.removeEventListener("touchend", handleEnd)
    }
  }, [])
  const abortRef = useRef<AbortController | null>(null)
  /** Per-turn chat stream state for disconnect catch-up */
  const chatStreamRef = useRef<{ streamId: string; lastSeq: number }>({ streamId: '', lastSeq: 0 })

  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const githubOwner = project?.githubOwner
  const githubRepo = project?.githubRepo

  // GitHub comment context for reply functionality and new comment composer
  const githubCommentNumber = node.prNumber ?? node.githubIssueNumber
  const githubContext = useMemo(() => {
    if (githubOwner && githubRepo && githubCommentNumber) {
      return { owner: githubOwner, repo: githubRepo, number: githubCommentNumber }
    }
    return undefined
  }, [githubOwner, githubRepo, githubCommentNumber])

  // Subscribe to real-time GitHub comment stream
  const subscribeToStream = useGitHubCommentsStore((s) => s.subscribeToStream)
  useEffect(() => {
    if (!githubContext) return
    const cleanup = subscribeToStream(githubContext.owner, githubContext.repo, githubContext.number)
    return cleanup
  }, [githubContext, subscribeToStream])

  // Review threads for thread count in PrStatusCard
  const reviewThreadsKey = githubContext ? `${githubContext.owner}/${githubContext.repo}/${githubContext.number}` : ""
  const reviewThreadsRaw = useGitHubCommentsStore((s) => reviewThreadsKey ? s.reviewThreads[reviewThreadsKey] : undefined)
  const reviewThreads = reviewThreadsRaw ?? EMPTY_REVIEW_THREADS
  const reviewCommentCount = reviewThreads.reduce((sum, t) => sum + t.comments.length, 0)
  const [scrollToReviewThreadId] = useState<number | null>(null)

  const handleReviewCommentsClick = useCallback(() => {
    // Scroll to the review threads section
    const el = document.getElementById("pr-review-threads")
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [])

  const addSteerMessage = useRealtimeStore((s) => s.addSteerMessage)
  const updateSteerMessage = useRealtimeStore((s) => s.updateSteerMessage)
  const respondToDynamicApproval = useRealtimeStore((s) => s.respondToDynamicApproval)
  const model = useSettingsStore((s) => s.model)

  // Session store actions
  const sessionsLoaded = useSessionStore((s) => s.loaded)
  const createSessionAction = useSessionStore((s) => s.createSession)
  const addMessage = useSessionStore((s) => s.addMessage)
  const setProviderSessionId = useSessionStore((s) => s.setProviderSessionId)
  // Get or create task-chat session for this node — wait for sessions to load first
  const allSessions = useSessionStore((s) => s.sessions)
  const chatSession = useMemo(() => {
    let latest: ReturnType<typeof allSessions.get> | undefined
    for (const session of allSessions.values()) {
      if (session.nodeId === node.id && session.type === "task-chat") {
        if (!latest || session.createdAt > latest.createdAt) latest = session
      }
    }
    return latest
  }, [allSessions, node.id])

  // Ensure chat session exists
  useEffect(() => {
    if (sessionsLoaded && !chatSession) {
      createSessionAction({ type: "task-chat", projectId, nodeId: node.id })
    }
  }, [sessionsLoaded, chatSession, createSessionAction, node.id, projectId])

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

  // Restore chat events from persisted session messages after page refresh.
  // On a live session, chatEventsRef is populated by pushChatEvent during streaming.
  // After refresh, the ref is empty — reconstruct display events from the session
  // messages that were already saved to the DB via addMessage().
  useEffect(() => {
    if (!sessionsLoaded) return
    if (!chatSession) return
    if (chatEventsRef.current.length > 0) return // already populated (live session)
    const messages = chatSession.messages
    if (!messages || messages.length === 0) return

    const restoredChatEvents: TaskActivityEvent[] = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const ts = m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp)
        if (m.role === 'user') {
          return { type: 'chat_user' as const, message: m.content, timestamp: ts }
        } else {
          return { type: 'chat_assistant' as const, content: m.content, timestamp: ts }
        }
      })

    if (restoredChatEvents.length > 0) {
      chatEventsRef.current = restoredChatEvents
      flushChatEvents()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- chatEventsRef is a stable ref; sessionsLoaded+chatSession drive restoration
  }, [sessionsLoaded, chatSession, flushChatEvents])

  const allActivityEvents: TaskActivityEvent[] = useMemo(() => {
    void chatEventsVersion
    return [...activityEvents, ...chatEventsRef.current]
  // eslint-disable-next-line react-hooks/exhaustive-deps -- chatEventsRef is a stable ref
  }, [activityEvents, chatEventsVersion])

  // Group events for display
  const displayBlocks = useMemo(() => groupActivityEvents(allActivityEvents), [allActivityEvents])

  // Pre-build approval response lookup (answered set + response map) to avoid O(n) scans in render
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

  async function handleApprovalResponse(requestId: string, answer: string) {
    if (!executionId) return
    await respondToDynamicApproval(executionId, requestId, answer)
  }

  // Fallback: if no activity events, render plain text
  const outputText = execution?.streamText || taskStream?.stdout || node.executionOutput || ""
  const hasFallback = activityEvents.length === 0 && outputText.length > 0

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

  // Steer message handler (when running OR resuming a completed task)
  async function handleSteer(text: string, interrupt = false) {
    if (!text || sending) return
    setSending(true)
    setPendingSteerText(text)

    // Track in store (not yet in activity timeline — waits for ack)
    addSteerMessage(executionId, text, interrupt)
    const steerIndex = (taskStream?.steerMessages.length || 0)

    // Set 15s timeout
    const timeoutId = setTimeout(() => {
      updateSteerMessage(executionId, steerIndex, { accepted: false, ackMessage: "Timed out" })
      setPendingSteerText(null)
    }, 15000)

    try {
      const response = await fetch(apiUrl("/api/dispatch/steer"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: executionId,
          machineId,
          message: text,
          action: "guidance",
          interrupt,
          sessionId: execution?.sessionId,
          branchName: node.branchName || execution?.branchName,
        }),
      })

      if (!response.ok) {
        clearTimeout(timeoutId)
        setPendingSteerText(null)
        const errText = await response.text().catch(() => "Unknown error")
        updateSteerMessage(executionId, steerIndex, {
          accepted: false,
          ackMessage: `Failed: ${response.status} ${errText.slice(0, 100)}`,
        })
      } else {
        clearTimeout(timeoutId)
        setPendingSteerText(null)
        // Check if the response is an SSE stream (resumed session)
        const contentType = response.headers.get("content-type") || ""
        if (contentType.includes("text/event-stream")) {
          updateSteerMessage(executionId, steerIndex, {
            accepted: true,
            ackMessage: "Session resumed",
          })

          // Mark execution as running during resume
          const nodeId = node.id
          useExecutionStore.setState((state) => {
            const newExecutions = new Map(state.executions)
            const exec = newExecutions.get(nodeId)
            if (exec) {
              exec.status = "running"
              exec.completedAt = undefined
            }
            return { executions: newExecutions }
          })

          // Process the SSE stream to update execution state (with reconnection)
          let lastSeq = 0
          let streamCompleted = false

          /** Replay a single SSE event by type — shared between live stream and catch-up */
          const replayEvent = (event: string, data: string) => {
            switch (event) {
              case "text":
                useExecutionStore.getState().appendText(nodeId, data)
                break
              case "tool_use":
                try {
                  const parsed = JSON.parse(data)
                  const traceId = `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`
                  useExecutionStore.getState().addToolTrace(nodeId, {
                    id: traceId,
                    toolName: parsed.toolName,
                    toolInput: parsed.toolInput,
                    timestamp: new Date(),
                  })
                } catch { /* ignore */ }
                break
              case "tool_result":
                try {
                  const parsed = JSON.parse(data)
                  useExecutionStore.getState().updateToolTraceResult(
                    nodeId, parsed.toolName, parsed.result, parsed.success
                  )
                } catch { /* ignore */ }
                break
              case "file_change":
                try {
                  const parsed = JSON.parse(data)
                  useExecutionStore.getState().addFileChange(nodeId, {
                    path: parsed.path,
                    action: parsed.action || "modify",
                    linesAdded: parsed.linesAdded,
                    linesRemoved: parsed.linesRemoved,
                    diff: parsed.diff,
                    timestamp: new Date(),
                  })
                } catch { /* ignore */ }
                break
              case "result":
                try {
                  const parsed = JSON.parse(data)
                  streamCompleted = true
                  useExecutionStore.setState((state) => {
                    const newExecutions = new Map(state.executions)
                    const exec = newExecutions.get(nodeId)
                    if (exec) {
                      exec.status = (parsed.status === "success" || parsed.status === "completed") ? "success" : "failure"
                      exec.completedAt = new Date()
                      if (parsed.sessionId) exec.sessionId = parsed.sessionId
                    }
                    return { executions: newExecutions }
                  })
                } catch { /* ignore */ }
                break
              case "error":
                try {
                  const parsed = JSON.parse(data)
                  console.error("[steer] Resume error:", parsed.error)
                } catch { /* ignore */ }
                break
              case "done":
                streamCompleted = true
                break
              case "resumed":
              case "session_init":
              case "heartbeat":
              case "aborted":
                break
            }
          }

          try {
            await parseSSEStream(response, {
              onEvent: ({ event, data }) => replayEvent(event, data),
              onId: (id) => {
                const seq = parseInt(id, 10)
                if (!isNaN(seq) && seq > lastSeq) lastSeq = seq
              },
            })
          } catch (streamError) {
            // Stream errored — attempt catch-up if not a page unload
            if (streamCompleted) {
              // Already got terminal event, ignore trailing error
            } else if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
              // Page is unloading — task still runs server-side; skip failure marking
              console.log('[steer] SSE interrupted by page unload, skipping failure marking')
            } else {
              // Network drop mid-stream: catch up from persisted events
              console.warn('[steer] SSE stream error, attempting catch-up:', streamError)
              try {
                const { events } = await fetchStreamingEventsCatchUp(
                  [executionId],
                  lastSeq,
                )
                for (const row of events) {
                  const data = typeof row.data === 'string' ? row.data : JSON.stringify(row.data)
                  replayEvent(row.eventType, data)
                }
                if (events.length > 0) {
                  console.log(`[steer] Caught up ${events.length} events after stream error`)
                }
              } catch (catchUpError) {
                console.warn('[steer] Catch-up fetch also failed:', catchUpError)
              }
            }
          }
        } else {
          // JSON response — standard ack for active session injection
          updateSteerMessage(executionId, steerIndex, { accepted: true })
        }
      }
    } catch (error) {
      clearTimeout(timeoutId)
      setPendingSteerText(null)

      // Don't mark as failure if the page is unloading (refresh/navigate away)
      // — the task is still running server-side, catch-up will reconcile on reload
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        console.log('[steer] SSE interrupted by page unload, skipping failure marking')
      } else {
        updateSteerMessage(executionId, steerIndex, {
          accepted: false,
          ackMessage: `Failed: ${error instanceof Error ? error.message : "Network error"}`,
        })
      }
    } finally {
      setSending(false)
    }
  }

  // Chat message handler (when completed/idle)
  async function handleChat(text: string) {
    if (!text || isChatStreaming || !chatSession) return

    const sid = chatSession.id

    // Add user event for display
    pushChatEvent({ type: 'chat_user', message: text, timestamp: new Date() })

    // Store in session for conversation history (sent to backend on subsequent turns)
    addMessage(sid, { role: "user", content: text })

    // Generate a stable per-turn streamId for event persistence and catch-up
    const turnStreamId = `task-chat-${node.id}-${Date.now()}`
    chatStreamRef.current = { streamId: turnStreamId, lastSeq: 0 }

    setIsChatStreaming(true)
    abortRef.current = new AbortController()

    // Build message history from session
    const historyMessages = (chatSession.messages || [])
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content.length > 0))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

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
    try {
      // For the first chat turn, resume the execution's Claude session if available.
      // Subsequent turns use the chat session's own provider session ID.
      const resumeId = chatSession.providerSessionId || execution?.sessionId

      await chatWithTask(
        {
          message: text,
          sessionId: resumeId,
          streamId: turnStreamId,
          nodeId: node.id,
          projectId,
          taskTitle: node.title,
          taskDescription: node.content ? stripHtml(node.content) : (node.description || node.title || ""),
          taskOutput: outputText,
          visionDoc: project?.visionDoc,
          model,
          messages: historyMessages,
          branchName: execution?.branchName,
          prUrl: execution?.prUrl,
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
            chatStreamRef.current = { streamId: '', lastSeq: 0 }
            // Store full text in session for conversation history
            addMessage(sid, { role: "assistant", content: rawText })
            flushChatEvents()
            setIsChatStreaming(false)
          },
          onSeq: (seq) => {
            chatStreamRef.current.lastSeq = seq
          },
          onError: (error) => {
            chatStreamRef.current = { streamId: '', lastSeq: 0 }
            pushChatEvent({ type: 'error', error, timestamp: new Date() })
            flushChatEvents()
            setIsChatStreaming(false)
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
    } catch {
      // Attempt catch-up on network error
      const { streamId: catchUpStreamId, lastSeq } = chatStreamRef.current
      if (catchUpStreamId) {
        try {
          const { events } = await fetchStreamingEventsCatchUp([catchUpStreamId], lastSeq)
          if (events.length > 0) {
            const { completed } = replayChatCatchUpEvents(events, {
              onText: (chunk) => {
                rawText += chunk
                pushChatEvent({ type: 'text', content: chunk, timestamp: new Date() })
              },
              onToolUse: handleToolUse,
              onToolResult: handleToolResult,
              onDone: (newSessionId) => {
                if (newSessionId) setProviderSessionId(sid, newSessionId)
                addMessage(sid, { role: "assistant", content: rawText })
              },
            })
            if (completed) {
              chatStreamRef.current = { streamId: '', lastSeq: 0 }
            }
          } else {
            pushChatEvent({ type: 'error', error: 'Connection lost during chat', timestamp: new Date() })
          }
        } catch {
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

  // Allow steering on completed local tasks (resume session in worktree)
  const canSteer = isRunning || (machineId === "local" && execution?.status === "success")

  function handleSend(interrupt = false) {
    const text = input.trim()
    if (!text) return
    setInput("")

    if (canSteer) {
      handleSteer(text, interrupt)
    } else {
      handleChat(text)
    }
  }

  const isInputDisabled = sending || isChatStreaming

  // Derive working directory for file browser from project.
  // Prefer the persistent project worktree (.astro/worktrees/{id}/) when a
  // project branch exists — this has all merged task work on a detached HEAD,
  // unlike the base working directory which stays on main/default branch.
  const baseWorkDir = project?.workingDirectory || ""
  const fileBrowserDir = useMemo(() => {
    if (baseWorkDir && project?.projectBranch) {
      return projectWorktreePath(baseWorkDir, project.projectBranch)
    }
    return baseWorkDir
  }, [baseWorkDir, project?.projectBranch])

  // Handler for FileChangeBlock clicks — opens FileBrowser and navigates to file
  const handleFileSelect = useCallback((filePath: string) => {
    const resolved = resolveFilePathForBrowsing(filePath, fileBrowserDir)
    setInitialFilePath(resolved)
    setFileBrowserOpen(true)
  }, [fileBrowserDir])

  return (
    <div className="flex h-full">
    <div className="flex flex-col flex-1 min-w-0 relative">
      {/* File browser toggle */}
      {machineId && fileBrowserDir && (
        <div className="absolute top-2 right-2 z-10">
          <Button
            variant={fileBrowserOpen ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setFileBrowserOpen(!fileBrowserOpen)}
            title={fileBrowserOpen ? "Close file browser" : "Open file browser"}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Timeline */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto py-3 bg-muted/20"
      >
        {/* Summary card at top when available */}
        {execution?.summary && (
          <SummaryCard summary={execution.summary} />
        )}

        {/* Auto-show PR card when node has a prNumber and no pr_status block in feed */}
        {node.prNumber && !displayBlocks.some(b => b.type === 'pr_status') && (
          <PrStatusCard
            node={node}
            owner={githubOwner}
            repo={githubRepo}
            reviewCommentCount={reviewCommentCount}
            onReviewCommentsClick={handleReviewCommentsClick}
          />
        )}

        {/* Fallback for old tasks without activity events */}
        {hasFallback && (
          <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground px-4 py-2">
            {outputText}
          </pre>
        )}

        {/* Empty state */}
        {!hasFallback && displayBlocks.length === 0 && (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {isRunning ? "Waiting for output..." : isRestoring ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading activity...
              </span>
            ) : "No output available"}
          </div>
        )}

        {/* Activity event blocks */}
        {displayBlocks.map((block, i) => {
          switch (block.type) {
            case 'text':
              return <TextBlock key={i} events={block.events} />
            case 'tool':
              return <ToolBlock key={i} events={block.events} isRunning={isRunning || isChatStreaming} />
            case 'tool_group':
              return <ToolGroupBlock key={i} events={block.events} isRunning={isRunning || isChatStreaming} />
            case 'steer':
              return <SteerBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'steer' }>} />
            case 'file_change':
              return <FileChangeBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'file_change' }>} onFileSelect={machineId && fileBrowserDir ? handleFileSelect : undefined} />
            case 'error':
              return <ErrorBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'error' }>} />
            case 'chat_user':
              return <ChatUserBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'chat_user' }>} onEdit={!isRunning && !isChatStreaming ? (msg) => setInput(msg) : undefined} />
            case 'chat_assistant':
              return <ChatAssistantBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'chat_assistant' }>} />
            case 'approval_request': {
              const event = block.events[0] as Extract<TaskActivityEvent, { type: 'approval_request' }>
              const isAnswered = answeredRequestIds.has(event.requestId)
              const responseEvent = approvalResponseMap.get(event.requestId)
              return (
                <InlineApprovalCard
                  key={i}
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
            case 'pr_status': {
              const prEvent = block.events[0] as Extract<TaskActivityEvent, { type: 'pr_status' }>
              const prDataFromEvent: PrData = {
                title: prEvent.title || `PR #${prEvent.prNumber}`,
                number: prEvent.prNumber,
                state: prEvent.state || 'open',
                htmlUrl: prEvent.prUrl,
                branchName: prEvent.branchName,
                baseBranch: prEvent.baseBranch,
                additions: prEvent.additions,
                deletions: prEvent.deletions,
                changedFiles: prEvent.changedFiles,
                draft: prEvent.draft,
                checks: (prEvent.checks || []).map(c => ({
                  name: c.name,
                  status: c.status as PrCheckRun["status"],
                  conclusion: c.conclusion as PrCheckRun["conclusion"],
                  startedAt: c.startedAt,
                  completedAt: c.completedAt,
                  htmlUrl: c.htmlUrl,
                })),
                reviews: (prEvent.reviews || []).map(r => ({
                  user: r.user,
                  state: r.state as PrReview["state"],
                  submittedAt: r.submittedAt,
                })),
              }
              return (
                <PrStatusCard
                  key={i}
                  node={node}
                  prData={prDataFromEvent}
                  owner={githubOwner}
                  repo={githubRepo}
                  reviewCommentCount={reviewCommentCount}
                  onReviewCommentsClick={handleReviewCommentsClick}
                />
              )
            }
            case 'github_comment':
              return <GitHubCommentBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'github_comment' }>} githubContext={githubContext} />
            case 'branch_linked':
              return <BranchLinkedBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'branch_linked' }>} />
            case 'system_prompt':
              return <SystemPromptBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'system_prompt' }>} />
            case 'plan_result':
              return <PlanGraphBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'plan_result' }>} />
            default:
              return null
          }
        })}

        {/* Streaming cursor */}
        {isRunning && activityEvents.length > 0 && (
          <span className="px-4 animate-pulse text-info text-xs font-mono">|</span>
        )}

        {/* Pending steer: message queued, waiting for agent ack */}
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

        {/* Chat streaming indicator (post-completion thinking) */}
        {isChatStreaming && (
          <div className="flex items-center gap-2 px-4 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Thinking...</span>
          </div>
        )}

        {/* PR Review Comment Threads — shown when node has a linked PR */}
        {githubContext && node.prNumber && (
          <PRReviewThreads
            owner={githubContext.owner}
            repo={githubContext.repo}
            prNumber={githubContext.number}
            scrollToThreadId={scrollToReviewThreadId}
          />
        )}

        {/* New GitHub comment composer — shown when there's a linked issue/PR */}
        {githubContext && displayBlocks.some(b => b.type === 'github_comment') && (
          <NewCommentComposer githubContext={githubContext} />
        )}

        {/* Completion footer */}
        {!isRunning && (execution?.status === "success" || execution?.status === "failure") && activityEvents.length > 0 && (
          <div className={cn(
            "flex items-center gap-2 mx-4 my-3 px-3 py-2 rounded-lg border text-xs font-medium",
            execution.status === "success"
              ? "border-success/30 bg-success/5 text-success"
              : "border-error/30 bg-error/5 text-error"
          )}>
            {execution.status === "success" ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <XCircle className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>
              {execution.status === "success"
                ? "Execution completed successfully"
                : "Execution failed"}
            </span>
            {execution.fileChanges.length > 0 && (
              <>
                <span className="opacity-50">&middot;</span>
                <span className="opacity-70">{execution.fileChanges.length} file{execution.fileChanges.length !== 1 ? "s" : ""} changed</span>
              </>
            )}
            {execution.startedAt && execution.completedAt && (
              <>
                <span className="opacity-50">&middot;</span>
                <span className="opacity-70 tabular-nums">
                  {(() => {
                    const ms = new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime()
                    if (ms < 60_000) return `${Math.round(ms / 1000)}s`
                    const m = Math.floor(ms / 60_000)
                    const s = Math.round((ms % 60_000) / 1000)
                    return `${m}m ${s}s`
                  })()}
                </span>
              </>
            )}
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

      {/* Input Bar */}
      <div className="border-t border-border bg-background shrink-0">
      {/* Resumed session notice */}
      {!isRunning && !canSteer && execution?.sessionId && (
        <div className="px-3 pt-2 pb-0 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Info className="h-3 w-3 shrink-0" />
          <span>
            Follow-up chat{execution.branchName ? ` — changes on \`${execution.branchName}\`` : ''}{execution.prUrl ? ` — ` : ''}
          </span>
          {execution.prUrl && (
            <a href={execution.prUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
              View PR
            </a>
          )}
        </div>
      )}
      {isRunning && (
        <div className="px-3 pt-2 pb-0">
          <span className="text-[10px] text-muted-foreground">
            ⌘+Enter to send · Shift+Enter to interrupt
          </span>
        </div>
      )}
      <div className="flex items-end gap-2 p-3 pt-1.5">
        <FileCompletionTextarea
          projectId={projectId}
          machineId={machineId || project?.defaultMachineId}
          workingDirectory={project?.workingDirectory}
          fileTree={project?.fileTree}
          value={input}
          onChange={setInput}
          onSubmit={(opts) => handleSend(opts?.interrupt ?? false)}
          placeholder={
            canSteer
              ? isRunning
                ? "Steer the agent... (type @ to reference files)"
                : "Resume session in worktree... (type @ to reference files)"
              : "Ask about this task... (type @ to reference files)"
          }
          rows={1}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={(e) => handleSend(e.shiftKey)}
          disabled={!input.trim() || isInputDisabled}
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

    {/* File Browser Sidebar — Desktop: resizable inline panel, Mobile: bottom Sheet */}
    {fileBrowserOpen && machineId && fileBrowserDir && !isMobile && (
      <div className="relative shrink-0 flex border-l border-border" style={{ width: fileBrowserWidth }}>
        {/* Drag handle */}
        <div
          className="w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 shrink-0 touch-none"
          onMouseDown={(e) => {
            isDraggingRef.current = true
            dragStartPosRef.current = e.clientX
            dragStartSizeRef.current = fileBrowserWidth
          }}
          onTouchStart={(e) => {
            isDraggingRef.current = true
            dragStartPosRef.current = e.touches[0].clientX
            dragStartSizeRef.current = fileBrowserWidth
          }}
        />
        <FileBrowser
          machineId={machineId}
          workingDirectory={fileBrowserDir}
          embedded
          onClose={() => { setFileBrowserOpen(false); setInitialFilePath(null) }}
          initialFilePath={initialFilePath}
        />
      </div>
    )}
    {isMobile && machineId && fileBrowserDir && (
      <Sheet open={fileBrowserOpen} onOpenChange={(open) => { setFileBrowserOpen(open); if (!open) setInitialFilePath(null) }}>
        <SheetContent side="bottom" className="h-[70vh] p-0">
          <FileBrowser
            machineId={machineId}
            workingDirectory={fileBrowserDir}
            embedded
            onClose={() => { setFileBrowserOpen(false); setInitialFilePath(null) }}
            initialFilePath={initialFilePath}
          />
        </SheetContent>
      </Sheet>
    )}
    </div>
  )
}

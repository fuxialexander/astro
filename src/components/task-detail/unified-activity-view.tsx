import { useState, useRef, useEffect, useMemo } from "react"
import { stripHtml } from "@/lib/html-utils"
import {
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowDown,
} from "lucide-react"
import { apiUrl } from "@/lib/api-url"
import { Button } from "@/components/ui/button"
import { FileCompletionTextarea } from "@/components/ui/file-completion-textarea"
import { useRealtimeStore, type TaskStream } from "@/stores/realtime-store"
import { useProjectStore } from "@/stores/project-store"
import { useSessionStore } from "@/stores/session-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useExecutionStore } from "@/stores/execution-store"
import { chatWithTask } from "@/lib/api-client"
import { parseSSEStream } from "@/lib/sse-parser"
import { cn } from "@/lib/utils"
import type { PlanNode, TaskExecution, TaskActivityEvent } from "@/types"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
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
} from "@/components/activity-blocks"
import { useRestoredExecution } from "@/hooks/use-restored-execution"

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
  const [isChatStreaming, setIsChatStreaming] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const addSteerMessage = useRealtimeStore((s) => s.addSteerMessage)
  const updateSteerMessage = useRealtimeStore((s) => s.updateSteerMessage)
  const model = useSettingsStore((s) => s.model)

  // Session store actions
  const createSessionAction = useSessionStore((s) => s.createSession)
  const addMessage = useSessionStore((s) => s.addMessage)
  const appendToLastAssistantMessage = useSessionStore((s) => s.appendToLastAssistantMessage)
  const updateLastAssistantMessage = useSessionStore((s) => s.updateLastAssistantMessage)
  const setProviderSessionId = useSessionStore((s) => s.setProviderSessionId)
  const getSessionsForNode = useSessionStore((s) => s.getSessionsForNode)

  // Get or create task-chat session for this node
  const taskChatSessions = getSessionsForNode(node.id, "task-chat")
  const chatSession = taskChatSessions[taskChatSessions.length - 1]

  // Ensure chat session exists
  useEffect(() => {
    if (!chatSession) {
      createSessionAction({ type: "task-chat", projectId, nodeId: node.id })
    }
  }, [chatSession, createSessionAction, node.id, projectId])

  // Get activity events — live during execution, restored from observations after refresh
  const { activityEvents, isRestoring } = useRestoredExecution(
    executionId,
    execution,
    taskStream,
    isRunning,
  )

  // Include chat messages as activity events for completed tasks
  const chatMessages = useMemo(() => chatSession?.messages || [], [chatSession?.messages])
  const allActivityEvents: TaskActivityEvent[] = useMemo(() => {
    const chatEvents: TaskActivityEvent[] = chatMessages.map(msg => ({
      type: msg.role === 'user' ? 'chat_user' as const : 'chat_assistant' as const,
      ...(msg.role === 'user' ? { message: msg.content } : { content: msg.content }),
      timestamp: msg.timestamp || new Date(),
    })) as TaskActivityEvent[]
    return [...activityEvents, ...chatEvents]
  }, [activityEvents, chatMessages])

  // Group events for display
  const displayBlocks = useMemo(() => groupActivityEvents(allActivityEvents), [allActivityEvents])

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

    // Add message to store immediately for UI
    addSteerMessage(executionId, text, interrupt)
    const steerIndex = (taskStream?.steerMessages.length || 0)

    // Set 15s timeout
    const timeoutId = setTimeout(() => {
      updateSteerMessage(executionId, steerIndex, { accepted: false, ackMessage: "Timed out" })
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
        const errText = await response.text().catch(() => "Unknown error")
        updateSteerMessage(executionId, steerIndex, {
          accepted: false,
          ackMessage: `Failed: ${response.status} ${errText.slice(0, 100)}`,
        })
      } else {
        clearTimeout(timeoutId)
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

          // Process the SSE stream to update execution state
          await parseSSEStream(response, {
            onEvent: ({ event, data }) => {
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
                    useExecutionStore.setState((state) => {
                      const newExecutions = new Map(state.executions)
                      const exec = newExecutions.get(nodeId)
                      if (exec) {
                        exec.status = parsed.status === "success" ? "success" : "failure"
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
                case "resumed":
                case "session_init":
                case "done":
                case "heartbeat":
                case "aborted":
                  break
              }
            },
          })
        } else {
          // JSON response — standard ack for active session injection
          updateSteerMessage(executionId, steerIndex, { accepted: true })
        }
      }
    } catch (error) {
      clearTimeout(timeoutId)
      updateSteerMessage(executionId, steerIndex, {
        accepted: false,
        ackMessage: `Failed: ${error instanceof Error ? error.message : "Network error"}`,
      })
    } finally {
      setSending(false)
    }
  }

  // Chat message handler (when completed/idle)
  async function handleChat(text: string) {
    if (!text || isChatStreaming || !chatSession) return

    const sid = chatSession.id
    addMessage(sid, { role: "user", content: text })
    addMessage(sid, { role: "assistant", content: "" })

    setIsChatStreaming(true)
    abortRef.current = new AbortController()

    // Build message history from session
    const historyMessages = (chatSession.messages || [])
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content.length > 0))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

    let rawText = ""
    try {
      await chatWithTask(
        {
          message: text,
          sessionId: chatSession.providerSessionId,
          nodeId: node.id,
          projectId,
          taskTitle: node.title,
          taskDescription: node.content ? stripHtml(node.content) : node.description,
          taskOutput: outputText,
          visionDoc: project?.visionDoc,
          model,
          messages: historyMessages,
        },
        {
          onText: (chunk) => { rawText += chunk; appendToLastAssistantMessage(sid, chunk) },
          onDone: (newSessionId) => {
            if (newSessionId) setProviderSessionId(sid, newSessionId)
            // Force immediate save — appendToLastAssistantMessage only debounce-saves
            updateLastAssistantMessage(sid, rawText)
            setIsChatStreaming(false)
          },
          onError: (error) => {
            appendToLastAssistantMessage(sid, `\n\nError: ${error}`)
            setIsChatStreaming(false)
          },
        },
        abortRef.current.signal,
      )
    } catch {
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

  return (
    <div className="flex flex-col h-full relative">
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

        {/* Fallback for old tasks without activity events */}
        {hasFallback && chatMessages.length === 0 && (
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

        {/* Fallback text + chat messages (old tasks) */}
        {hasFallback && chatMessages.length > 0 && (
          <>
            <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground px-4 py-2">
              {outputText}
            </pre>
            <div className="border-t border-border my-2" />
            {chatMessages.map((msg) => (
              <div key={msg.id}>
                {msg.role === 'user' ? (
                  <div className="flex flex-col items-end gap-1 px-4 py-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">You</span>
                    <div className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground max-w-[80%]">
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-1 px-4 py-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Claude</span>
                    <div className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground max-w-[90%]">
                      <MarkdownRenderer
                        content={msg.content || (isChatStreaming && msg.role === "assistant" ? "..." : "")}
                        className="font-secondary text-sm leading-relaxed"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {/* Activity event blocks */}
        {displayBlocks.map((block, i) => {
          switch (block.type) {
            case 'text':
              return <TextBlock key={i} events={block.events} />
            case 'tool':
              return <ToolBlock key={i} events={block.events} isRunning={isRunning} />
            case 'tool_group':
              return <ToolGroupBlock key={i} events={block.events} isRunning={isRunning} />
            case 'steer':
              return <SteerBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'steer' }>} />
            case 'file_change':
              return <FileChangeBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'file_change' }>} />
            case 'error':
              return <ErrorBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'error' }>} />
            case 'chat_user':
              return <ChatUserBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'chat_user' }>} />
            case 'chat_assistant':
              return <ChatAssistantBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'chat_assistant' }>} />
            default:
              return null
          }
        })}

        {/* Streaming cursor */}
        {isRunning && activityEvents.length > 0 && (
          <span className="px-4 animate-pulse text-info text-xs font-mono">|</span>
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
      {isRunning && (
        <div className="px-3 pt-2 pb-0">
          <span className="text-[10px] text-muted-foreground">
            Enter to queue · Shift+Enter to interrupt
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
  )
}

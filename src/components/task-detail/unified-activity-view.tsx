import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import {
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Wrench,
  FileEdit,
  ArrowDown,
  AlertCircle,
  Plus,
  Minus,
  Zap,
} from "lucide-react"
import { apiUrl } from "@/lib/api-url"
import { Button } from "@/components/ui/button"
import { VoiceInputButton } from "@/components/ui/voice-input-button"
import { FileCompletionTextarea } from "@/components/ui/file-completion-textarea"
import { useRealtimeStore, type TaskStream } from "@/stores/realtime-store"
import { useProjectStore } from "@/stores/project-store"
import { useSessionStore } from "@/stores/session-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useVoiceTranscription } from "@/hooks/use-voice-transcription"
import { chatWithTask } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import type { PlanNode, TaskExecution, TaskActivityEvent, ExecutionSummary } from "@/types"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"

interface UnifiedActivityViewProps {
  node: PlanNode
  projectId: string
  execution?: TaskExecution
  taskStream?: TaskStream
  isRunning: boolean
  executionId: string
  machineId: string
}

// Group adjacent text events into single blocks
interface DisplayBlock {
  type: 'text' | 'tool' | 'steer' | 'file_change' | 'error' | 'chat_user' | 'chat_assistant'
  events: TaskActivityEvent[]
}

function groupActivityEvents(events: TaskActivityEvent[]): DisplayBlock[] {
  const blocks: DisplayBlock[] = []
  let currentTextEvents: TaskActivityEvent[] = []

  function flushText() {
    if (currentTextEvents.length > 0) {
      blocks.push({ type: 'text', events: [...currentTextEvents] })
      currentTextEvents = []
    }
  }

  for (const event of events) {
    switch (event.type) {
      case 'text':
        currentTextEvents.push(event)
        break
      case 'tool_use':
        flushText()
        // Find matching tool_result in remaining events
        blocks.push({ type: 'tool', events: [event] })
        break
      case 'tool_result': {
        // Merge into last tool block if matching
        const lastBlock = blocks[blocks.length - 1]
        if (lastBlock?.type === 'tool' && lastBlock.events[0].type === 'tool_use' && lastBlock.events[0].id === event.id) {
          lastBlock.events.push(event)
        } else {
          blocks.push({ type: 'tool', events: [event] })
        }
        break
      }
      case 'steer':
        flushText()
        blocks.push({ type: 'steer', events: [event] })
        break
      case 'file_change':
        flushText()
        blocks.push({ type: 'file_change', events: [event] })
        break
      case 'error':
        flushText()
        blocks.push({ type: 'error', events: [event] })
        break
      case 'chat_user':
        flushText()
        blocks.push({ type: 'chat_user', events: [event] })
        break
      case 'chat_assistant':
        flushText()
        blocks.push({ type: 'chat_assistant', events: [event] })
        break
    }
  }

  flushText()
  return blocks
}

function TextBlock({ events }: { events: TaskActivityEvent[] }) {
  const text = events
    .filter((e): e is Extract<TaskActivityEvent, { type: 'text' }> => e.type === 'text')
    .map(e => e.content)
    .join('')

  if (!text) return null

  return (
    <div className="px-4 py-1">
      <MarkdownRenderer content={text} className="text-xs leading-relaxed" />
    </div>
  )
}

function ToolBlock({ events }: { events: TaskActivityEvent[] }) {
  const [expanded, setExpanded] = useState(false)
  const toolUse = events.find((e): e is Extract<TaskActivityEvent, { type: 'tool_use' }> => e.type === 'tool_use')
  const toolResult = events.find((e): e is Extract<TaskActivityEvent, { type: 'tool_result' }> => e.type === 'tool_result')

  if (!toolUse) return null

  const isComplete = toolResult !== undefined
  const success = toolResult?.success

  return (
    <div className="mx-4 my-1.5 rounded-lg border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <div className={cn(
          "flex h-5 w-5 items-center justify-center rounded-full shrink-0",
          success === false
            ? "bg-red-500/10 text-red-500"
            : success === true
              ? "bg-green-500/10 text-green-500"
              : isComplete
                ? "bg-muted text-muted-foreground"
                : "bg-blue-500/10 text-blue-500"
        )}>
          {!isComplete ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : success === true ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : success === false ? (
            <XCircle className="h-3 w-3" />
          ) : (
            <Wrench className="h-3 w-3" />
          )}
        </div>
        <span className="text-xs font-medium font-mono flex-1 truncate">{toolUse.toolName}</span>
        {toolResult?.duration != null && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
            <Clock className="h-2.5 w-2.5" />
            {toolResult.duration}ms
          </span>
        )}
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2 flex flex-col gap-2">
          {toolUse.toolInput != null && (
            <div className="rounded-md bg-muted p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Input</p>
              <pre className="font-mono text-xs whitespace-pre-wrap break-all text-foreground max-h-[200px] overflow-auto">
                {typeof toolUse.toolInput === "string"
                  ? toolUse.toolInput
                  : JSON.stringify(toolUse.toolInput, null, 2)}
              </pre>
            </div>
          )}
          {toolResult?.toolResult != null && (
            <div className="rounded-md bg-muted p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Result</p>
              <pre className="font-mono text-xs whitespace-pre-wrap break-all text-foreground max-h-[200px] overflow-auto">
                {typeof toolResult.toolResult === "string"
                  ? toolResult.toolResult
                  : JSON.stringify(toolResult.toolResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SteerBlock({ event }: { event: Extract<TaskActivityEvent, { type: 'steer' }> }) {
  const isInterrupted = event.interrupted === true

  return (
    <div className="flex flex-col items-end gap-1 px-4 py-1.5">
      <div className={cn(
        "rounded-lg px-3 py-2 text-sm max-w-[80%]",
        isInterrupted
          ? "bg-orange-500 text-white"
          : "bg-primary text-primary-foreground"
      )}>
        <div className="flex items-center gap-1.5">
          {isInterrupted && <Zap className="h-3.5 w-3.5 shrink-0" />}
          <p className="whitespace-pre-wrap">{event.message}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {event.accepted === true && (
          <>
            <CheckCircle2 className="h-3 w-3 text-green-500" />
            <span className="text-[10px] text-green-600">
              {isInterrupted ? "Interrupted" : "Queued"}
            </span>
          </>
        )}
        {event.accepted === false && (
          <>
            <XCircle className="h-3 w-3 text-red-500" />
            <span className="text-[10px] text-red-600">{event.ackMessage || "Failed"}</span>
          </>
        )}
        {event.accepted === undefined && (
          <>
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Sending...</span>
          </>
        )}
      </div>
    </div>
  )
}

function FileChangeBlock({ event }: { event: Extract<TaskActivityEvent, { type: 'file_change' }> }) {
  const filename = event.path.split('/').pop() || event.path

  return (
    <div className="flex items-center gap-2 mx-4 my-1 px-3 py-1.5 rounded-md bg-muted/50 text-xs text-muted-foreground">
      <FileEdit className="h-3 w-3 shrink-0" />
      <span className="font-medium text-foreground">{filename}</span>
      <span className="truncate">{event.path}</span>
      {event.linesAdded != null && event.linesAdded > 0 && (
        <span className="flex items-center gap-0.5 text-green-600 font-mono shrink-0">
          <Plus className="h-2.5 w-2.5" />{event.linesAdded}
        </span>
      )}
      {event.linesRemoved != null && event.linesRemoved > 0 && (
        <span className="flex items-center gap-0.5 text-red-600 font-mono shrink-0">
          <Minus className="h-2.5 w-2.5" />{event.linesRemoved}
        </span>
      )}
    </div>
  )
}

function SummaryCard({ summary }: { summary: ExecutionSummary }) {
  const statusColor = summary.status === 'success'
    ? 'border-green-500/30 bg-green-500/5'
    : summary.status === 'partial'
      ? 'border-yellow-500/30 bg-yellow-500/5'
      : 'border-red-500/30 bg-red-500/5'

  const statusBadge = summary.status === 'success'
    ? 'bg-green-500/10 text-green-600'
    : summary.status === 'partial'
      ? 'bg-yellow-500/10 text-yellow-600'
      : 'bg-red-500/10 text-red-600'

  return (
    <div className={cn("mx-4 my-2 rounded-lg border p-3", statusColor)}>
      <div className="flex items-start gap-2">
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold">Summary</span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", statusBadge)}>
              {summary.status}
            </span>
            {summary.filesChanged.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {summary.filesChanged.length} file{summary.filesChanged.length !== 1 ? 's' : ''} changed
              </span>
            )}
          </div>
          <p className="text-sm text-foreground leading-relaxed">{summary.workCompleted}</p>
          {summary.followUps.length > 0 && (
            <div className="mt-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Follow-ups</span>
              <ul className="mt-0.5">
                {summary.followUps.map((f, i) => (
                  <li key={i} className="text-xs text-muted-foreground">- {f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ErrorBlock({ event }: { event: Extract<TaskActivityEvent, { type: 'error' }> }) {
  return (
    <div className="flex items-start gap-2 mx-4 my-1.5 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-sm text-red-600">
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
      <pre className="font-mono text-xs whitespace-pre-wrap break-all">{event.error}</pre>
    </div>
  )
}

function ChatUserBlock({ event }: { event: Extract<TaskActivityEvent, { type: 'chat_user' }> }) {
  return (
    <div className="flex flex-col items-end gap-1 px-4 py-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">You</span>
      <div className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground max-w-[80%]">
        <p className="whitespace-pre-wrap">{event.message}</p>
      </div>
    </div>
  )
}

function ChatAssistantBlock({ event }: { event: Extract<TaskActivityEvent, { type: 'chat_assistant' }> }) {
  return (
    <div className="flex flex-col items-start gap-1 px-4 py-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Claude</span>
      <div className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground max-w-[90%]">
        <MarkdownRenderer content={event.content} className="font-secondary text-sm leading-relaxed" />
      </div>
    </div>
  )
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

  // Voice transcription
  const handleTranscript = useCallback((text: string) => {
    setInput((prev) => prev.trim() ? prev.trim() + " " + text : text)
  }, [])

  const {
    isRecording,
    isTranscribing,
    isAvailable,
    duration,
    toggleRecording,
  } = useVoiceTranscription({ onTranscript: handleTranscript })

  // Merge activity events from execution store + realtime store
  // Execution store has text/tool/file events from local dispatch SSE.
  // Realtime store has those from relay AND steer messages (user-sent).
  // We need both: use exec events as base when available, then merge in
  // steer events from realtime that only exist there.
  const activityEvents: TaskActivityEvent[] = useMemo(() => {
    const execEvents = execution?.activityEvents || []
    const streamEvents = taskStream?.activityEvents || []

    if (execEvents.length === 0) return streamEvents
    if (streamEvents.length === 0) return execEvents

    // Extract steer events from realtime stream (these are only in the stream)
    const steerEvents = streamEvents.filter(e => e.type === 'steer')
    if (steerEvents.length === 0) return execEvents

    // Merge exec events + steer events sorted by timestamp
    const merged = [...execEvents, ...steerEvents]
    merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    return merged
  }, [execution?.activityEvents, taskStream?.activityEvents])

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

  // Steer message handler (when running)
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
        // Server responded OK; ack will arrive via SSE; timeout will handle if it doesn't
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

    try {
      await chatWithTask(
        {
          message: text,
          sessionId: chatSession.providerSessionId,
          nodeId: node.id,
          projectId,
          taskTitle: node.title,
          taskDescription: node.description,
          taskOutput: outputText,
          visionDoc: project?.visionDoc,
          model,
          messages: historyMessages,
        },
        {
          onText: (chunk) => appendToLastAssistantMessage(sid, chunk),
          onDone: (newSessionId) => {
            if (newSessionId) setProviderSessionId(sid, newSessionId)
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

  function handleSend(interrupt = false) {
    const text = input.trim()
    if (!text) return
    setInput("")

    if (isRunning) {
      handleSteer(text, interrupt)
    } else {
      handleChat(text)
    }
  }

  const isInputDisabled = sending || isChatStreaming || isRecording || isTranscribing

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
            {isRunning ? "Waiting for output..." : "No output available"}
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
              return <ToolBlock key={i} events={block.events} />
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
          <span className="px-4 animate-pulse text-blue-500 text-xs font-mono">|</span>
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
        <VoiceInputButton
          isRecording={isRecording}
          isTranscribing={isTranscribing}
          isAvailable={isAvailable}
          duration={duration}
          onClick={toggleRecording}
          disabled={sending || isChatStreaming}
          className="h-9 w-9 shrink-0"
        />
        <FileCompletionTextarea
          projectId={projectId}
          machineId={machineId || project?.defaultMachineId}
          workingDirectory={project?.workingDirectory}
          fileTree={project?.fileTree}
          value={input}
          onChange={setInput}
          onSubmit={(opts) => handleSend(opts?.interrupt ?? false)}
          placeholder={
            isRecording
              ? "Listening..."
              : isTranscribing
                ? "Transcribing..."
                : isRunning
                  ? "Steer the agent... (type @ to reference files)"
                  : "Ask about this task... (type @ to reference files)"
          }
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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

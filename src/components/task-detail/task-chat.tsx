import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { stripHtml } from "@/lib/html-utils"
import { Send, Loader2, Trash2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FileCompletionTextarea } from "@/components/ui/file-completion-textarea"
import { TypingIndicator } from "@/components/ui/typing-indicator"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { chatWithTask, fetchSlashCommands, fetchStreamingEventsCatchUp, replayChatCatchUpEvents } from "@/lib/api-client"
import { useSessionStore } from "@/stores/session-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useProjectMachineId } from "@/hooks/use-project-machine"
import type { SlashCommand, MentionItem } from "@/components/ui/file-completion-textarea"
import type { PlanNode } from "@/types"

interface TaskChatProps {
  node: PlanNode
  projectId: string
  visionDoc?: string
  taskOutput?: string
}

export function TaskChat({ node, projectId, visionDoc, taskOutput }: TaskChatProps) {
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** Tracks per-turn streamId and last-seen seq for disconnect catch-up */
  const chatStreamRef = useRef<{ streamId: string; lastSeq: number }>({ streamId: '', lastSeq: 0 })
  const model = useSettingsStore((s) => s.model)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const resolvedMachineId = useProjectMachineId(project)

  // Session store actions
  const createSession = useSessionStore((s) => s.createSession)
  const addMessage = useSessionStore((s) => s.addMessage)
  const appendToLastAssistantMessage = useSessionStore((s) => s.appendToLastAssistantMessage)
  const updateLastAssistantMessage = useSessionStore((s) => s.updateLastAssistantMessage)
  const setProviderSessionId = useSessionStore((s) => s.setProviderSessionId)
  const clearSessionsForNode = useSessionStore((s) => s.clearSessionsForNode)
  const allSessions = useSessionStore((s) => s.sessions)

  const planNodes = usePlanStore((s) => s.nodes)
  const mentionItems: MentionItem[] = useMemo(() => {
    return planNodes
      .filter((n) => n.projectId === projectId)
      .map((n) => ({
        id: n.id,
        label: n.title,
        detail: n.type,
        kind: n.type === "milestone" ? "milestone" as const : "task" as const,
      }))
  }, [planNodes, projectId])

  // Slash commands from connected machine
  const [slashCmds, setSlashCmds] = useState<SlashCommand[]>([])
  useEffect(() => {
    if (!resolvedMachineId) return
    fetchSlashCommands(resolvedMachineId, project?.workingDirectory).then(setSlashCmds).catch(() => {})
  }, [resolvedMachineId, project?.workingDirectory])

  // Get or create task-chat session for this node
  const session = useMemo(() => {
    let latest: ReturnType<typeof allSessions.get> | undefined
    for (const session of allSessions.values()) {
      if (session.nodeId === node.id && session.type === "task-chat") {
        if (!latest || session.createdAt > latest.createdAt) latest = session
      }
    }
    return latest
  }, [allSessions, node.id])
  const messages = session?.messages || []
  const messagesLength = messages.length

  // Ensure session exists
  useEffect(() => {
    if (!session) {
      createSession({ type: "task-chat", projectId, nodeId: node.id })
    }
  }, [session, createSession, node.id, projectId])

  useEffect(() => {
    // Auto-scroll to bottom when messages change
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messagesLength])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    // Read session fresh from store — never use stale closure
    const taskSessions = useSessionStore.getState()
    const allSessions = [...taskSessions.sessions.values()]
    const freshSession = allSessions
      .filter((s) => s.nodeId === node.id && s.type === "task-chat")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .pop()
    if (!freshSession) return

    setInput("")
    const sid = freshSession.id

    // Add user message
    addMessage(sid, { role: "user", content: text })

    // Add placeholder for assistant response
    addMessage(sid, { role: "assistant", content: "" })

    setIsStreaming(true)

    // Abort any in-flight request before starting a new one
    if (abortRef.current) {
      abortRef.current.abort()
    }
    abortRef.current = new AbortController()

    // Generate a per-turn streamId for disconnect catch-up tracking
    const turnStreamId = `task-chat-${node.id}-${Date.now()}`
    chatStreamRef.current = { streamId: turnStreamId, lastSeq: 0 }

    // Re-read messages from store after adding user msg + placeholder
    const updatedSession = useSessionStore.getState().sessions.get(sid)
    const freshMessages = updatedSession?.messages || []
    // Exclude the just-added user message and empty assistant placeholder
    const historyMessages = freshMessages
      .slice(0, -2)
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content.length > 0))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

    // Only send providerSessionId if the session has completed at least one exchange
    const hasCompletedExchange = (updatedSession?.messages || []).some(
      (m) => m.role === "assistant" && m.content.length > 0
    )

    let rawText = ""
    try {
      await chatWithTask(
        {
          message: text,
          sessionId: hasCompletedExchange ? freshSession.providerSessionId : undefined,
          streamId: turnStreamId,
          nodeId: node.id,
          projectId,
          taskTitle: node.title,
          taskDescription: node.content ? stripHtml(node.content) : node.description,
          taskOutput,
          visionDoc,
          model,
          messages: historyMessages,
        },
        {
          onText: (chunk) => {
            rawText += chunk
            appendToLastAssistantMessage(sid, chunk)
          },
          onToolUse: () => {},
          onToolResult: () => {},
          onDone: (newSessionId) => {
            if (newSessionId) setProviderSessionId(sid, newSessionId)
            // Force immediate save — appendToLastAssistantMessage only debounce-saves
            updateLastAssistantMessage(sid, rawText)
            chatStreamRef.current = { streamId: '', lastSeq: 0 }
            setIsStreaming(false)
          },
          onError: (error) => {
            appendToLastAssistantMessage(sid, `\n\nError: ${error}`)
            chatStreamRef.current = { streamId: '', lastSeq: 0 }
            setIsStreaming(false)
          },
          onSeq: (seq) => {
            chatStreamRef.current.lastSeq = seq
          },
        },
        abortRef.current.signal,
      )
    } catch (e: unknown) {
      // User-initiated abort — no catch-up needed
      if (e instanceof Error && e.name === 'AbortError') {
        setIsStreaming(false)
        return
      }

      // Network error — attempt catch-up using stored streamId and lastSeq
      const { streamId: catchUpStreamId, lastSeq } = chatStreamRef.current
      if (catchUpStreamId) {
        try {
          const { events } = await fetchStreamingEventsCatchUp([catchUpStreamId], lastSeq)
          if (events.length > 0) {
            const { completed } = replayChatCatchUpEvents(events, {
              onText: (chunk) => {
                rawText += chunk
                appendToLastAssistantMessage(sid, chunk)
              },
              onDone: (newSessionId) => {
                if (newSessionId) setProviderSessionId(sid, newSessionId)
                updateLastAssistantMessage(sid, rawText)
              },
              onError: (error) => {
                appendToLastAssistantMessage(sid, `\n\nError: ${error}`)
              },
            })
            if (completed) {
              chatStreamRef.current = { streamId: '', lastSeq: 0 }
            }
          } else {
            appendToLastAssistantMessage(sid, '\n\nConnection lost during chat')
          }
        } catch {
          // Catch-up also failed
          appendToLastAssistantMessage(sid, '\n\nConnection lost — unable to recover')
        }
      } else {
        appendToLastAssistantMessage(sid, '\n\nConnection lost')
      }

      setIsStreaming(false)
    }
  }, [input, isStreaming, node.id, node.title, node.content, node.description, projectId, taskOutput, visionDoc, model, addMessage, appendToLastAssistantMessage, updateLastAssistantMessage, setProviderSessionId])

  function handleClear() {
    if (isStreaming) {
      abortRef.current?.abort()
    }
    clearSessionsForNode(node.id)
    // Recreate the session
    createSession({ type: "task-chat", projectId, nodeId: node.id })
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Task Assistant</span>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleClear}
            title="Clear chat"
          >
            <Trash2 className="h-3 w-3 text-muted-foreground" />
          </Button>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="flex flex-col gap-3 py-4">
              <p className="text-xs text-muted-foreground text-center">
                Ask questions about this task, get help reviewing agent output, or request suggestions.
              </p>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {[
                  "Why did the agent approach it this way?",
                  "Is this result correct?",
                  "How should I modify this task?",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="text-[10px] px-2 py-1 rounded-full border border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={msg.id || i}
              className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {msg.role === "user" ? "You" : "Claude"}
              </span>
              <div
                className={`rounded-lg px-3 py-2 text-sm leading-relaxed max-w-[90%] ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                {msg.content ? (
                  msg.role === "assistant" ? (
                    <MarkdownRenderer content={msg.content} className="text-sm" />
                  ) : (
                    <pre className="whitespace-pre-wrap text-sm">{msg.content}</pre>
                  )
                ) : isStreaming && msg.role === "assistant" ? (
                  <TypingIndicator className="text-muted-foreground py-1" />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="flex items-end gap-2 border-t border-border p-3">
        <FileCompletionTextarea
          projectId={projectId}
          machineId={resolvedMachineId}
          workingDirectory={project?.workingDirectory}
          fileTree={project?.fileTree}
          slashCommands={slashCmds}
          mentionItems={mentionItems}
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          placeholder="Ask about this task... (@ for files/tasks)"
          rows={1}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={handleSend}
          disabled={!input.trim() || isStreaming}
        >
          {isStreaming ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}

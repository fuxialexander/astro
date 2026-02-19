import { useState, useRef, useEffect } from "react"
import { Send, Loader2, Trash2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FileCompletionTextarea } from "@/components/ui/file-completion-textarea"
import { TypingIndicator } from "@/components/ui/typing-indicator"
import { chatWithTask } from "@/lib/api-client"
import { useSessionStore } from "@/stores/session-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useProjectStore } from "@/stores/project-store"
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
  const model = useSettingsStore((s) => s.model)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))

  // Session store actions
  const createSession = useSessionStore((s) => s.createSession)
  const addMessage = useSessionStore((s) => s.addMessage)
  const appendToLastAssistantMessage = useSessionStore((s) => s.appendToLastAssistantMessage)
  const setProviderSessionId = useSessionStore((s) => s.setProviderSessionId)
  const clearSessionsForNode = useSessionStore((s) => s.clearSessionsForNode)
  const getSessionsForNode = useSessionStore((s) => s.getSessionsForNode)

  // Get or create task-chat session for this node
  const taskChatSessions = getSessionsForNode(node.id, "task-chat")
  const session = taskChatSessions[taskChatSessions.length - 1]
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

  async function handleSend() {
    const text = input.trim()
    if (!text || isStreaming || !session) return

    setInput("")
    const sid = session.id

    // Add user message
    addMessage(sid, { role: "user", content: text })

    // Add placeholder for assistant response
    addMessage(sid, { role: "assistant", content: "" })

    setIsStreaming(true)
    abortRef.current = new AbortController()

    // Build message history from session
    const historyMessages = (session.messages || [])
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content.length > 0))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

    try {
      await chatWithTask(
        {
          message: text,
          sessionId: session.providerSessionId,
          nodeId: node.id,
          projectId,
          taskTitle: node.title,
          taskDescription: node.description,
          taskOutput,
          visionDoc,
          model,
          messages: historyMessages,
        },
        {
          onText: (chunk) => {
            appendToLastAssistantMessage(sid, chunk)
          },
          onDone: (newSessionId) => {
            if (newSessionId) setProviderSessionId(sid, newSessionId)
            setIsStreaming(false)
          },
          onError: (error) => {
            appendToLastAssistantMessage(sid, `\n\nError: ${error}`)
            setIsStreaming(false)
          },
        },
        abortRef.current.signal,
      )
    } catch {
      setIsStreaming(false)
    }
  }

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
                  <pre className="whitespace-pre-wrap text-sm">
                    {msg.content}
                  </pre>
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
          machineId={project?.defaultMachineId}
          workingDirectory={project?.workingDirectory}
          fileTree={project?.fileTree}
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          placeholder="Ask about this task... (type @ to reference files)"
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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

import { useState, useRef, useEffect, useCallback } from "react"
import { Send, Loader2, CheckCircle2, XCircle, RotateCw } from "lucide-react"
import { apiUrl } from "@/lib/api-url"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { VoiceInputButton } from "@/components/ui/voice-input-button"
import { FileCompletionTextarea } from "@/components/ui/file-completion-textarea"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useSessionStore } from "@/stores/session-store"
import { useProjectStore } from "@/stores/project-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useVoiceTranscription } from "@/hooks/use-voice-transcription"
import { fetchSlashCommands } from "@/lib/api-client"
import { parseSSEStream } from "@/lib/sse-parser"
import type { SlashCommand } from "@/components/ui/file-completion-textarea"
import type { Session } from "@/types"

interface SteerChatProps {
  taskId: string
  machineId: string
  projectId: string
  nodeId: string
  steerSession?: Session
}

export function SteerChat({ taskId, machineId, projectId, nodeId, steerSession }: SteerChatProps) {
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [resuming, setResuming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const addSteerMessageToRealtime = useRealtimeStore((s) => s.addSteerMessage)
  const sessionStoreAddSteer = useSessionStore((s) => s.addSteerMessage)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const appendText = useExecutionStore((s) => s.appendText)
  const addToolTrace = useExecutionStore((s) => s.addToolTrace)
  const updateToolTraceResult = useExecutionStore((s) => s.updateToolTraceResult)

  const steerMessages = steerSession?.steerMessages || []

  // Slash commands from connected machine
  const [slashCmds, setSlashCmds] = useState<SlashCommand[]>([])
  useEffect(() => {
    if (!machineId) return
    fetchSlashCommands(machineId, project?.workingDirectory).then(setSlashCmds).catch(() => {})
  }, [machineId, project?.workingDirectory])

  // Voice transcription for steering input
  const handleTranscript = useCallback((text: string) => {
    setInput((prev) => {
      if (prev.trim()) {
        return prev.trim() + " " + text
      }
      return text
    })
  }, [])

  const {
    isRecording,
    isTranscribing,
    isAvailable,
    duration,
    toggleRecording,
  } = useVoiceTranscription({
    onTranscript: handleTranscript,
  })

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [steerMessages.length])

  /**
   * Process an SSE stream from a resumed steer session.
   * Updates the execution store with text, tool traces, etc.
   */
  async function processResumedStream(response: Response) {
    setResuming(true)
    try {
      // Mark execution as running again during resume
      useExecutionStore.setState((state) => {
        const newExecutions = new Map(state.executions)
        const exec = newExecutions.get(nodeId)
        if (exec) {
          exec.status = "running"
          exec.completedAt = undefined
        }
        return { executions: newExecutions }
      })

      await parseSSEStream(response, {
        onEvent: ({ event, data }) => {
          switch (event) {
            case "text":
              appendText(nodeId, data)
              break
            case "tool_use":
              try {
                const parsed = JSON.parse(data)
                const traceId = `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`
                addToolTrace(nodeId, {
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
                updateToolTraceResult(nodeId, parsed.toolName, parsed.result, parsed.success)
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
                // Persist completed execution to database
                useExecutionStore.getState().persist()
              } catch { /* ignore */ }
              break
            case "error":
              try {
                const parsed = JSON.parse(data)
                console.error("[steer-chat] Resume error:", parsed.error)
                // Persist failed execution to database
                useExecutionStore.getState().persist()
              } catch { /* ignore */ }
              break
            case "resumed":
            case "session_init":
            case "done":
            case "heartbeat":
              break
          }
        },
      })
    } finally {
      setResuming(false)
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || sending || resuming) return

    setInput("")
    setSending(true)

    // Add message to both stores immediately for UI
    addSteerMessageToRealtime(taskId, text)
    if (steerSession) {
      sessionStoreAddSteer(steerSession.id, text)
    }

    try {
      const response = await fetch(apiUrl("/api/dispatch/steer"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          machineId,
          message: text,
          action: "guidance",
        }),
      })

      if (!response.ok) {
        console.error("Failed to steer:", await response.text())
        return
      }

      // Check if the response is an SSE stream (resumed session)
      const contentType = response.headers.get("content-type") || ""
      if (contentType.includes("text/event-stream")) {
        setSending(false)
        await processResumedStream(response)
      }
    } catch (error) {
      console.error("Steer error:", error)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex w-[320px] shrink-0 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between px-4 border-b border-border">
        <span className="text-sm font-semibold">Steer Agent</span>
        {resuming && (
          <div className="flex items-center gap-1.5">
            <RotateCw className="h-3 w-3 animate-spin text-blue-500" />
            <span className="text-[10px] text-blue-600">Resumed</span>
          </div>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="flex flex-col gap-3">
          {steerMessages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              Send guidance to the running agent. Your messages will be injected into the agent's session.
              {"\n\n"}After execution completes, messages will resume the session in the task's worktree.
            </p>
          )}
          {steerMessages.map((msg, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              {/* User message */}
              <div className="flex flex-col items-end gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  You
                </span>
                <div className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground max-w-[280px]">
                  <MarkdownRenderer content={msg.message} className="text-sm text-primary-foreground [&_a]:text-primary-foreground [&_code]:bg-primary-foreground/20" />
                </div>
              </div>

              {/* Ack status */}
              {msg.accepted !== undefined && (
                <div className="flex items-center gap-1.5 justify-end">
                  {msg.accepted ? (
                    <>
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      <span className="text-[10px] text-green-600">Accepted</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3 w-3 text-red-500" />
                      <span className="text-[10px] text-red-600 max-w-[240px]">
                        {msg.ackMessage ? (
                          <MarkdownRenderer content={msg.ackMessage} className="text-[10px] text-red-600 inline" />
                        ) : "Rejected"}
                      </span>
                    </>
                  )}
                </div>
              )}
              {msg.accepted === undefined && (
                <div className="flex items-center gap-1.5 justify-end">
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">Sending...</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="flex items-end gap-2 border-t border-border p-3">
        <VoiceInputButton
          isRecording={isRecording}
          isTranscribing={isTranscribing}
          isAvailable={isAvailable}
          duration={duration}
          onClick={toggleRecording}
          disabled={sending || resuming}
          className="h-9 w-9 shrink-0"
        />
        <FileCompletionTextarea
          projectId={projectId}
          machineId={machineId}
          workingDirectory={project?.workingDirectory}
          fileTree={project?.fileTree}
          slashCommands={slashCmds}
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          placeholder={resuming ? "Session resumed..." : isRecording ? "Listening..." : isTranscribing ? "Transcribing..." : "Guide the agent... (type @ for files, / for commands)"}
          rows={1}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={handleSend}
          disabled={!input.trim() || sending || resuming || isRecording || isTranscribing}
        >
          {sending || resuming ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}

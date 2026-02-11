import { useState, useRef, useEffect, useCallback } from "react"
import { Send, Loader2, CheckCircle2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { VoiceInputButton } from "@/components/ui/voice-input-button"
import { FileCompletionTextarea } from "@/components/ui/file-completion-textarea"
import { useRealtimeStore, type TaskStream } from "@/stores/realtime-store"
import { useProjectStore } from "@/stores/project-store"
import { useVoiceTranscription } from "@/hooks/use-voice-transcription"

interface SteerChatProps {
  taskId: string
  machineId: string
  projectId: string
  taskStream?: TaskStream
}

export function SteerChat({ taskId, machineId, projectId, taskStream }: SteerChatProps) {
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const addSteerMessage = useRealtimeStore((s) => s.addSteerMessage)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))

  const steerMessages = taskStream?.steerMessages || []

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

  async function handleSend() {
    const text = input.trim()
    if (!text || sending) return

    setInput("")
    setSending(true)

    // Add message to store immediately for UI
    addSteerMessage(taskId, text)

    try {
      const response = await fetch("/api/dispatch/steer", {
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
      <div className="flex h-12 shrink-0 items-center px-4 border-b border-border">
        <span className="text-sm font-semibold">Steer Agent</span>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="flex flex-col gap-3">
          {steerMessages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              Send guidance to the running agent. Your messages will be injected into the agent's session.
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
                  <p className="whitespace-pre-wrap">{msg.message}</p>
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
                      <span className="text-[10px] text-red-600">
                        {msg.ackMessage || "Rejected"}
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
          disabled={sending}
          className="h-9 w-9 shrink-0"
        />
        <FileCompletionTextarea
          projectId={projectId}
          machineId={machineId}
          workingDirectory={project?.workingDirectory}
          fileTree={project?.fileTree}
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          placeholder={isRecording ? "Listening..." : isTranscribing ? "Transcribing..." : "Guide the agent... (type @ to reference files)"}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={handleSend}
          disabled={!input.trim() || sending || isRecording || isTranscribing}
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}

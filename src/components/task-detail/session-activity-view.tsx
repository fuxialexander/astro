import { useState } from "react"
import { ChevronDown, ChevronRight, Link2, Unlink2, Wrench, FileCode, MessageSquare, AlertCircle, Monitor } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AttachedSession, SessionEventEntry } from "@/stores/realtime-store"

interface SessionActivityViewProps {
  sessions: AttachedSession[]
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - new Date(date).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) return `${hours}h ${minutes % 60}m ago`
  if (minutes > 0) return `${minutes}m ago`
  return "just now"
}

function getEventIcon(type: string) {
  switch (type) {
    case "tool_call":
    case "tool_result":
      return <Wrench className="h-3.5 w-3.5" />
    case "file_change":
      return <FileCode className="h-3.5 w-3.5" />
    case "message":
      return <MessageSquare className="h-3.5 w-3.5" />
    case "error":
      return <AlertCircle className="h-3.5 w-3.5 text-red-500" />
    default:
      return <Monitor className="h-3.5 w-3.5" />
  }
}

function getEventColor(type: string): string {
  switch (type) {
    case "tool_call":
    case "tool_result":
      return "border-blue-500 bg-blue-500/10"
    case "file_change":
      return "border-amber-500 bg-amber-500/10"
    case "message":
      return "border-green-500 bg-green-500/10"
    case "error":
      return "border-red-500 bg-red-500/10"
    default:
      return "border-border bg-muted"
  }
}

function EventItem({ event }: { event: SessionEventEntry }) {
  const [expanded, setExpanded] = useState(false)
  const data = event.data as Record<string, unknown>

  // Extract display info based on event type
  let summary = ""
  switch (event.type) {
    case "tool_call":
      summary = `Tool: ${data.toolName || "unknown"}`
      break
    case "tool_result":
      summary = `Result: ${data.toolName || "unknown"}`
      break
    case "file_change":
      summary = `${data.action || "changed"}: ${data.path || "unknown"}`
      break
    case "message":
      summary = (data.content as string)?.slice(0, 50) || "Message"
      break
    case "error":
      summary = (data.message as string)?.slice(0, 50) || "Error"
      break
    default:
      summary = event.type
  }

  return (
    <div className="flex gap-3">
      {/* Timeline */}
      <div className="flex flex-col items-center">
        <div className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full border-2",
          getEventColor(event.type)
        )}>
          {getEventIcon(event.type)}
        </div>
        <div className="w-px flex-1 bg-border" />
      </div>

      {/* Content */}
      <div className="flex-1 pb-3 min-w-0">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 w-full text-left group cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-sm truncate flex-1">{summary}</span>
          <span className="text-xs text-muted-foreground">{formatTime(event.timestamp)}</span>
        </button>

        {expanded && event.data != null && (
          <div className="mt-2 rounded-md bg-muted p-3">
            <pre className="font-mono text-xs whitespace-pre-wrap break-all text-foreground max-h-[200px] overflow-auto">
              {JSON.stringify(event.data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

function SessionCard({ session }: { session: AttachedSession }) {
  const [expanded, setExpanded] = useState(true)
  const recentEvents = session.events.slice(-20).reverse()

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Session header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 w-full px-4 py-3 bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/10 border border-green-500">
          <Link2 className="h-4 w-4 text-green-500" />
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Attached Session</span>
            <span className="text-xs text-muted-foreground font-mono">
              {session.sessionId.slice(0, 12)}...
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>Machine: {session.machineId.slice(0, 12)}...</span>
            <span>Attached {formatRelativeTime(session.attachedAt)}</span>
            <span>{session.eventCount} events</span>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Session events */}
      {expanded && (
        <div className="px-4 py-3">
          {recentEvents.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              No events yet from this session
            </div>
          ) : (
            <div className="flex flex-col">
              {recentEvents.map((event, i) => (
                <EventItem key={i} event={event} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function SessionActivityView({ sessions }: SessionActivityViewProps) {
  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Unlink2 className="h-10 w-10 opacity-50" />
        <div className="text-center">
          <p className="text-sm font-medium">No attached sessions</p>
          <p className="text-xs mt-1">
            Run <code className="bg-muted px-1 rounded">nexus_attach</code> in Claude Code to link a session
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-4">
      {sessions.map((session) => (
        <SessionCard key={session.sessionId} session={session} />
      ))}
    </div>
  )
}

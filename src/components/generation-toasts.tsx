import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router"
import { Loader2, CheckCircle2, AlertCircle, X, ChevronDown, ChevronUp, FolderGit2, Minimize2, Maximize2 } from "lucide-react"
import { useAgentStore, type GenerationSession } from "@/stores/agent-store"
import { useProjectStore } from "@/stores/project-store"
import { useMachinesStore } from "@/stores/machines-store"
import { filterStreamText } from "@/lib/stream-text-utils"
import { cn } from "@/lib/utils"

const AUTO_DISMISS_MS = 4000

function SessionCard({ session }: { session: GenerationSession }) {
  const abort = useAgentStore((s) => s.abort)
  const dismiss = useAgentStore((s) => s.dismissSession)
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Look up project and machine for richer status during repo_setup
  const project = useProjectStore((s) => s.projects.find((p) => p.id === session.projectId))
  const machines = useMachinesStore((s) => s.machines)
  const machineName = project?.defaultMachineId
    ? machines.find((m) => m.id === project.defaultMachineId)?.name || "remote machine"
    : null

  // Filter stream text to show only reasoning (no tool use, no code)
  const displayText = useMemo(
    () => filterStreamText(session.streamText),
    [session.streamText],
  )

  // Auto-scroll to bottom when new text arrives while expanded
  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [expanded, displayText])

  // Cancel auto-dismiss when user expands the card
  useEffect(() => {
    if (expanded && dismissTimer.current) {
      clearTimeout(dismissTimer.current)
      dismissTimer.current = null
    }
  }, [expanded])

  // Auto-dismiss completed sessions (only if not expanded)
  useEffect(() => {
    if (session.status === "completed" && !expanded) {
      dismissTimer.current = setTimeout(() => {
        dismiss(session.projectId)
      }, AUTO_DISMISS_MS)
    }
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
    }
  }, [session.status, session.projectId, dismiss, expanded])

  const isActive = session.status === "active"
  const isError = session.status === "error"
  const hasText = displayText.length > 0

  function handleClose() {
    if (isActive) {
      abort(session.projectId)
    } else {
      dismiss(session.projectId)
    }
  }

  function handleNavigate() {
    navigate(`/project/${session.projectId}`)
  }

  return (
    <div className={cn(
      "rounded-lg border bg-card shadow-lg overflow-hidden transition-all",
      isError ? "border-destructive/40" : "border-border",
    )}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {/* Phase icon */}
        {isActive && session.phase === "repo_setup" && (
          <FolderGit2 className="h-4 w-4 shrink-0 animate-pulse text-primary" />
        )}
        {isActive && session.phase !== "repo_setup" && (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        )}
        {session.status === "completed" && (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        )}
        {isError && (
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
        )}

        {/* Project name + phase label */}
        <div className="flex-1 min-w-0">
          <button
            onClick={handleNavigate}
            className="text-sm font-medium truncate block w-full text-left hover:underline cursor-pointer"
          >
            {session.projectName || "Project"}
          </button>
          <p className="text-[11px] text-muted-foreground truncate">
            {isActive && session.phase === "repo_setup" && (
              machineName
                ? `Setting up working directory on ${machineName}...`
                : "Setting up working directory..."
            )}
            {isActive && session.phase === "generating" && "Generating plan..."}
            {session.status === "completed" && "Plan generated"}
            {isError && (session.error || "Generation failed")}
          </p>
        </div>

        {/* Expand toggle — show whenever there's text, even after completion */}
        {hasText && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded hover:bg-muted transition-colors cursor-pointer"
            title={expanded ? "Collapse" : "Show generation log"}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        )}

        {/* Close/cancel button */}
        <button
          onClick={handleClose}
          className={cn(
            "p-1 rounded transition-colors cursor-pointer",
            isActive
              ? "hover:bg-destructive/20 text-destructive"
              : "hover:bg-muted text-muted-foreground"
          )}
          title={isActive ? "Cancel generation" : "Dismiss"}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Collapsed text preview — shows last 5 lines of reasoning */}
      {!expanded && hasText && (
        <div className="border-t border-border px-3 py-1.5 bg-muted/30">
          <div className="text-[10px] text-muted-foreground/80 leading-relaxed font-mono line-clamp-5 whitespace-pre-wrap">
            {displayText.split('\n').filter(Boolean).slice(-5).join('\n')}
          </div>
        </div>
      )}

      {/* Expandable stream text */}
      {expanded && hasText && (
        <div
          ref={scrollRef}
          className="border-t border-border px-3 py-2 max-h-[400px] overflow-auto bg-muted/50"
        >
          <div className="whitespace-pre-wrap text-[11px] text-muted-foreground leading-relaxed">
            {displayText.slice(-5000)}
          </div>
        </div>
      )}

      {/* Progress bar for active sessions */}
      {isActive && (
        <div className="h-0.5 bg-muted">
          <div className="h-full bg-primary animate-pulse rounded-full" style={{ width: "60%" }} />
        </div>
      )}
    </div>
  )
}

export function GenerationToasts() {
  const sessions = useAgentStore((s) => s.sessions)
  const entries = Array.from(sessions.values())
  const hasExpanded = entries.some((s) => s.streamText.length > 0)
  const [minimized, setMinimized] = useState(false)

  if (entries.length === 0) return null

  const activeCount = entries.filter((s) => s.status === "active").length
  const label = activeCount > 0
    ? `${activeCount} generating`
    : `${entries.length} session${entries.length !== 1 ? "s" : ""}`

  if (minimized) {
    return (
      <div className="fixed top-16 right-4 z-40">
        <button
          onClick={() => setMinimized(false)}
          className="flex items-center gap-2 h-8 px-3 rounded-full border border-border bg-card shadow-lg text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          {activeCount > 0 && (
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
          )}
          <span>{label}</span>
          <Maximize2 className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    )
  }

  return (
    <div className={cn(
      "fixed top-16 right-4 z-40 flex flex-col gap-2 transition-all",
      hasExpanded ? "w-[480px]" : "w-[340px]",
    )}>
      {entries.length > 1 && (
        <div className="flex justify-end">
          <button
            onClick={() => setMinimized(true)}
            className="flex items-center gap-1.5 h-6 px-2 rounded-md text-[10px] font-medium text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
            title="Minimize all"
          >
            <Minimize2 className="h-3 w-3" />
            Minimize
          </button>
        </div>
      )}
      {entries.map((session) => (
        <SessionCard key={session.projectId} session={session} />
      ))}
    </div>
  )
}

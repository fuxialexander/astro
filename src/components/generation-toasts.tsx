import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router"
import { Loader2, CheckCircle2, AlertCircle, X, ChevronDown, ChevronUp, FolderGit2 } from "lucide-react"
import { useAgentStore, type GenerationSession } from "@/stores/agent-store"
import { useProjectStore } from "@/stores/project-store"
import { useMachinesStore } from "@/stores/machines-store"
import { cn } from "@/lib/utils"

const AUTO_DISMISS_MS = 4000

function SessionCard({ session }: { session: GenerationSession }) {
  const abort = useAgentStore((s) => s.abort)
  const dismiss = useAgentStore((s) => s.dismissSession)
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Look up project and machine for richer status during repo_setup
  const project = useProjectStore((s) => s.projects.find((p) => p.id === session.projectId))
  const machines = useMachinesStore((s) => s.machines)
  const machineName = project?.defaultMachineId
    ? machines.find((m) => m.id === project.defaultMachineId)?.name || "remote machine"
    : null

  // Auto-dismiss completed sessions
  useEffect(() => {
    if (session.status === "completed") {
      dismissTimer.current = setTimeout(() => {
        dismiss(session.projectId)
      }, AUTO_DISMISS_MS)
    }
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
    }
  }, [session.status, session.projectId, dismiss])

  const isActive = session.status === "active"
  const isError = session.status === "error"

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
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
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

        {/* Expand toggle */}
        {isActive && session.streamText && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded hover:bg-muted transition-colors cursor-pointer"
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

      {/* Expandable stream text */}
      {expanded && session.streamText && (
        <div className="border-t border-border px-3 py-2 max-h-[120px] overflow-auto bg-muted/50">
          <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground leading-relaxed font-mono">
            {session.streamText.slice(-2000)}
          </pre>
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

  if (entries.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[340px] flex flex-col-reverse gap-2">
      {entries.map((session) => (
        <SessionCard key={session.projectId} session={session} />
      ))}
    </div>
  )
}

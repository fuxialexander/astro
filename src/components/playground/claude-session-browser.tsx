/**
 * Claude Code Session Browser
 *
 * Right sidebar panel for discovering and forking Claude Code sessions
 * from connected machines. Matches PlaygroundFileSidebar layout.
 */

import { useEffect, useCallback } from "react"
import {
  Terminal,
  Loader2,
  AlertCircle,
  RefreshCw,
  X,
  Laptop,
  GitBranch,
  FolderOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  useClaudeSessionsStore,
  type ClaudeCodeSession,
} from "@/stores/claude-sessions-store"

interface ClaudeSessionBrowserProps {
  onSelectSession: (session: ClaudeCodeSession) => void
  onClose: () => void
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

function getSessionTitle(session: ClaudeCodeSession): string {
  return session.customTitle || session.summary || session.firstPrompt || session.sessionId.slice(0, 8)
}

export function ClaudeSessionBrowser({
  onSelectSession,
  onClose,
}: ClaudeSessionBrowserProps) {
  const sessions = useClaudeSessionsStore((s) => s.sessions)
  const loading = useClaudeSessionsStore((s) => s.loading)
  const error = useClaudeSessionsStore((s) => s.error)
  const loadSessions = useClaudeSessionsStore((s) => s.loadSessions)

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const handleRefresh = useCallback(() => {
    // Force refresh by clearing lastLoadedAt
    useClaudeSessionsStore.setState({ lastLoadedAt: null })
    loadSessions()
  }, [loadSessions])

  return (
    <div className="flex flex-col h-full w-[280px] border-l border-border bg-background shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Terminal className="h-4 w-4 text-primary shrink-0" />
        <span className="text-xs font-medium truncate flex-1">Claude Code Sessions</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleRefresh}
          disabled={loading}
          title="Refresh sessions"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onClose}
          title="Close"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {loading && sessions.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error && sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 p-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-xs text-destructive text-center">{error}</p>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              Retry
            </Button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 p-3">
            <Terminal className="h-5 w-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground text-center">
              No Claude Code sessions found on connected machines
            </p>
          </div>
        ) : (
          <div>
            {sessions.map((session) => (
              <button
                key={`${session.machineId}-${session.sessionId}`}
                onClick={() => onSelectSession(session)}
                className="w-full flex flex-col gap-1 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors border-b border-border/50"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">
                      {getSessionTitle(session)}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatRelativeTime(session.lastModified)}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-0.5 shrink-0">
                    <Laptop className="h-2.5 w-2.5" />
                    {session.machineName}
                  </span>
                  {session.gitBranch && (
                    <span className="flex items-center gap-0.5 truncate">
                      <GitBranch className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{session.gitBranch}</span>
                    </span>
                  )}
                </div>

                {session.cwd && (
                  <p className="text-[10px] text-muted-foreground font-mono truncate flex items-center gap-0.5">
                    <FolderOpen className="h-2.5 w-2.5 shrink-0" />
                    {session.cwd}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

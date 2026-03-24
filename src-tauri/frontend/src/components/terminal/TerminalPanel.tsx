/**
 * TerminalPanel — multi-tab terminal container using xterm.js + Rust PTY.
 *
 * Toolbar actions: New terminal, Kill, Clear, Split (placeholder).
 * Each tab is a TerminalTab backed by a PTY session from Tauri.
 */
import { useCallback, useEffect } from 'react'
import { Plus, X, Trash2, Terminal } from 'lucide-react'

import { useTerminalStore } from '@desktop/stores/terminal-store'
import { spawnTerminal, killTerminal } from '@desktop/lib/tauri-bridge'
import { TerminalTab } from '@desktop/components/terminal/TerminalTab'
import { cn } from '@desktop/lib/utils'

interface TerminalPanelProps {
  /** Project working directory — used as cwd for new terminals. */
  cwd?: string | null
}

export function TerminalPanel({ cwd }: TerminalPanelProps) {
  const {
    sessions,
    activeSessionId,
    addSession,
    removeSession,
    setActiveSession,
    markDead,
  } = useTerminalStore()

  // Spawn a new terminal session
  const handleNew = useCallback(async () => {
    try {
      const sessionId = await spawnTerminal(cwd ?? undefined)
      addSession({
        id: sessionId,
        label: `Terminal ${sessions.length + 1}`,
        cwd: cwd ?? '~',
        alive: true,
        createdAt: Date.now(),
      })
    } catch (err) {
      console.error('Failed to spawn terminal:', err)
    }
  }, [cwd, sessions.length, addSession])

  // Kill active terminal session
  const handleKill = useCallback(
    async (id: string) => {
      try {
        await killTerminal(id)
      } catch {
        // Session may already be dead
      }
      markDead(id)
      removeSession(id)
    },
    [markDead, removeSession],
  )

  // Auto-create first terminal on mount if none exist
  useEffect(() => {
    if (sessions.length === 0) {
      void handleNew()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#1e1e1e]">
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-2 h-9 flex-shrink-0 bg-[#252526] border-b border-[#3c3c3c]">
        {/* Tabs */}
        <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto scrollbar-hide">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => setActiveSession(session.id)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs whitespace-nowrap',
                'transition-colors duration-100',
                activeSessionId === session.id
                  ? 'bg-[#1e1e1e] text-[#cccccc]'
                  : 'text-[#888888] hover:text-[#cccccc] hover:bg-[#2a2d2e]',
              )}
            >
              <Terminal className="w-3 h-3 flex-shrink-0" />
              <span className="truncate max-w-[100px]">{session.label}</span>
              {!session.alive && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void handleKill(session.id)
                }}
                className="ml-0.5 p-0.5 rounded hover:bg-[#3c3c3c] text-[#888888] hover:text-[#cccccc]"
                title="Close terminal"
              >
                <X className="w-3 h-3" />
              </button>
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
          <ToolbarButton
            icon={Plus}
            title="New terminal"
            onClick={() => void handleNew()}
          />
          {activeSessionId && (
            <ToolbarButton
              icon={Trash2}
              title="Kill terminal"
              onClick={() => void handleKill(activeSessionId)}
            />
          )}
        </div>
      </div>

      {/* ── Terminal content ──────────────────────────────────── */}
      <div className="flex-1 min-h-0 relative">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#888888] text-sm gap-2">
            <Terminal className="w-8 h-8 opacity-40" />
            <p>No terminals open</p>
            <button
              onClick={() => void handleNew()}
              className="text-xs text-[#569cd6] hover:underline"
            >
              Create a new terminal
            </button>
          </div>
        ) : (
          sessions.map((session) => (
            <TerminalTab
              key={session.id}
              sessionId={session.id}
              active={session.id === activeSessionId}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

function ToolbarButton({
  icon: Icon,
  title,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'p-1 rounded text-[#888888] hover:text-[#cccccc] hover:bg-[#3c3c3c]',
        'transition-colors duration-100',
      )}
      title={title}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  )
}

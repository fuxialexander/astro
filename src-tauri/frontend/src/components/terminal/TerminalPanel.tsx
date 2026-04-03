/**
 * TerminalPanel — multi-session terminal with VS Code-style vertical tab list.
 * Colors match the app light theme via Tailwind CSS variables.
 *
 * Layout:
 *   ┌──────────────────────────┬───────────────┐
 *   │                          │  [+]  [🗑]    │
 *   │   Terminal output        ├───────────────┤
 *   │                          │ ● bash        │
 *   │                          │   bash        │
 *   └──────────────────────────┴───────────────┘
 */
import { useCallback, useEffect, useRef } from 'react'
import { Plus, Trash2, Terminal } from 'lucide-react'

import { useTerminalStore } from '@desktop/stores/terminal-store'
import { spawnTerminal, killTerminal } from '@desktop/lib/tauri-bridge'
import { TerminalTab } from '@desktop/components/terminal/TerminalTab'
import { cn } from '@desktop/lib/utils'

interface TerminalPanelProps {
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

  const handleNew = useCallback(async () => {
    try {
      const sessionId = await spawnTerminal(cwd ?? undefined)
      addSession({
        id: sessionId,
        label: 'bash',
        cwd: cwd ?? '~',
        alive: true,
        createdAt: Date.now(),
      })
    } catch (err) {
      console.error('Failed to spawn terminal:', err)
    }
  }, [cwd, addSession])

  const handleKill = useCallback(
    async (id: string) => {
      try {
        await killTerminal(id)
      } catch {
        // Already dead
      }
      markDead(id)
      removeSession(id)
    },
    [markDead, removeSession],
  )

  // Auto-create first terminal — ref guard prevents Strict Mode double-fire
  const autoSpawnedRef = useRef(false)
  useEffect(() => {
    if (sessions.length === 0 && !autoSpawnedRef.current) {
      autoSpawnedRef.current = true
      void handleNew()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* ── Terminal output ─────────────────────────────────── */}
      <div className="flex-1 min-w-0 relative">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2">
            <Terminal className="w-5 h-5 opacity-30" />
            <button
              onClick={() => void handleNew()}
              className="text-primary hover:underline"
            >
              New terminal
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

      {/* ── Right sidebar: vertical session list ────────────── */}
      <div className="w-[140px] flex-shrink-0 border-l flex flex-col bg-muted/30">
        {/* Action row */}
        <div className="flex items-center gap-0.5 px-1.5 h-7 border-b flex-shrink-0">
          <SidebarButton
            icon={Plus}
            title="New terminal"
            onClick={() => void handleNew()}
          />
          {activeSessionId && (
            <SidebarButton
              icon={Trash2}
              title="Kill terminal"
              onClick={() => void handleKill(activeSessionId)}
            />
          )}
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto py-0.5">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => setActiveSession(session.id)}
              className={cn(
                'group flex items-center gap-1.5 w-full px-2 py-1.5 text-[11px] text-left',
                'transition-colors duration-75',
                session.id === activeSessionId
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
              title={session.cwd}
            >
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors',
                  !session.alive
                    ? 'bg-destructive'
                    : session.id === activeSessionId
                      ? 'bg-foreground'
                      : 'bg-transparent',
                )}
              />
              <Terminal className="w-3 h-3 flex-shrink-0 opacity-50" />
              <span className="truncate flex-1">{session.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void handleKill(session.id)
                }}
                className={cn(
                  'opacity-0 group-hover:opacity-100 text-[10px] px-0.5 rounded',
                  'hover:bg-destructive/10 hover:text-destructive',
                  'transition-opacity duration-100',
                )}
                title="Close"
              >
                ✕
              </button>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function SidebarButton({
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
      title={title}
      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-100"
    >
      <Icon className="w-3 h-3" />
    </button>
  )
}

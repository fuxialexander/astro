/**
 * ChatPanel — the main chat/thread panel for project conversations.
 *
 * Manages chat sessions: create new threads, switch between them,
 * send/receive messages with streaming SSE support.
 */
import { useEffect } from 'react'
import { Plus, MessageSquare, Loader2 } from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import { useChatStore } from '@desktop/stores/chat-store'
import { MessageList } from '@desktop/components/chat/MessageList'
import { MessageInput } from '@desktop/components/chat/MessageInput'

interface ChatPanelProps {
  projectId: string
}

export function ChatPanel({ projectId }: ChatPanelProps) {
  const sessions = useChatStore((s) => s.sessions)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const sessionsLoading = useChatStore((s) => s.sessionsLoading)
  const loadSessions = useChatStore((s) => s.loadSessions)
  const setActiveSession = useChatStore((s) => s.setActiveSession)
  const createSession = useChatStore((s) => s.createSession)

  // Load sessions when project changes
  useEffect(() => {
    loadSessions(projectId)
  }, [projectId, loadSessions])

  // Auto-select the latest session if none is active
  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSession(sessions[0].id)
    }
  }, [sessions, activeSessionId, setActiveSession])

  const handleNewThread = async () => {
    await createSession(projectId)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Session bar ───────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-3 h-9 border-b flex-shrink-0 overflow-x-auto">
        {sessionsLoading ? (
          <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
        ) : (
          <>
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setActiveSession(session.id)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs whitespace-nowrap',
                  'transition-colors duration-100',
                  activeSessionId === session.id
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                <MessageSquare className="w-3 h-3" />
                {session.title || 'New thread'}
              </button>
            ))}
          </>
        )}
        <button
          onClick={handleNewThread}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md text-xs',
            'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            'transition-colors duration-100',
          )}
          title="New thread"
        >
          <Plus className="w-3 h-3" />
          <span className="hidden sm:inline">New</span>
        </button>
      </div>

      {/* ── Messages ──────────────────────────────────────────────── */}
      <MessageList />

      {/* ── Input ─────────────────────────────────────────────────── */}
      <MessageInput sessionId={activeSessionId} disabled={!activeSessionId} />
    </div>
  )
}

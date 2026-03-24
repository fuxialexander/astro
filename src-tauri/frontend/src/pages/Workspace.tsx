/**
 * Workspace — project-specific main panel content.
 *
 * Rendered inside WorkspaceLayout's main panel via <Outlet />.
 * Contains a tab bar (Chat | Plan | Terminal) and renders the
 * active panel. Cmd+P toggles between Chat and Plan views.
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { ArrowLeft, Terminal, MessageSquare, LayoutGrid } from 'lucide-react'
import { api } from '@desktop/lib/api-client'
import { sidecarHealthCheck } from '@desktop/lib/tauri-bridge'
import { useProjectStore } from '@desktop/stores/project-store'
import { useStreamEvents } from '@desktop/hooks/use-stream-events'
import { ChatPanel } from '@desktop/components/chat/ChatPanel'
import { PlanGraph } from '@desktop/components/plan/PlanGraph'
import { cn } from '@desktop/lib/utils'
import type { Project } from '@desktop/types'

type WorkspaceTab = 'chat' | 'plan' | 'terminal'

export function Workspace() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const setActiveProject = useProjectStore((s) => s.setActiveProject)

  const [project, setProject] = useState<Project | null>(null)
  const [sidecarOk, setSidecarOk] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('chat')

  // Load project data
  useEffect(() => {
    if (!id) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const p = await api.get<Project>(`/api/data/projects/${id}`)
        if (!cancelled) {
          setProject(p)
          setActiveProject(p.id)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setProject(null)
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
      setActiveProject(null)
    }
  }, [id, setActiveProject])

  // Sidecar health check
  useEffect(() => {
    sidecarHealthCheck()
      .then(setSidecarOk)
      .catch(() => setSidecarOk(false))
  }, [])

  // Cmd+P to toggle between Chat and Plan
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault()
        setActiveTab((prev) => (prev === 'chat' ? 'plan' : 'chat'))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Connect SSE stream events for this project
  useStreamEvents({
    projectId: id ?? '',
    enabled: !!id && !!project,
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading workspace...
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <p className="text-sm">Project not found</p>
        <button
          onClick={() => navigate('/')}
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to projects
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Workspace header ─────────────────────────────────────── */}
      <header
        className="flex items-center gap-2.5 px-4 h-11 border-b flex-shrink-0"
        data-tauri-drag-region
      >
        <button
          onClick={() => navigate('/')}
          className={cn(
            'p-1.5 rounded-md text-muted-foreground',
            'hover:bg-muted hover:text-foreground transition-colors duration-150',
          )}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>

        <span className="text-base">{project.icon ?? '📋'}</span>
        <h1 className="text-sm font-semibold truncate">{project.name}</h1>

        {/* Tab bar */}
        <nav className="flex items-center gap-0.5 ml-2">
          <TabButton
            icon={MessageSquare}
            label="Chat"
            active={activeTab === 'chat'}
            onClick={() => setActiveTab('chat')}
            shortcut="⌘P"
          />
          <TabButton
            icon={LayoutGrid}
            label="Plan"
            active={activeTab === 'plan'}
            onClick={() => setActiveTab('plan')}
            shortcut="⌘P"
          />
          <TabButton
            icon={Terminal}
            label="Terminal"
            active={activeTab === 'terminal'}
            onClick={() => setActiveTab('terminal')}
          />
        </nav>

        {/* Sidecar status */}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0">
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              sidecarOk === null
                ? 'bg-warning animate-pulse'
                : sidecarOk
                  ? 'bg-success'
                  : 'bg-error',
            )}
          />
          <span className="hidden sm:inline">
            {sidecarOk === null
              ? 'Checking...'
              : sidecarOk
                ? 'Agent connected'
                : 'Agent offline'}
          </span>
        </div>
      </header>

      {/* ── Panel content ──────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'chat' && <ChatPanel projectId={project.id} />}
        {activeTab === 'plan' && <PlanGraph projectId={project.id} />}
        {activeTab === 'terminal' && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <div className="text-center space-y-1">
              <Terminal className="w-8 h-8 mx-auto opacity-40" />
              <p>Terminal panel</p>
              <p className="text-xs opacity-60">Coming in integration phase</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

function TabButton({
  icon: Icon,
  label,
  active,
  onClick,
  shortcut,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
  onClick: () => void
  shortcut?: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors duration-150',
        active
          ? 'bg-muted text-foreground font-medium'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

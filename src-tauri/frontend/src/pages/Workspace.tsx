/**
 * Workspace — project-specific main panel content.
 *
 * Rendered inside WorkspaceLayout's main panel via <Outlet />.
 * The header + status bar live in WorkspaceHeader (rendered by WorkspaceLayout),
 * so they span the full middle column and are never compressed by the review panel.
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { api } from '@desktop/lib/api-client'
import { useProjectStore } from '@desktop/stores/project-store'
import { useLayoutStore } from '@desktop/stores/layout-store'
import { useStreamEvents } from '@desktop/hooks/use-stream-events'
import { ChatPanel } from '@desktop/components/chat/ChatPanel'
import { PlanGraph } from '@desktop/components/plan/PlanGraph'
import type { Project } from '@desktop/types'

export function Workspace() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject)
  const workspaceTab = useLayoutStore((s) => s.workspaceTab)

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Load project data and push it to the shared store (WorkspaceHeader reads from there)
  useEffect(() => {
    if (!id) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setNotFound(false)
      try {
        const p = await api.get<Project>(`/api/data/projects/${id}`)
        if (!cancelled) {
          setCurrentProject(p)
          setActiveProject(p.id)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setCurrentProject(null)
          setNotFound(true)
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
      setActiveProject(null)
      setCurrentProject(null)
    }
  }, [id, setActiveProject, setCurrentProject])

  // SSE stream events for this project
  useStreamEvents({
    projectId: id ?? '',
    enabled: !!id && !loading && !notFound,
  })

  if (loading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
        Loading workspace...
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
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
    <div className="absolute inset-0 overflow-hidden">
      {workspaceTab === 'chat' && id && <ChatPanel projectId={id} />}
      {workspaceTab === 'plan' && id && <PlanGraph projectId={id} />}
    </div>
  )
}

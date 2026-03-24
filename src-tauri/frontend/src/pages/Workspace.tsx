import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { ArrowLeft, Terminal, FileText, GitBranch } from 'lucide-react'
import { api } from '@desktop/lib/api-client'
import { sidecarHealthCheck } from '@desktop/lib/tauri-bridge'
import type { Project } from '@desktop/types'

export function Workspace() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [sidecarOk, setSidecarOk] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api
      .get<Project>(`/api/data/projects/${id}`)
      .then((p) => setProject(p))
      .catch(() => setProject(null))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    // Check sidecar health on mount
    sidecarHealthCheck()
      .then(setSidecarOk)
      .catch(() => setSidecarOk(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading workspace...
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <p>Project not found</p>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-primary hover:underline"
        >
          Back to projects
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header
        className="flex items-center gap-3 px-4 py-3 border-b"
        data-tauri-drag-region
      >
        <button
          onClick={() => navigate('/')}
          className="p-1.5 rounded-md hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-lg">{project.icon ?? '📋'}</span>
        <h1 className="font-semibold truncate">{project.name}</h1>

        {/* Sidecar status indicator */}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={`w-2 h-2 rounded-full ${
              sidecarOk === null
                ? 'bg-warning'
                : sidecarOk
                  ? 'bg-success'
                  : 'bg-error'
            }`}
          />
          {sidecarOk === null
            ? 'Checking agent...'
            : sidecarOk
              ? 'Agent connected'
              : 'Agent offline'}
        </div>
      </header>

      {/* Workspace body - placeholder panels */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 border-r flex flex-col gap-1 p-2">
          <SidebarItem icon={FileText} label="Plan" active />
          <SidebarItem icon={Terminal} label="Terminal" />
          <SidebarItem icon={GitBranch} label="Git" />
        </aside>

        {/* Main content */}
        <main className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <p className="text-sm">Workspace ready</p>
            <p className="text-xs mt-1 opacity-60">
              {project.workingDirectory ?? 'No working directory set'}
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}

function SidebarItem({
  icon: Icon,
  label,
  active = false,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active?: boolean
}) {
  return (
    <button
      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
        active
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  )
}

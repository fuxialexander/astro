import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Folder, Plus, RefreshCw } from 'lucide-react'
import { api } from '@desktop/lib/api-client'
import type { Project } from '@desktop/types'

export function ProjectList() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadProjects = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<Project[]>('/api/data/projects')
      setProjects(data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProjects()
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Title bar area - draggable for native window feel */}
      <header
        className="flex items-center justify-between px-6 py-4 border-b"
        data-tauri-drag-region
      >
        <h1 className="text-lg font-semibold tracking-tight">Astro</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadProjects()}
            className="p-2 rounded-md hover:bg-muted transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>
      </header>

      {/* Project grid */}
      <main className="flex-1 overflow-y-auto p-6">
        {loading && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            Loading projects...
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-48 text-error">
            {error}
          </div>
        )}

        {!loading && !error && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
            <Folder className="w-10 h-10 opacity-40" />
            <p>No projects yet</p>
          </div>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => navigate(`/project/${project.id}`)}
                className="flex flex-col gap-2 p-4 rounded-lg border bg-card text-left hover:border-primary/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{project.icon ?? '📋'}</span>
                  <span className="font-medium text-card-foreground truncate">
                    {project.name}
                  </span>
                </div>
                {project.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {project.description}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-auto pt-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: project.color ?? '#3b82f6' }}
                  />
                  <span className="text-xs text-muted-foreground capitalize">
                    {project.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

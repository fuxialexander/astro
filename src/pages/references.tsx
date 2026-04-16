import { useState, useCallback } from 'react'
import { BookOpen, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/stores/project-store'
import { ReferenceList } from '@/components/references/reference-list'
import type { Reference } from '@/types'

export function References() {
  const projects = useProjectStore((s) => s.projects)
  const updateProject = useProjectStore((s) => s.updateProject)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    projects[0]?.id ?? null,
  )

  const selectedProject = projects.find((p) => p.id === selectedProjectId)
  const references: Reference[] = Array.isArray(selectedProject?.references)
    ? (selectedProject.references as Reference[])
    : []

  const handleAdd = useCallback(
    async (ref: Reference) => {
      if (!selectedProjectId || !selectedProject) return
      const updated = [...references, ref]
      await updateProject(selectedProjectId, { references: updated })
    },
    [selectedProjectId, selectedProject, references, updateProject],
  )

  const handleUpdate = useCallback(
    async (id: string, updates: Partial<Reference>) => {
      if (!selectedProjectId || !selectedProject) return
      const updated = references.map((r) => (r.id === id ? { ...r, ...updates } : r))
      await updateProject(selectedProjectId, { references: updated })
    },
    [selectedProjectId, selectedProject, references, updateProject],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      if (!selectedProjectId || !selectedProject) return
      const updated = references.filter((r) => r.id !== id)
      await updateProject(selectedProjectId, { references: updated })
    },
    [selectedProjectId, selectedProject, references, updateProject],
  )

  return (
    <div className="flex h-full overflow-hidden">
      {/* Project list */}
      <aside className="w-56 shrink-0 border-r flex flex-col overflow-y-auto">
        <div className="px-4 py-3 border-b">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Projects
          </h2>
        </div>
        <div className="flex-1 py-1">
          {projects.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">No projects</p>
          ) : (
            projects.map((project) => {
              const refCount = Array.isArray(project.references) ? project.references.length : 0
              return (
                <button
                  key={project.id}
                  onClick={() => setSelectedProjectId(project.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-4 py-2 text-left text-sm transition-colors',
                    'hover:bg-muted/50',
                    selectedProjectId === project.id
                      ? 'bg-muted font-medium'
                      : 'text-muted-foreground',
                  )}
                >
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{project.name ?? 'Untitled'}</span>
                  {refCount > 0 && (
                    <span className="text-[10px] text-muted-foreground">{refCount}</span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </aside>

      {/* Reference panel */}
      <main className="flex-1 overflow-y-auto">
        {selectedProject ? (
          <div className="max-w-3xl mx-auto px-6 py-6">
            <ReferenceList
              references={references}
              onAddReference={handleAdd}
              onUpdateReference={handleUpdate}
              onDeleteReference={handleDelete}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <BookOpen className="h-8 w-8 opacity-30" />
            <p className="text-sm">Select a project to manage references</p>
          </div>
        )}
      </main>
    </div>
  )
}

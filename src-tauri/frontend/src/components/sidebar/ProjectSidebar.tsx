/**
 * ProjectSidebar — left-side panel with project list, search, and quick actions.
 *
 * Structure:
 *   ┌─────────────────────────────┐
 *   │ [Astro] logo    [⌘K] [+]   │ ← header (Tauri drag region)
 *   ├─────────────────────────────┤
 *   │ 🔍 Search...               │ ← search input
 *   ├─────────────────────────────┤
 *   │ PROJECT                     │
 *   │  📋 My Project     active  │ ← ProjectCard × N
 *   │     · running thread        │ ← ThreadList (collapsed by default)
 *   │  ...                        │
 *   ├─────────────────────────────┤
 *   │ [Settings]   [New Project]  │ ← footer actions
 *   └─────────────────────────────┘
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  Plus,
  Settings,
  RefreshCw,
  ChevronLeft,
  Search,
} from 'lucide-react'

import { cn } from '@desktop/lib/utils'
import { useProjectStore } from '@desktop/stores/project-store'
import { useLayoutStore } from '@desktop/stores/layout-store'
import { ProjectCard } from '@desktop/components/sidebar/ProjectCard'

export function ProjectSidebar() {
  const navigate = useNavigate()
  const { id: activeId } = useParams<{ id: string }>()

  const { projects, loading, error, loadProjects } = useProjectStore()
  const { toggleSidebar, toggleCommandPalette } = useLayoutStore()

  const [search, setSearch] = useState('')

  // Load projects on mount
  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  // Filter by search query
  const filtered = search.trim()
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          (p.description ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : projects

  // Split: active projects first, then archived
  const active = filtered.filter((p) => p.status === 'active')
  const archived = filtered.filter((p) => p.status === 'archived')

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-1 px-3 h-11 border-b flex-shrink-0"
        data-tauri-drag-region
      >
        <span className="text-sm font-semibold tracking-tight flex-1 select-none">
          Astro
        </span>

        {/* Open command palette */}
        <button
          onClick={toggleCommandPalette}
          className={cn(
            'p-1.5 rounded-md text-muted-foreground text-xs',
            'hover:bg-muted hover:text-foreground transition-colors duration-150',
          )}
          title="Command palette (⌘K)"
        >
          <span className="font-mono text-[10px] opacity-70">⌘K</span>
        </button>

        {/* Reload */}
        <button
          onClick={() => void loadProjects()}
          disabled={loading}
          className={cn(
            'p-1.5 rounded-md text-muted-foreground',
            'hover:bg-muted hover:text-foreground transition-colors duration-150',
            loading && 'animate-spin',
          )}
          title="Refresh projects"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        {/* Collapse sidebar */}
        <button
          onClick={toggleSidebar}
          className={cn(
            'p-1.5 rounded-md text-muted-foreground',
            'hover:bg-muted hover:text-foreground transition-colors duration-150',
          )}
          title="Collapse sidebar (⌘B)"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Search ─────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-b flex-shrink-0">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted">
          <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter projects..."
            className={cn(
              'flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground',
              'outline-none border-none min-w-0',
            )}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Project List ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1 scrollbar-hide">
        {/* Loading state */}
        {loading && projects.length === 0 && (
          <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
            Loading...
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="px-3 py-2 text-xs text-error">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
            <p className="text-xs">
              {search ? 'No matching projects' : 'No projects yet'}
            </p>
          </div>
        )}

        {/* Active projects */}
        {active.length > 0 && (
          <section>
            <PanelSectionLabel label="Projects" />
            <div className="flex flex-col gap-0.5 px-1">
              {active.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  active={project.id === activeId}
                  onClick={() => navigate(`/project/${project.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Archived projects */}
        {archived.length > 0 && (
          <section className="mt-4">
            <PanelSectionLabel label="Archived" />
            <div className="flex flex-col gap-0.5 px-1">
              {archived.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  active={project.id === activeId}
                  onClick={() => navigate(`/project/${project.id}`)}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ── Footer actions ────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-2 py-2 border-t flex-shrink-0">
        <button
          className={cn(
            'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-muted-foreground',
            'hover:bg-muted hover:text-foreground transition-colors duration-150',
          )}
          title="Settings"
        >
          <Settings className="w-3.5 h-3.5" />
          Settings
        </button>

        <div className="flex-1" />

        <button
          className={cn(
            'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs',
            'bg-primary text-primary-foreground',
            'hover:opacity-90 transition-opacity duration-150',
          )}
          title="New project"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </button>
      </div>
    </div>
  )
}

// ── Helper ──────────────────────────────────────────────────────────

function PanelSectionLabel({ label }: { label: string }) {
  return (
    <div className="px-4 pt-3 pb-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground select-none">
        {label}
      </span>
    </div>
  )
}

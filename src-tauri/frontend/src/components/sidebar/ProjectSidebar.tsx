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
import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router'
import {
  Plus,
  Settings,
  RefreshCw,
  ChevronLeft,
  Search,
  Home,
  Zap,
  Monitor,
} from 'lucide-react'

import { cn } from '@desktop/lib/utils'
import { useProjectStore } from '@desktop/stores/project-store'
import { usePlanStore } from '@desktop/stores/plan-store'
import { useLayoutStore } from '@desktop/stores/layout-store'
import { ProjectCard } from '@desktop/components/sidebar/ProjectCard'

export function ProjectSidebar() {
  const navigate = useNavigate()
  const { id: activeId } = useParams<{ id: string }>()

  const location = useLocation()
  const { projects, loading, error, loadProjects } = useProjectStore()
  const nodes = usePlanStore((s) => s.nodes)
  const { toggleSidebar, toggleCommandPalette } = useLayoutStore()

  const { createProject } = useProjectStore()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  // Active task count for badge
  const activeTaskCount = useMemo(
    () => nodes.filter((n) => n.status === 'in_progress' || n.status === 'dispatched').length,
    [nodes],
  )

  // Vim-style j/k navigation for project list
  const projectListRef = useRef<HTMLDivElement>(null)
  const [focusedIndex, setFocusedIndex] = useState(-1)

  const handleVimNav = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return

    const items = projectListRef.current?.querySelectorAll('[data-project-card]')
    if (!items?.length) return

    if (e.key === 'j') {
      e.preventDefault()
      setFocusedIndex((prev) => Math.min(prev + 1, items.length - 1))
    } else if (e.key === 'k') {
      e.preventDefault()
      setFocusedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && focusedIndex >= 0) {
      e.preventDefault()
      ;(items[focusedIndex] as HTMLElement)?.click()
    }
  }, [focusedIndex])

  useEffect(() => {
    window.addEventListener('keydown', handleVimNav)
    return () => window.removeEventListener('keydown', handleVimNav)
  }, [handleVimNav])

  // Scroll focused item into view
  useEffect(() => {
    const items = projectListRef.current?.querySelectorAll('[data-project-card]')
    if (items && focusedIndex >= 0 && focusedIndex < items.length) {
      items[focusedIndex].scrollIntoView({ block: 'nearest' })
    }
  }, [focusedIndex])

  // Listen for ⌘N new project shortcut
  useEffect(() => {
    const handler = () => { setCreating(true); setNewName('') }
    window.addEventListener('astro:new-project', handler)
    return () => window.removeEventListener('astro:new-project', handler)
  }, [])

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

      {/* ── Navigation ──────────────────────────────────────────── */}
      <nav className="flex flex-col gap-0.5 px-2 py-2 border-b flex-shrink-0">
        <NavItem
          icon={Home}
          label="Home"
          active={location.pathname === '/'}
          onClick={() => navigate('/')}
          shortcut="⌘⇧D"
        />
        <NavItem
          icon={Zap}
          label="Active Tasks"
          active={location.pathname === '/active'}
          onClick={() => navigate('/active')}
          badge={activeTaskCount > 0 ? activeTaskCount : undefined}
        />
        <NavItem
          icon={Monitor}
          label="Environments"
          active={location.pathname === '/environments'}
          onClick={() => navigate('/environments')}
          shortcut="⌘⇧E"
        />
      </nav>

      {/* ── Search ─────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-b flex-shrink-0">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted">
          <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <input
            data-sidebar-search
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); (e.target as HTMLElement).blur() } }}
            placeholder="Filter projects... (/)"
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
      <div ref={projectListRef} className="flex-1 overflow-y-auto overflow-x-hidden py-1 scrollbar-hide">
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
                <div key={project.id} data-project-card>
                  <ProjectCard
                    project={project}
                    active={project.id === activeId}
                    onClick={() => navigate(`/project/${project.id}`)}
                  />
                </div>
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
                <div key={project.id} data-project-card>
                  <ProjectCard
                    project={project}
                    active={project.id === activeId}
                    onClick={() => navigate(`/project/${project.id}`)}
                  />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ── New project inline form ───────────────────────────────── */}
      {creating && (
        <form
          className="px-2 py-2 border-t flex items-center gap-1.5 flex-shrink-0"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!newName.trim()) return
            const project = await createProject(newName)
            setCreating(false)
            setNewName('')
            if (project) navigate(`/project/${project.id}`)
          }}
        >
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setCreating(false); setNewName('') } }}
            placeholder="Project name…"
            className={cn(
              'flex-1 min-w-0 bg-muted rounded-md px-2 py-1 text-xs',
              'outline-none text-foreground placeholder:text-muted-foreground',
            )}
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            className="px-2 py-1 rounded-md text-xs bg-primary text-primary-foreground disabled:opacity-40"
          >
            Create
          </button>
        </form>
      )}

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
          onClick={() => { setCreating(true); setNewName('') }}
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

// ── Helpers ─────────────────────────────────────────────────────────

function NavItem({ icon: Icon, label, active, onClick, shortcut, badge }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
  onClick: () => void
  shortcut?: string
  badge?: number
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors duration-100',
        active
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
      title={shortcut}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="flex items-center justify-center h-4 min-w-[16px] rounded-full bg-info text-[10px] font-bold text-white px-1">
          {badge}
        </span>
      )}
      {shortcut && !badge && (
        <kbd className="text-[9px] font-mono text-muted-foreground/50">{shortcut}</kbd>
      )}
    </button>
  )
}

function PanelSectionLabel({ label }: { label: string }) {
  return (
    <div className="px-4 pt-3 pb-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground select-none">
        {label}
      </span>
    </div>
  )
}

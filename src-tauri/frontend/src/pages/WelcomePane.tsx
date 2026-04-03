/**
 * WelcomePane — main panel content for the root route.
 *
 * Shown when no project is open. Provides quick navigation hints
 * and shows a summary grid of active projects.
 */
import { useNavigate } from 'react-router'
import { Folder, Zap, Terminal, GitBranch } from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import { useProjectStore } from '@desktop/stores/project-store'
import { useLayoutStore } from '@desktop/stores/layout-store'

export function WelcomePane() {
  const navigate = useNavigate()
  const { projects } = useProjectStore()
  const { toggleCommandPalette } = useLayoutStore()
  const activeProjects = projects.filter((p) => p.status === 'active')

  return (
    <div className="flex flex-col h-full overflow-y-auto">

      {/* Hero */}
      <div className="flex flex-col items-center justify-center gap-6 px-8 py-16 flex-shrink-0">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Zap className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome to Astro
          </h1>
          <p className="text-sm text-muted-foreground max-w-xs">
            Select a project from the sidebar, or open the command palette to get started.
          </p>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleCommandPalette}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg',
              'bg-primary text-primary-foreground text-sm font-medium',
              'hover:opacity-90 transition-opacity duration-150',
            )}
          >
            <span className="font-mono text-xs opacity-80">⌘K</span>
            Command palette
          </button>
        </div>

        {/* Keyboard shortcut hints */}
        <div className="flex items-center gap-6 text-xs text-muted-foreground">
          <ShortcutHint keys="⌘B" label="Toggle sidebar" />
          <ShortcutHint keys="⌘J" label="Review panel" />
          <ShortcutHint keys="⌘1–3" label="Focus panel" />
        </div>
      </div>

      {/* Recent projects grid */}
      {activeProjects.length > 0 && (
        <div className="px-8 pb-8 flex-shrink-0">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Recent Projects
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {activeProjects.slice(0, 6).map((project) => (
              <button
                key={project.id}
                onClick={() => navigate(`/project/${project.id}`)}
                className={cn(
                  'flex items-start gap-3 p-4 rounded-xl border text-left',
                  'bg-card hover:border-primary/40 hover:bg-muted/50',
                  'transition-colors duration-150',
                )}
              >
                <span className="text-xl mt-0.5">{project.icon ?? '📋'}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{project.name}</p>
                  {project.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {project.description}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Feature hints when no projects */}
      {activeProjects.length === 0 && (
        <div className="grid grid-cols-3 gap-4 px-8 pb-8 flex-shrink-0">
          <FeatureCard
            icon={<Folder className="w-4 h-4" />}
            title="Plan"
            description="Break complex goals into a dependency graph"
          />
          <FeatureCard
            icon={<Terminal className="w-4 h-4" />}
            title="Execute"
            description="Dispatch tasks to local, HPC, or cloud machines"
          />
          <FeatureCard
            icon={<GitBranch className="w-4 h-4" />}
            title="Review"
            description="Inspect execution traces and verify outcomes"
          />
        </div>
      )}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

function ShortcutHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="font-mono text-[10px] border rounded px-1 py-0.5">{keys}</kbd>
      {label}
    </span>
  )
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col gap-2 p-4 rounded-xl border bg-card">
      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
        {icon}
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

/**
 * CommandPalette — cmdk-based global command palette.
 *
 * Triggered by Cmd+K (keyboard shortcut wired in WorkspaceLayout).
 * Opens as a dialog overlay with:
 *   - Search across projects
 *   - Navigation commands
 *   - Quick actions
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { Command } from 'cmdk'
import { Folder, Plus, Settings, ArrowRight, Hash } from 'lucide-react'

import { cn } from '@desktop/lib/utils'
import { useLayoutStore } from '@desktop/stores/layout-store'
import { useProjectStore } from '@desktop/stores/project-store'

export function CommandPalette() {
  const navigate = useNavigate()
  const { commandPaletteOpen, setCommandPaletteOpen, toggleSidebar, toggleReview } =
    useLayoutStore()
  const { projects } = useProjectStore()

  // Close on Escape is handled by Command.Dialog internally.
  // Wire Cmd+K as an additional toggle.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(!commandPaletteOpen)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandPaletteOpen, setCommandPaletteOpen])

  const close = () => setCommandPaletteOpen(false)

  const goToProject = (id: string) => {
    navigate(`/project/${id}`)
    close()
  }

  return (
    <Command.Dialog
      open={commandPaletteOpen}
      onOpenChange={setCommandPaletteOpen}
      label="Global command palette"
      // Render portal into body for proper stacking
      container={document.body}
    >
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-50 bg-black/30 backdrop-blur-sm',
          'animate-reveal',
        )}
        onClick={close}
      />

      {/* Dialog panel */}
      <div
        className={cn(
          'fixed left-1/2 top-[20vh] z-50 -translate-x-1/2',
          'w-full max-w-[540px] px-4',
          'animate-reveal',
        )}
      >
        <div
          className={cn(
            'rounded-xl border bg-popover shadow-2xl overflow-hidden',
            'flex flex-col',
          )}
        >
          {/* Search input */}
          <div className="flex items-center gap-2 px-4 border-b h-12">
            <Hash className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <Command.Input
              placeholder="Search projects, commands..."
              className={cn(
                'flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground',
                'outline-none border-none py-0',
              )}
            />
            <kbd className="text-[10px] font-mono text-muted-foreground border rounded px-1 py-0.5">
              ESC
            </kbd>
          </div>

          {/* Results list */}
          <Command.List className="max-h-[360px] overflow-y-auto p-1.5">
            <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>

            {/* Projects */}
            {projects.length > 0 && (
              <Command.Group
                heading="Projects"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {projects.map((project) => (
                  <Command.Item
                    key={project.id}
                    value={`project-${project.id}-${project.name}`}
                    onSelect={() => goToProject(project.id)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer',
                      'text-sm text-foreground',
                      'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
                      'transition-colors duration-100',
                    )}
                  >
                    <span className="text-base">{project.icon ?? '📋'}</span>
                    <span className="flex-1 truncate">{project.name}</span>
                    {project.color && (
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: project.color }}
                      />
                    )}
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-50" />
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Navigation commands */}
            <Command.Group
              heading="Navigate"
              className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <Command.Item
                value="navigate home projects"
                onSelect={() => { navigate('/'); close() }}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm',
                  'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
                  'transition-colors duration-100',
                )}
              >
                <Folder className="w-4 h-4 text-muted-foreground" />
                <span className="flex-1">Go to Projects</span>
                <Shortcut keys={['⌘', 'H']} />
              </Command.Item>

              <Command.Item
                value="toggle sidebar"
                onSelect={() => { toggleSidebar(); close() }}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm',
                  'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
                  'transition-colors duration-100',
                )}
              >
                <Folder className="w-4 h-4 text-muted-foreground" />
                <span className="flex-1">Toggle Sidebar</span>
                <Shortcut keys={['⌘', 'B']} />
              </Command.Item>

              <Command.Item
                value="toggle review panel"
                onSelect={() => { toggleReview(); close() }}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm',
                  'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
                  'transition-colors duration-100',
                )}
              >
                <Folder className="w-4 h-4 text-muted-foreground" />
                <span className="flex-1">Toggle Review Panel</span>
                <Shortcut keys={['⌘', 'J']} />
              </Command.Item>
            </Command.Group>

            {/* Quick actions */}
            <Command.Group
              heading="Actions"
              className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <Command.Item
                value="new project create"
                onSelect={close}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm',
                  'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
                  'transition-colors duration-100',
                )}
              >
                <Plus className="w-4 h-4 text-muted-foreground" />
                <span className="flex-1">New Project</span>
              </Command.Item>

              <Command.Item
                value="settings preferences"
                onSelect={close}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm',
                  'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
                  'transition-colors duration-100',
                )}
              >
                <Settings className="w-4 h-4 text-muted-foreground" />
                <span className="flex-1">Open Settings</span>
                <Shortcut keys={['⌘', ',']} />
              </Command.Item>
            </Command.Group>
          </Command.List>

          {/* Footer hint */}
          <div className="flex items-center gap-3 px-4 py-2 border-t text-[10px] text-muted-foreground select-none">
            <span><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono">↵</kbd> select</span>
            <span><kbd className="font-mono">ESC</kbd> close</span>
          </div>
        </div>
      </div>
    </Command.Dialog>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

function Shortcut({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-0.5">
      {keys.map((k) => (
        <kbd
          key={k}
          className="text-[10px] font-mono text-muted-foreground border rounded px-1 py-0.5 leading-none"
        >
          {k}
        </kbd>
      ))}
    </div>
  )
}

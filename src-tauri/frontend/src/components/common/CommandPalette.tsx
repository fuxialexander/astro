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
import {
  Plus, Settings, ArrowRight, Hash,
  Home, Zap, Monitor, Terminal, GitCommit,
  PanelLeft, PanelRight, Search,
} from 'lucide-react'

import { cn } from '@desktop/lib/utils'
import { useLayoutStore } from '@desktop/stores/layout-store'
import { useProjectStore } from '@desktop/stores/project-store'

export function CommandPalette() {
  const navigate = useNavigate()
  const {
    commandPaletteOpen, setCommandPaletteOpen,
    toggleSidebar, toggleReview, toggleTerminal,
  } = useLayoutStore()
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
            <Command.Group heading="Navigate" className={GROUP_HEADING_CLS}>
              <CmdItem value="navigate home dashboard" icon={Home} label="Home" shortcut={['⌘', '⇧', 'D']} onSelect={() => { navigate('/'); close() }} />
              <CmdItem value="navigate active tasks" icon={Zap} label="Active Tasks" onSelect={() => { navigate('/active'); close() }} />
              <CmdItem value="navigate environments machines" icon={Monitor} label="Environments" shortcut={['⌘', '⇧', 'E']} onSelect={() => { navigate('/environments'); close() }} />
            </Command.Group>

            {/* Panel commands */}
            <Command.Group heading="Panels" className={GROUP_HEADING_CLS}>
              <CmdItem value="toggle sidebar" icon={PanelLeft} label="Toggle Sidebar" shortcut={['⌘', 'B']} onSelect={() => { toggleSidebar(); close() }} />
              <CmdItem value="toggle review diff panel" icon={PanelRight} label="Toggle Review Panel" shortcut={['⌘', '⇧', 'G']} onSelect={() => { toggleReview(); close() }} />
              <CmdItem value="toggle terminal console" icon={Terminal} label="Toggle Terminal" shortcut={['⌘', 'J']} onSelect={() => { toggleTerminal(); close() }} />
              <CmdItem value="focus search filter" icon={Search} label="Focus Search" shortcut={['/']} onSelect={() => { close(); setTimeout(() => document.querySelector<HTMLInputElement>('[data-sidebar-search]')?.focus(), 100) }} />
            </Command.Group>

            {/* Quick actions */}
            <Command.Group heading="Actions" className={GROUP_HEADING_CLS}>
              <CmdItem value="new project create" icon={Plus} label="New Project" shortcut={['⌘', 'N']} onSelect={() => { close(); window.dispatchEvent(new CustomEvent('astro:new-project')) }} />
              <CmdItem value="git commit save" icon={GitCommit} label="Git Commit" shortcut={['⌘', 'S']} onSelect={() => { close(); window.dispatchEvent(new CustomEvent('astro:git-commit')) }} />
              <CmdItem value="settings preferences" icon={Settings} label="Open Settings" shortcut={['⌘', ',']} onSelect={close} />
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

const ITEM_CLS = cn(
  'flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm',
  'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
  'transition-colors duration-100',
)

const GROUP_HEADING_CLS = "mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground"

function CmdItem({ value, icon: Icon, label, shortcut, onSelect }: {
  value: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  shortcut?: string[]
  onSelect: () => void
}) {
  return (
    <Command.Item value={value} onSelect={onSelect} className={ITEM_CLS}>
      <Icon className="w-4 h-4 text-muted-foreground" />
      <span className="flex-1">{label}</span>
      {shortcut && <Shortcut keys={shortcut} />}
    </Command.Item>
  )
}

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

import { useEffect } from "react"
import { Command } from "cmdk"
import { useNavigate } from "react-router"
import { LayoutDashboard, Folder, Inbox, Server, Plus, Sun, Moon, Search } from "lucide-react"
import { useUIStore } from "@/stores/ui-store"
import { useProjectStore } from "@/stores/project-store"
import { useTheme } from "@/components/theme-provider"

export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen)
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const projects = useProjectStore((s) => s.projects)
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!open)
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, setOpen])

  function runAction(fn: () => void) {
    fn()
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
      <div className="fixed left-1/2 top-[20%] w-full max-w-[520px] -translate-x-1/2">
        <Command className="rounded-xl border border-border bg-popover shadow-2xl overflow-hidden" label="Command Palette">
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Command.Input
              autoFocus
              placeholder="Type a command or search..."
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Command.List className="max-h-[320px] overflow-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>

            <Command.Group heading="Navigation" className="text-xs text-muted-foreground px-2 py-1.5">
              <Command.Item
                onSelect={() => runAction(() => navigate("/"))}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer data-[selected=true]:bg-accent"
              >
                <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
                Dashboard
              </Command.Item>
              <Command.Item
                onSelect={() => runAction(() => navigate("/projects"))}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer data-[selected=true]:bg-accent"
              >
                <Folder className="h-4 w-4 text-muted-foreground" />
                Projects
              </Command.Item>
              <Command.Item
                onSelect={() => runAction(() => navigate("/judgment"))}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer data-[selected=true]:bg-accent"
              >
                <Inbox className="h-4 w-4 text-muted-foreground" />
                Judgment Queue
              </Command.Item>
              <Command.Item
                onSelect={() => runAction(() => navigate("/environments"))}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer data-[selected=true]:bg-accent"
              >
                <Server className="h-4 w-4 text-muted-foreground" />
                Environments
              </Command.Item>
            </Command.Group>

            <Command.Group heading="Actions" className="text-xs text-muted-foreground px-2 py-1.5">
              <Command.Item
                onSelect={() => runAction(() => navigate("/projects/new"))}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer data-[selected=true]:bg-accent"
              >
                <Plus className="h-4 w-4 text-muted-foreground" />
                New Project
              </Command.Item>
              <Command.Item
                onSelect={() => runAction(() => setTheme(theme === "dark" ? "light" : "dark"))}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer data-[selected=true]:bg-accent"
              >
                {theme === "dark" ? <Sun className="h-4 w-4 text-muted-foreground" /> : <Moon className="h-4 w-4 text-muted-foreground" />}
                Toggle {theme === "dark" ? "Light" : "Dark"} Mode
              </Command.Item>
            </Command.Group>

            {projects.length > 0 && (
              <Command.Group heading="Projects" className="text-xs text-muted-foreground px-2 py-1.5">
                {projects.filter(p => p.status === "active").map((project) => (
                  <Command.Item
                    key={project.id}
                    onSelect={() => runAction(() => navigate(`/project/${project.id}`))}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer data-[selected=true]:bg-accent"
                  >
                    <Folder className="h-4 w-4 text-muted-foreground" />
                    {project.name}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>

          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span>Navigate with <kbd className="rounded bg-muted px-1.5 py-0.5 font-primary text-[10px]">↑↓</kbd></span>
            <span>Open with <kbd className="rounded bg-muted px-1.5 py-0.5 font-primary text-[10px]">↵</kbd></span>
            <span>Close with <kbd className="rounded bg-muted px-1.5 py-0.5 font-primary text-[10px]">esc</kbd></span>
          </div>
        </Command>
      </div>
    </div>
  )
}

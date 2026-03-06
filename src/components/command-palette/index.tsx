import { useEffect, useState, useMemo, useRef, useCallback } from "react"
import { Command } from "cmdk"
import { useNavigate } from "react-router"
import { Search, X, Inbox } from "lucide-react"
import Fuse from "fuse.js"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useUIStore } from "@/stores/ui-store"
import { useProjectStore } from "@/stores/project-store"
import { useTheme } from "@/components/theme-provider"
import { getStaticCommands, getRecentCommands } from "@/lib/commands"
import type { CommandItem as CommandItemType, CommandCategory } from "@/types"
import { CommandItem } from "./command-item"
import { CommandCategory as CategorySection } from "./command-category"
import { Breadcrumbs } from "./breadcrumbs"
import { QuickActions } from "./quick-actions"
import { TeamSelectorDialog } from "@/components/team-selector-dialog"
import "./command-palette.css"

export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen)
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const commandHistory = useUIStore((s) => s.commandHistory)
  const loadCommandHistory = useUIStore((s) => s.loadCommandHistory)
  const addCommandToHistory = useUIStore((s) => s.addCommandToHistory)
  const breadcrumbs = useUIStore((s) => s.commandBreadcrumbs)
  const setBreadcrumbs = useUIStore((s) => s.setCommandBreadcrumbs)
  const selectedCommands = useUIStore((s) => s.selectedCommands)
  const toggleCommandSelection = useUIStore((s) => s.toggleCommandSelection)
  const clearCommandSelection = useUIStore((s) => s.clearCommandSelection)

  const allProjects = useProjectStore((s) => s.projects)
  // Separate planning projects from playground sessions
  const projects = useMemo(() => allProjects.filter((p) => p.projectType !== 'playground'), [allProjects])
  const playgroundProjects = useMemo(() => allProjects.filter((p) => p.projectType === 'playground'), [allProjects])
  const { theme, setTheme, availableThemes } = useTheme()
  const navigate = useNavigate()

  const [searchQuery, setSearchQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [showTeamSelector, setShowTeamSelector] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)

  // Load command history on mount
  useEffect(() => {
    loadCommandHistory()
  }, [loadCommandHistory])

  // Build all commands (static + dynamic)
  const allCommands = useMemo(() => {
    const staticCommands = getStaticCommands().map(cmd => ({
      ...cmd,
      icon: cmd.icon as React.ComponentType<{ className?: string }> | undefined,
    }))

    // Add project commands
    const projectCommands: CommandItemType[] = projects
      .filter((p) => p.status === "active")
      .map((project) => ({
        id: `project-${project.id}`,
        label: project.name,
        description: project.description,
        icon: undefined,
        category: "projects" as CommandCategory,
        keywords: ["project", project.name.toLowerCase()],
        action: () => navigate(`/project/${project.id}/graph`),
        preview: {
          title: project.name,
          content: project.description,
          metadata: {
            ...(project.health && { Health: project.health.replace(/_/g, ' ') }),
            ...(project.progress !== undefined && { Progress: `${project.progress}%` }),
            ...(project.lead && { Lead: project.lead }),
            ...(project.startDate && { Started: new Date(project.startDate).toLocaleDateString() }),
            ...(project.targetDate && { Target: new Date(project.targetDate).toLocaleDateString() }),
            ...(project.labels && project.labels.length > 0 && {
              Labels: project.labels.map(l => l.name).join(', ')
            }),
          },
        },
      }))

    return [...staticCommands, ...projectCommands] as CommandItemType[]
  }, [projects, navigate])

  // Add actions to static commands
  const commandsWithActions = useMemo(() => {
    return allCommands.map((cmd) => {
      if (cmd.action) return cmd

      // Add navigation actions
      if (cmd.id === "nav-dashboard") {
        return { ...cmd, action: () => navigate("/") }
      }
      if (cmd.id === "nav-projects") {
        return { ...cmd, action: () => navigate("/projects") }
      }
      if (cmd.id === "nav-tasks") {
        return { ...cmd, action: () => navigate("/tasks") }
      }
      if (cmd.id === "nav-environments") {
        return { ...cmd, action: () => navigate("/environments") }
      }

      if (cmd.id === "nav-initiatives") {
        return { ...cmd, action: () => navigate("/initiatives") }
      }
      if (cmd.id === "nav-active") {
        return { ...cmd, action: () => navigate("/active") }
      }
      if (cmd.id === "nav-workflows") {
        return { ...cmd, action: () => navigate("/workflows") }
      }
      if (cmd.id === "nav-settings") {
        return { ...cmd, action: () => navigate("/settings") }
      }

      // Add action commands
      if (cmd.id === "action-new-project") {
        return { ...cmd, action: () => navigate("/projects") }
      }
      if (cmd.id === "action-plan-generation") {
        return { ...cmd, action: () => navigate("/plan") }
      }
      if (cmd.id === "action-new-task") {
        // Create nested commands for each project
        const children: CommandItemType[] = projects
          .filter((p) => p.status === "active")
          .map((project) => ({
            id: `add-task-${project.id}`,
            label: project.name,
            description: `Add task to ${project.name}`,
            icon: undefined,
            category: "actions" as CommandCategory,
            keywords: ["task", project.name.toLowerCase()],
            action: () => navigate(`/project/${project.id}/plan?addTask=true`),
            preview: {
              title: `Add Task to ${project.name}`,
              content: project.description,
              metadata: {
                Action: "Create new task",
                ...(project.health && { Health: project.health.replace(/_/g, ' ') }),
                ...(project.progress !== undefined && { Progress: `${project.progress}%` }),
              },
            },
          }))
        return { ...cmd, children }
      }
      if (cmd.id === "action-open-project-chat") {
        // Create nested commands for planning projects
        const planChildren: CommandItemType[] = projects
          .filter((p) => p.status === "active")
          .map((project) => ({
            id: `project-chat-${project.id}`,
            label: project.name,
            description: `Open project chat for ${project.name}`,
            icon: undefined,
            category: "actions" as CommandCategory,
            keywords: ["chat", "plan", project.name.toLowerCase()],
            action: () => navigate(`/project/${project.id}/plan?chat=open`),
            preview: {
              title: `Plan Chat - ${project.name}`,
              content: project.description,
              metadata: {
                Action: "Open AI project chat",
                ...(project.health && { Health: project.health.replace(/_/g, ' ') }),
                ...(project.progress !== undefined && { Progress: `${project.progress}%` }),
              },
            },
          }))
        // Include playground sessions with their own URL
        const playgroundChildren: CommandItemType[] = playgroundProjects
          .filter((p) => p.status === "active")
          .map((project) => ({
            id: `project-chat-${project.id}`,
            label: project.name,
            description: `Open playground session: ${project.name}`,
            icon: undefined,
            category: "actions" as CommandCategory,
            keywords: ["chat", "playground", project.name.toLowerCase()],
            action: () => navigate(`/playground?projectId=${project.id}`),
            preview: {
              title: `Playground - ${project.name}`,
              content: project.description,
              metadata: {
                Action: "Open playground session",
                ...(project.workingDirectory && { Directory: project.workingDirectory }),
              },
            },
          }))
        return { ...cmd, children: [...planChildren, ...playgroundChildren] }
      }
      if (cmd.id === "action-new-initiative") {
        return { ...cmd, action: () => navigate("/initiatives") }
      }
      if (cmd.id === "action-new-team-project") {
        return { ...cmd, action: () => setShowTeamSelector(true) }
      }
      if (cmd.id === "action-toggle-theme") {
        // Cycle through all available themes
        const themeIds = availableThemes.map((t) => t.id)
        const currentIndex = themeIds.indexOf(theme)
        const nextIndex = (currentIndex + 1) % themeIds.length
        return {
          ...cmd,
          description: `Current: ${availableThemes.find((t) => t.id === theme)?.name ?? theme}`,
          action: () => setTheme(themeIds[nextIndex]),
        }
      }

      return cmd
    })
  }, [allCommands, navigate, theme, setTheme, availableThemes, projects, playgroundProjects])

  // Get commands to display (either root commands or children of current breadcrumb)
  const displayCommands = useMemo(() => {
    if (breadcrumbs.length > 0) {
      // Show children of the last breadcrumb
      const lastBreadcrumb = breadcrumbs[breadcrumbs.length - 1]
      return lastBreadcrumb.children ?? []
    }
    return commandsWithActions
  }, [breadcrumbs, commandsWithActions])

  // Fuzzy search setup
  const fuse = useMemo(
    () =>
      new Fuse(displayCommands, {
        keys: ["label", "description", "keywords"],
        threshold: 0.3,
        includeScore: true,
        includeMatches: true,
      }),
    [displayCommands]
  )

  // Filter and search commands
  const filteredCommands = useMemo(() => {
    if (searchQuery.length < 2) {
      // No search - show recent and all commands
      const recent = getRecentCommands(displayCommands, commandHistory)
      return {
        recent,
        byCategory: groupByCategory(displayCommands),
      }
    }

    // Fuzzy search
    const results = fuse.search(searchQuery)
    const scored = results.map((r) => ({
      ...r.item,
      score: Math.round((1 - (r.score || 0)) * 100),
    }))

    return {
      recent: [],
      byCategory: { search: scored },
    }
  }, [searchQuery, displayCommands, commandHistory, fuse])

  // Flatten commands for virtualization
  const flatCommands = useMemo(() => {
    const flat: Array<{ type: "category" | "item"; category?: CommandCategory; item?: CommandItemType & { score?: number }; count?: number }> = []

    if (filteredCommands.recent.length > 0) {
      flat.push({ type: "category", category: "recent", count: filteredCommands.recent.length })
      filteredCommands.recent.forEach((item) => flat.push({ type: "item", item }))
    }

    Object.entries(filteredCommands.byCategory).forEach(([category, items]) => {
      if (items.length > 0) {
        flat.push({ type: "category", category: category as CommandCategory, count: items.length })
        items.forEach((item) => flat.push({ type: "item", item }))
      }
    })

    return flat
  }, [filteredCommands])

  // Virtualized list — React Compiler auto-skips memoization for this component
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: flatCommands.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => (flatCommands[index].type === "category" ? 36 : 38),
    overscan: 5,
  })

  // Command execution handler
  const handleExecuteCommand = useCallback(
    async (item: CommandItemType) => {
      if (item.action) {
        await item.action()
        await addCommandToHistory(item.id)
        setOpen(false)
        clearCommandSelection()
        setBreadcrumbs([])
        setSearchQuery("")
      } else if (item.children && item.children.length > 0) {
        // Navigate into nested commands
        setBreadcrumbs([...breadcrumbs, item])
        setSearchQuery("") // Clear search when entering nested view
      }
    },
    [addCommandToHistory, setOpen, clearCommandSelection, breadcrumbs, setBreadcrumbs]
  )

  // Breadcrumb navigation handler
  const handleNavigateBack = useCallback(
    (index: number) => {
      if (index < 0) {
        setBreadcrumbs([])
      } else {
        setBreadcrumbs(breadcrumbs.slice(0, index + 1))
      }
      setSearchQuery("") // Clear search when navigating back
    },
    [breadcrumbs, setBreadcrumbs]
  )

  // Keyboard navigation
  useEffect(() => {
    if (!open) return

    const handler = (e: KeyboardEvent) => {
      // Close
      if (e.key === "Escape") {
        e.preventDefault()
        if (breadcrumbs.length > 0) {
          // Navigate back
          handleNavigateBack(breadcrumbs.length - 1)
        } else {
          setOpen(false)
          clearCommandSelection()
        }
        return
      }

      // Arrow navigation (skip category headers)
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((prev) => {
          // Find next item (skip categories)
          let next = prev + 1
          while (next < flatCommands.length && flatCommands[next].type !== "item") {
            next++
          }
          return next < flatCommands.length ? next : prev
        })
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((prev) => {
          // Find previous item (skip categories)
          let next = prev - 1
          while (next >= 0 && flatCommands[next].type !== "item") {
            next--
          }
          return next >= 0 ? next : prev
        })
      }

      // Enter - execute command
      if (e.key === "Enter") {
        e.preventDefault()
        const current = flatCommands[selectedIndex]
        if (current?.type === "item" && current.item) {
          handleExecuteCommand(current.item)
        }
      }

      // Number keys 1-9 - execute command by index
      if (e.key >= "1" && e.key <= "9") {
        e.preventDefault()
        const numberIndex = parseInt(e.key, 10)
        // Find the nth item (skip category headers)
        let itemCount = 0
        for (const item of flatCommands) {
          if (item.type === "item") {
            itemCount++
            if (itemCount === numberIndex && item.item) {
              handleExecuteCommand(item.item)
              return
            }
          }
        }
      }

      // Toggle multi-select mode
      if ((e.metaKey || e.ctrlKey) && e.key === "m") {
        e.preventDefault()
        setMultiSelectMode((prev) => !prev)
      }

      // Clear search
      if ((e.metaKey || e.ctrlKey) && e.key === "Backspace") {
        e.preventDefault()
        setSearchQuery("")
      }
    }

    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, flatCommands, selectedIndex, breadcrumbs, handleNavigateBack, handleExecuteCommand, setOpen, clearCommandSelection])

  // Global shortcut to open palette
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

  // Reset selection to first item when palette opens or filtered commands change
  useEffect(() => {
    if (!open) return

    // Find first item (skip categories)
    const firstItemIndex = flatCommands.findIndex(item => item.type === "item")
    if (firstItemIndex !== -1) {
      setSelectedIndex(firstItemIndex)
    }
  }, [open, flatCommands])

  const handleTeamSelection = useCallback((teamId: string) => {
    navigate(`/projects?teamId=${teamId}`)
  }, [navigate])

  if (!open) return null

  return (
    <>
      <TeamSelectorDialog
        open={showTeamSelector}
        onOpenChange={setShowTeamSelector}
        onSelectTeam={handleTeamSelection}
        title="Create Team Project"
        description="Select a team for the new project"
      />
      <div className="fixed inset-0 z-50">
        {/* Backdrop */}
      <div
        className="command-palette-backdrop fixed inset-0 bg-black/60"
        onClick={() => {
          setOpen(false)
          clearCommandSelection()
        }}
      />

      {/* Main palette */}
      <div className="command-palette-container fixed left-1/2 top-[15vh] w-full max-w-[680px] -translate-x-1/2 rounded-2xl overflow-hidden">
        <Command label="Command Palette" shouldFilter={false}>
          {/* Header */}
          <div className="command-palette-header flex items-center gap-3 px-5 py-4">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1">
              {breadcrumbs.length > 0 ? (
                <Breadcrumbs items={breadcrumbs} onNavigate={handleNavigateBack} />
              ) : (
                <Command.Input
                  autoFocus
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  placeholder="Type a command or search..."
                  className="command-palette-search-input w-full bg-transparent outline-none"
                />
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="shrink-0 p-1 rounded-md hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 pt-2">
              <div
                ref={listRef}
                className="h-[400px] overflow-auto"
                style={{ position: "relative" }}
              >
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
                <Command.List>
                  {flatCommands.length === 0 ? (
                    <div className="command-empty-state">
                      <Inbox className="command-empty-icon" />
                      <div className="command-empty-text">No results found</div>
                      <div className="command-empty-suggestions">Try a different search term</div>
                    </div>
                  ) : (
                    rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const item = flatCommands[virtualRow.index]

                      if (item.type === "category") {
                        return (
                          <div
                            key={virtualRow.index}
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              width: "100%",
                              height: `${virtualRow.size}px`,
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                            <CategorySection category={item.category!} count={item.count!}>
                              {null}
                            </CategorySection>
                          </div>
                        )
                      }

                      const cmd = item.item!
                      const isSelected = virtualRow.index === selectedIndex
                      const isMultiSelected = selectedCommands.includes(cmd.id)

                      // Calculate item number (1-9) for number shortcuts
                      let itemNumber: number | undefined
                      let itemCount = 0
                      for (let i = 0; i <= virtualRow.index; i++) {
                        if (flatCommands[i].type === "item") {
                          itemCount++
                        }
                      }
                      if (itemCount > 0 && itemCount <= 9) {
                        itemNumber = itemCount
                      }

                      return (
                        <div
                          key={virtualRow.index}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: `${virtualRow.size}px`,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <CommandItem
                            item={cmd}
                            isSelected={isSelected}
                            isMultiSelected={isMultiSelected}
                            matchScore={cmd.score}
                            searchQuery={searchQuery}
                            onSelect={() => handleExecuteCommand(cmd)}
                            onMultiSelect={() => toggleCommandSelection(cmd.id)}
                            multiSelectEnabled={multiSelectMode}
                            itemIndex={virtualRow.index}
                            numberShortcut={itemNumber}
                          />
                        </div>
                      )
                    })
                  )}
                </Command.List>
                </div>
              </div>
          </div>

          {/* Footer */}
          <div className="command-palette-footer px-5 py-3">
            <QuickActions
              selectedCount={selectedCommands.length}
              onClearSelection={selectedCommands.length > 0 ? clearCommandSelection : undefined}
            />
          </div>
        </Command>
      </div>
      </div>
    </>
  )
}

/**
 * Group commands by category
 */
function groupByCategory(
  commands: CommandItemType[]
): Record<string, CommandItemType[]> {
  return commands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) {
      acc[cmd.category] = []
    }
    acc[cmd.category].push(cmd)
    return acc
  }, {} as Record<string, CommandItemType[]>)
}

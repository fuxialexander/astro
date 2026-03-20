import type { CommandItem } from "@/types"
import {
  LayoutDashboard,
  Folder,
  CheckSquare,
  Server,
  Users,
  Target,
  Settings,
  Plus,
  Sun,
  Search,
  Sparkles,
  Zap,
  BookOpen,
  Terminal,
  type LucideIcon,
} from "lucide-react"

/**
 * Command registry for the command palette
 * Commands are organized by category and support nested navigation
 */

// Type helper to make icon typing easier
type IconType = LucideIcon

export interface CommandDefinition extends Omit<CommandItem, 'icon'> {
  icon?: IconType
}

/**
 * Navigation commands - main pages
 */
export const navigationCommands: CommandDefinition[] = [
  {
    id: "nav-dashboard",
    label: "Dashboard",
    description: "View overview and active projects",
    icon: LayoutDashboard,
    category: "navigation",
    keywords: ["home", "overview", "stats"],
    shortcut: "⌘⇧D",
  },
  {
    id: "nav-projects",
    label: "Projects",
    description: "View all projects",
    icon: Folder,
    category: "navigation",
    keywords: ["projects", "list"],
    shortcut: "⌘⇧P",
  },
  {
    id: "nav-tasks",
    label: "My Tasks",
    description: "View tasks across all projects",
    icon: CheckSquare,
    category: "navigation",
    keywords: ["tasks", "todo", "work"],
    shortcut: "⌘⇧T",
  },
  {
    id: "nav-environments",
    label: "Environments",
    description: "Manage machines and clusters",
    icon: Server,
    category: "navigation",
    keywords: ["machines", "clusters", "hpc", "environments"],
    shortcut: "⌘⇧E",
  },
  {
    id: "nav-initiatives",
    label: "Initiatives",
    description: "View initiatives",
    icon: Target,
    category: "navigation",
    keywords: ["initiatives", "goals", "strategy", "grand plans"],
  },
  {
    id: "nav-active",
    label: "Active Tasks",
    description: "View currently running tasks",
    icon: Zap,
    category: "navigation",
    keywords: ["active", "running", "live", "executing"],
  },
  {
    id: "nav-workflows",
    label: "Workflows",
    description: "Manage workflows",
    icon: BookOpen,
    category: "navigation",
    keywords: ["workflows", "automation", "pipelines"],
  },
  {
    id: "nav-settings",
    label: "Settings",
    description: "Configure application settings",
    icon: Settings,
    category: "navigation",
    keywords: ["settings", "preferences", "config"],
    shortcut: "⌘,",
  },
]

/**
 * Action commands - quick actions
 */
export const actionCommands: CommandDefinition[] = [
  {
    id: "action-new-project",
    label: "New Project",
    description: "Create a new project with AI planning",
    icon: Plus,
    category: "actions",
    keywords: ["create", "new", "project", "start"],
    shortcut: "⌘N",
  },
  {
    id: "action-plan-generation",
    label: "Interactive Plan Generation",
    description: "Start an AI-assisted plan generation session",
    icon: Sparkles,
    category: "actions",
    keywords: ["plan", "generate", "ai", "interactive", "brainstorm", "decompose"],
  },
  {
    id: "action-new-team-project",
    label: "Create Team Project",
    description: "Create a project for a team to collaborate on",
    icon: Users,
    category: "actions",
    keywords: ["create", "new", "team", "project", "collaborate", "share"],
  },
  {
    id: "action-new-task",
    label: "Add Task to Project...",
    description: "Select a project to add a task",
    icon: Plus,
    category: "actions",
    keywords: ["create", "task", "add"],
  },
  {
    id: "action-open-project-chat",
    label: "Open Project Chat...",
    description: "Select a project to open project chat",
    icon: Plus,
    category: "actions",
    keywords: ["chat", "plan", "ai", "assistant"],
  },
  {
    id: "action-new-initiative",
    label: "New Initiative",
    description: "Create an initiative",
    icon: Plus,
    category: "actions",
    keywords: ["create", "initiative", "goal", "grand plan"],
  },
  {
    id: "action-playground-in",
    label: "Start Playground In...",
    description: "Start a playground session in a recent machine:workdir",
    icon: Terminal,
    category: "actions",
    keywords: ["playground", "start", "session", "workdir", "machine", "ssh", "recent"],
  },
  {
    id: "action-toggle-theme",
    label: "Toggle Theme",
    description: "Switch between light and dark mode",
    icon: Sun,
    category: "actions",
    keywords: ["theme", "dark", "light", "appearance"],
    shortcut: "⌘⇧L",
  },
  {
    id: "action-search",
    label: "Global Search",
    description: "Search across all projects and tasks",
    icon: Search,
    category: "actions",
    keywords: ["search", "find", "query"],
    shortcut: "⌘⇧F",
  },
]

/**
 * External commands registered by plugins
 */
const externalCommands: CommandDefinition[] = []

/**
 * Register a command from a plugin
 */
export function registerCommand(command: CommandDefinition): void {
  externalCommands.push(command)
}

/**
 * Unregister a plugin command
 */
export function unregisterCommand(commandId: string): void {
  const index = externalCommands.findIndex((c) => c.id === commandId)
  if (index !== -1) {
    externalCommands.splice(index, 1)
  }
}

/**
 * Get all static commands (navigation + actions + plugin commands)
 */
export function getStaticCommands(): CommandDefinition[] {
  return [...navigationCommands, ...actionCommands, ...externalCommands]
}

/**
 * Get recent commands based on history
 */
export function getRecentCommands<T extends { id: string }>(
  allCommands: T[],
  history: Array<{ commandId: string; executedAt: Date; frequency: number }>
): T[] {
  // Sort by recency (executedAt) first, then frequency
  const sortedHistory = [...history].sort((a, b) => {
    const timeDiff = b.executedAt.getTime() - a.executedAt.getTime()
    if (timeDiff !== 0) return timeDiff
    return b.frequency - a.frequency
  })

  // Map history to commands
  return sortedHistory
    .map((h) => allCommands.find((c) => c.id === h.commandId))
    .filter(Boolean)
    .slice(0, 5) as T[]
}

/**
 * Format keyboard shortcut for display
 */
export function formatShortcut(shortcut: string): string {
  return shortcut
    .replace("⌘", "Cmd")
    .replace("⇧", "Shift")
    .replace("⌥", "Opt")
    .replace("⌃", "Ctrl")
}

/**
 * Parse shortcut string to platform-specific display
 */
export function getPlatformShortcut(shortcut: string): string {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0

  if (!isMac) {
    return shortcut.replace("⌘", "Ctrl+").replace("⇧", "Shift+")
  }

  return shortcut
}

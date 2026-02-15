import type { CommandCategory as CommandCategoryType } from "@/types"
import {
  Clock,
  Compass,
  Zap,
  Folder,
  CheckSquare,
  Settings,
  Search,
  type LucideIcon,
} from "lucide-react"

interface CommandCategoryProps {
  category: CommandCategoryType
  count: number
  children: React.ReactNode
}

const categoryIcons: Record<CommandCategoryType, LucideIcon> = {
  recent: Clock,
  navigation: Compass,
  actions: Zap,
  projects: Folder,
  tasks: CheckSquare,
  settings: Settings,
  search: Search,
}

const categoryLabels: Record<CommandCategoryType, string> = {
  recent: "Recent",
  navigation: "Navigation",
  actions: "Actions",
  projects: "Projects",
  tasks: "Tasks",
  settings: "Settings",
  search: "Search Results",
}

export function CommandCategory({ category, count, children }: CommandCategoryProps) {
  const Icon = categoryIcons[category]
  const label = categoryLabels[category]

  return (
    <div className="command-category">
      <div className="command-category-header">
        {Icon && <Icon className="command-category-icon" />}
        <span>{label}</span>
        <span className="command-category-count">{count}</span>
      </div>
      <div className="command-category-items">{children}</div>
    </div>
  )
}

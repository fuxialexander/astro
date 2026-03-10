import { useTranslation } from "react-i18next"
import type { CommandCategory as CommandCategoryType } from "@/types"
import {
  Clock,
  Compass,
  Zap,
  Folder,
  CheckSquare,
  Settings,
  Search,
  Puzzle,
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
  plugins: Puzzle,
}

export function CommandCategory({ category, count, children }: CommandCategoryProps) {
  const { t } = useTranslation("nav")
  const Icon = categoryIcons[category]

  // Map category id to translation key
  const getCategoryLabel = (cat: CommandCategoryType): string => {
    switch (cat) {
      case "recent": return t("category.recent")
      case "navigation": return t("category.navigation")
      case "actions": return t("category.actions")
      case "projects": return t("projects")
      case "tasks": return t("tasks")
      case "settings": return t("settings")
      case "search": return t("category.searchResults")
      case "plugins": return t("category.plugins")
      default: return cat
    }
  }

  return (
    <div className="command-category">
      <div className="command-category-header">
        {Icon && <Icon className="command-category-icon" />}
        <span>{getCategoryLabel(category)}</span>
        <span className="command-category-count">{count}</span>
      </div>
      <div className="command-category-items">{children}</div>
    </div>
  )
}

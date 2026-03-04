/**
 * Achievements Panel — collapsible badge display with category filters
 */
import { useState } from "react"
import { ChevronDown, ChevronUp, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_CATEGORIES,
  type AchievementCategory,
  type AchievementDef,
} from "@astro/core/achievements"
import type { EarnedAchievement } from "@/stores/stats-store"

interface AchievementsPanelProps {
  achievements: EarnedAchievement[]
  className?: string
}

function AchievementBadge({
  def,
  earned,
}: {
  def: AchievementDef
  earned: EarnedAchievement | undefined
}) {
  const isEarned = !!earned

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all w-[90px]",
            isEarned
              ? "bg-background border-border hover:border-primary/40"
              : "bg-muted/30 border-transparent opacity-50 grayscale"
          )}
        >
          <span className="text-2xl" role="img" aria-label={def.title}>
            {isEarned ? def.icon : ""}
          </span>
          {!isEarned && <Lock className="h-5 w-5 text-muted-foreground" />}
          <span className={cn(
            "text-[10px] font-medium text-center leading-tight",
            isEarned ? "text-foreground" : "text-muted-foreground"
          )}>
            {def.title}
          </span>
          <span className="text-[9px] text-muted-foreground">
            {def.xp} XP
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[200px]">
        <p className="font-semibold text-sm">{def.title}</p>
        <p className="text-xs text-muted-foreground">{def.description}</p>
        {isEarned && earned && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Earned {new Date(earned.earnedAt).toLocaleDateString()}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export function AchievementsPanel({ achievements, className }: AchievementsPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [activeCategory, setActiveCategory] = useState<AchievementCategory | "all">("all")

  const earnedMap = new Map(achievements.map((a) => [a.slug, a]))
  const earnedCount = achievements.length
  const totalCount = ACHIEVEMENTS.length

  const filtered = activeCategory === "all"
    ? ACHIEVEMENTS
    : ACHIEVEMENTS.filter((a) => a.category === activeCategory)

  // Sort: earned first, then locked
  const sorted = [...filtered].sort((a, b) => {
    const aEarned = earnedMap.has(a.slug) ? 0 : 1
    const bEarned = earnedMap.has(b.slug) ? 0 : 1
    return aEarned - bEarned
  })

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between py-3 px-1 cursor-pointer hover:bg-muted/30 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">🏆</span>
          <h3 className="text-sm font-semibold">Achievements</h3>
          <Badge variant="secondary" className="text-[10px]">
            {earnedCount}/{totalCount}
          </Badge>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Collapsible content */}
      {expanded && (
        <div className="flex flex-col gap-3 pb-2">
          {/* Category filters */}
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant={activeCategory === "all" ? "default" : "outline"}
              size="sm"
              className="h-7 text-[11px] px-2.5"
              onClick={() => setActiveCategory("all")}
            >
              All
            </Button>
            {ACHIEVEMENT_CATEGORIES.map((cat) => {
              const catCount = ACHIEVEMENTS.filter(
                (a) => a.category === cat.key && earnedMap.has(a.slug)
              ).length
              const catTotal = ACHIEVEMENTS.filter((a) => a.category === cat.key).length
              return (
                <Button
                  key={cat.key}
                  variant={activeCategory === cat.key ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-[11px] px-2.5"
                  onClick={() => setActiveCategory(cat.key)}
                >
                  {cat.label}
                  <span className="ml-1 text-[9px] opacity-70">
                    {catCount}/{catTotal}
                  </span>
                </Button>
              )
            })}
          </div>

          {/* Achievement badges grid */}
          <TooltipProvider delayDuration={200}>
            <div className="flex flex-wrap gap-2">
              {sorted.map((def) => (
                <AchievementBadge
                  key={def.slug}
                  def={def}
                  earned={earnedMap.get(def.slug)}
                />
              ))}
            </div>
          </TooltipProvider>
        </div>
      )}
    </div>
  )
}

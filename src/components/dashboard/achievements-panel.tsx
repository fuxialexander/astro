/**
 * Achievements Panel — showcase with progress rings, category bars, and earned highlights
 */
import { useMemo, useState } from "react"
import { ChevronRight, Lock, Trophy } from "lucide-react"
import { Button } from "@/components/ui/button"
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

/** SVG ring progress indicator */
function ProgressRing({ progress, size = 56, strokeWidth = 3, children, className }: {
  progress: number
  size?: number
  strokeWidth?: number
  children?: React.ReactNode
  className?: string
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.min(progress, 1))

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/60"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#ring-gradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
        <defs>
          <linearGradient id="ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>
        </defs>
      </svg>
      <div className="relative z-10">{children}</div>
    </div>
  )
}

function AchievementBadge({
  def,
  earned,
  size = "default",
}: {
  def: AchievementDef
  earned: EarnedAchievement | undefined
  size?: "default" | "featured"
}) {
  const isEarned = !!earned
  const isFeatured = size === "featured"

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex flex-col items-center gap-1 rounded-xl border transition-all cursor-default",
            isFeatured ? "p-3 w-[80px]" : "p-2 w-[68px]",
            isEarned
              ? "bg-background border-border hover:border-amber-400/40 hover:shadow-[0_0_12px_rgba(245,158,11,0.08)]"
              : "bg-muted/20 border-transparent opacity-40 grayscale"
          )}
        >
          <span className={cn("leading-none", isFeatured ? "text-2xl" : "text-lg")} role="img" aria-label={def.title}>
            {isEarned ? def.icon : ""}
          </span>
          {!isEarned && <Lock className={cn(isFeatured ? "h-5 w-5" : "h-3.5 w-3.5", "text-muted-foreground")} />}
          <span className={cn(
            "font-medium text-center leading-tight",
            isFeatured ? "text-[10px]" : "text-[9px]",
            isEarned ? "text-foreground" : "text-muted-foreground"
          )}>
            {def.title}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[200px]">
        <p className="font-semibold text-sm">{def.title}</p>
        <p className="text-xs text-muted-foreground">{def.description}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{def.xp} XP</p>
        {isEarned && earned && (
          <p className="text-[10px] text-amber-500 mt-0.5">
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

  const earnedMap = useMemo(() => new Map(achievements.map((a) => [a.slug, a])), [achievements])
  const earnedCount = achievements.length
  const totalCount = ACHIEVEMENTS.length
  const overallProgress = totalCount > 0 ? earnedCount / totalCount : 0

  // Recently earned (sorted by date, most recent first)
  const recentlyEarned = useMemo(() => {
    return [...achievements]
      .sort((a, b) => new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime())
      .slice(0, 5)
      .map((e) => ({ earned: e, def: ACHIEVEMENTS.find((a) => a.slug === e.slug)! }))
      .filter((e) => e.def)
  }, [achievements])

  // Category progress
  const categoryProgress = useMemo(() => {
    return ACHIEVEMENT_CATEGORIES.map((cat) => {
      const catAchievements = ACHIEVEMENTS.filter((a) => a.category === cat.key)
      const catEarned = catAchievements.filter((a) => earnedMap.has(a.slug)).length
      return { ...cat, earned: catEarned, total: catAchievements.length, progress: catAchievements.length > 0 ? catEarned / catAchievements.length : 0 }
    })
  }, [earnedMap])

  const filtered = activeCategory === "all"
    ? ACHIEVEMENTS
    : ACHIEVEMENTS.filter((a) => a.category === activeCategory)

  const sorted = [...filtered].sort((a, b) => {
    const aEarned = earnedMap.has(a.slug) ? 0 : 1
    const bEarned = earnedMap.has(b.slug) ? 0 : 1
    return aEarned - bEarned
  })

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Summary row — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-4 py-3 px-1 cursor-pointer hover:bg-muted/20 rounded-lg transition-colors group"
      >
        {/* Progress ring */}
        <ProgressRing progress={overallProgress} size={48} strokeWidth={3}>
          <Trophy className="h-4.5 w-4.5 text-amber-500" />
        </ProgressRing>

        {/* Text */}
        <div className="flex flex-col items-start gap-0.5 min-w-0">
          <span className="text-sm font-semibold">Achievements</span>
          <span className="text-[11px] text-muted-foreground">
            {earnedCount} of {totalCount} unlocked
          </span>
        </div>

        {/* Recent earned preview (collapsed) */}
        {!expanded && recentlyEarned.length > 0 && (
          <div className="flex items-center gap-0.5 ml-auto mr-2">
            {recentlyEarned.slice(0, 4).map((r) => (
              <span key={r.earned.slug} className="text-base leading-none" title={r.def.title}>
                {r.def.icon}
              </span>
            ))}
            {recentlyEarned.length > 4 && (
              <span className="text-[10px] text-muted-foreground ml-0.5">+{recentlyEarned.length - 4}</span>
            )}
          </div>
        )}

        <ChevronRight className={cn(
          "h-4 w-4 text-muted-foreground transition-transform shrink-0",
          expanded && "rotate-90"
        )} />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="flex flex-col gap-4 pb-3 pt-1">
          {/* Category progress bars */}
          <div className="grid grid-cols-3 gap-x-4 gap-y-2 px-1">
            {categoryProgress.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(activeCategory === cat.key ? "all" : cat.key)}
                className={cn(
                  "flex flex-col gap-1 text-left transition-opacity cursor-pointer",
                  activeCategory !== "all" && activeCategory !== cat.key && "opacity-40"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-muted-foreground">{cat.label}</span>
                  <span className="text-[9px] text-muted-foreground">{cat.earned}/{cat.total}</span>
                </div>
                <div className="h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      cat.progress === 1
                        ? "bg-gradient-to-r from-amber-400 to-amber-500"
                        : cat.progress > 0
                          ? "bg-gradient-to-r from-primary/70 to-primary"
                          : "bg-transparent"
                    )}
                    style={{ width: `${Math.round(cat.progress * 100)}%` }}
                  />
                </div>
              </button>
            ))}
          </div>

          {/* Recently earned showcase */}
          {recentlyEarned.length > 0 && activeCategory === "all" && (
            <div className="flex flex-col gap-2 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recently Earned</span>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {recentlyEarned.map((r) => (
                  <TooltipProvider key={r.earned.slug} delayDuration={200}>
                    <AchievementBadge def={r.def} earned={r.earned} size="featured" />
                  </TooltipProvider>
                ))}
              </div>
            </div>
          )}

          {/* All achievements grid */}
          <div className="flex flex-col gap-2 px-1">
            {activeCategory !== "all" && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {ACHIEVEMENT_CATEGORIES.find((c) => c.key === activeCategory)?.label}
                </span>
                <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 text-muted-foreground" onClick={() => setActiveCategory("all")}>
                  Show All
                </Button>
              </div>
            )}
            {activeCategory === "all" && (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">All Achievements</span>
            )}
            <TooltipProvider delayDuration={200}>
              <div className="flex flex-wrap gap-1.5">
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
        </div>
      )}
    </div>
  )
}

/**
 * Brag Stats Row — 6 compact stat cards + level/XP progress bar
 */
import {
  Flame,
  CheckCircle2,
  Code2,
  GitPullRequest,
  Star,
  Trophy,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { formatCompactNumber } from "@astro/core/achievements"
import type { LifetimeStats, LevelInfo } from "@astro/core/achievements"

interface BragStatsProps {
  stats: LifetimeStats
  levelInfo: LevelInfo
  className?: string
}

interface StatCardProps {
  label: string
  value: string
  icon: React.ReactNode
  color: string
}

function StatCard({ label, value, icon, color }: StatCardProps) {
  return (
    <Card className="rounded-xl">
      <CardContent className="flex items-center gap-2.5 p-3">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", color)}>
          {icon}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[11px] text-muted-foreground truncate">{label}</span>
          <span className="text-base font-bold leading-tight">{value}</span>
        </div>
      </CardContent>
    </Card>
  )
}

export function BragStats({ stats, levelInfo, className }: BragStatsProps) {
  const cards: StatCardProps[] = [
    {
      label: "Streak",
      value: `${stats.currentStreak}d`,
      icon: <Flame className="h-4 w-4 text-orange-600 dark:text-orange-400" />,
      color: "bg-orange-100 dark:bg-orange-900/40",
    },
    {
      label: "Tasks Done",
      value: formatCompactNumber(stats.totalTasksCompleted),
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
      color: "bg-emerald-100 dark:bg-emerald-900/40",
    },
    {
      label: "Lines Added",
      value: formatCompactNumber(stats.totalLinesAdded),
      icon: <Code2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />,
      color: "bg-blue-100 dark:bg-blue-900/40",
    },
    {
      label: "PRs Merged",
      value: formatCompactNumber(stats.totalPrsMerged),
      icon: <GitPullRequest className="h-4 w-4 text-purple-600 dark:text-purple-400" />,
      color: "bg-purple-100 dark:bg-purple-900/40",
    },
    {
      label: "Stars Earned",
      value: formatCompactNumber(stats.totalStarsReceived),
      icon: <Star className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />,
      color: "bg-yellow-100 dark:bg-yellow-900/40",
    },
    {
      label: "Level",
      value: String(levelInfo.level),
      icon: <Trophy className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
      color: "bg-amber-100 dark:bg-amber-900/40",
    },
  ]

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>

      {/* Level / XP Progress Bar */}
      <div className="flex items-center gap-3 px-1">
        <span className="text-xs font-semibold text-muted-foreground shrink-0">
          {levelInfo.title}
        </span>
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all duration-500"
            style={{ width: `${Math.round(levelInfo.progress * 100)}%` }}
          />
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">
          {formatCompactNumber(levelInfo.xp)} / {formatCompactNumber(levelInfo.nextLevelXp)} XP
        </span>
      </div>
    </div>
  )
}

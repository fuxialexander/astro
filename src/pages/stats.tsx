/**
 * Stats & Achievements page — full statistics view for the current user.
 * Accessible by clicking the user avatar in the sidebar.
 */
import { useEffect } from "react"
import { useNavigate } from "react-router"
import { Flame, ChevronLeft } from "lucide-react"
import { useStatsStore } from "@/stores/stats-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useAuthStore } from "@/stores/auth-store"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { BragStats } from "@/components/dashboard/brag-stats"
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap"
import { AchievementsPanel } from "@/components/dashboard/achievements-panel"
import { cn } from "@/lib/utils"

function getInitials(s: string) {
  if (!s) return "U"
  if (s.includes("@")) {
    const u = s.split("@")[0]
    const p = u.split(/[._-]/)
    return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : u.slice(0, 2).toUpperCase()
  }
  const p = s.trim().split(/\s+/)
  return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : s.slice(0, 2).toUpperCase()
}

function getDisplayName(s: string) {
  if (!s) return "User"
  if (s.includes("@")) {
    return s.split("@")[0].split(/[._-]/)
      .map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ")
  }
  return s
}

export function StatsPage() {
  const navigate = useNavigate()
  const profile = useUserProfileStore((s) => s.profile)
  const authUser = useAuthStore((s) => s.user)
  const { heatmapData, stats, achievements, levelInfo, loading, statsLoaded, loadAll } = useStatsStore()

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const displayName = getDisplayName(profile.name || authUser?.email || "")
  const email = profile.email || authUser?.email

  return (
    <div className="min-h-full bg-background">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-border bg-background/95 backdrop-blur-sm">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium text-foreground">Statistics &amp; Achievements</span>
      </div>

      <div className="px-6 py-8 max-w-4xl mx-auto flex flex-col gap-10">
        {/* Profile header */}
        <div className="flex items-center gap-5">
          <Avatar className="h-16 w-16 shrink-0">
            <AvatarImage src={profile.avatarUrl ?? undefined} />
            <AvatarFallback className="text-xl font-bold">
              {getInitials(profile.name || authUser?.email || "")}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-1.5 min-w-0">
            <h1 className="text-2xl font-bold text-foreground truncate">{displayName}</h1>
            {email && <p className="text-sm text-muted-foreground truncate">{email}</p>}
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold",
                "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
              )}>
                Lv {levelInfo.level} · {levelInfo.title}
              </span>
              {stats && stats.currentStreak > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400">
                  <Flame className="h-3 w-3" />
                  {stats.currentStreak}d streak
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stats overview */}
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Overview</h2>
          {loading && !statsLoaded ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : stats ? (
            <BragStats stats={stats} levelInfo={levelInfo} />
          ) : (
            <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
          )}
        </section>

        {/* Activity heatmap */}
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Activity</h2>
          <ActivityHeatmap data={heatmapData} />
        </section>

        {/* Achievements */}
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Achievements</h2>
          <AchievementsPanel achievements={achievements} />
        </section>
      </div>
    </div>
  )
}

/**
 * Stats Store — heatmap data, lifetime stats, achievements
 */
import { create } from "zustand"
import { dataClient } from "@/lib/data-client"
import type { LifetimeStats, LevelInfo } from "@astro/core/achievements"
import { computeLevel, computeTotalXp } from "@astro/core/achievements"

export interface DailyActivity {
  date: string
  tasksCompleted: number
  totalCostUsd: number
}

export interface HourlyActivity {
  date: string
  hour: number
  tasksCompleted: number
}

export interface EarnedAchievement {
  slug: string
  earnedAt: string
  metadata: Record<string, unknown>
}

interface StatsState {
  // Heatmap
  heatmapData: DailyActivity[]
  heatmapLoaded: boolean

  // Hourly heatmap
  hourlyData: HourlyActivity[]
  hourlyLoaded: boolean

  // Lifetime stats
  stats: LifetimeStats | null
  achievements: EarnedAchievement[]
  levelInfo: LevelInfo
  statsLoaded: boolean

  // Loading state
  loading: boolean

  // Actions
  loadHeatmap: (weeks?: number) => Promise<void>
  loadHourly: (days?: number) => Promise<void>
  loadStats: () => Promise<void>
  loadAll: () => Promise<void>
}

const DEFAULT_LEVEL: LevelInfo = {
  level: 0,
  title: "Apprentice",
  xp: 0,
  currentLevelXp: 0,
  nextLevelXp: 100,
  progress: 0,
}

export const useStatsStore = create<StatsState>((set, get) => ({
  heatmapData: [],
  heatmapLoaded: false,
  hourlyData: [],
  hourlyLoaded: false,
  stats: null,
  achievements: [],
  levelInfo: DEFAULT_LEVEL,
  statsLoaded: false,
  loading: false,

  loadHeatmap: async (weeks = 52) => {
    try {
      const data = await dataClient.getUsageHistory(weeks)
      set({ heatmapData: data, heatmapLoaded: true })
    } catch (err) {
      console.error("[stats-store] Failed to load heatmap:", err)
      set({ heatmapLoaded: true })
    }
  },

  loadHourly: async (days = 14) => {
    try {
      const data = await dataClient.getHourlyActivity(days)
      set({ hourlyData: data, hourlyLoaded: true })
    } catch (err) {
      console.error("[stats-store] Failed to load hourly data:", err)
      set({ hourlyLoaded: true })
    }
  },

  loadStats: async () => {
    try {
      const data = await dataClient.getLifetimeStats()
      const earnedSlugs = data.achievements.map((a) => a.slug)
      const xp = computeTotalXp(earnedSlugs)
      const levelInfo = computeLevel(xp)
      set({
        stats: data.stats as unknown as LifetimeStats,
        achievements: data.achievements,
        levelInfo,
        statsLoaded: true,
      })
    } catch (err) {
      console.error("[stats-store] Failed to load stats:", err)
      set({ statsLoaded: true })
    }
  },

  loadAll: async () => {
    if (get().loading) return
    set({ loading: true })
    await Promise.all([get().loadHeatmap(), get().loadHourly(), get().loadStats()])
    set({ loading: false })
  },
}))

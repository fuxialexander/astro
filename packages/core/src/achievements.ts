/**
 * Achievement Definitions & Level System
 *
 * Pure data module — no database or runtime dependencies.
 * Used by both server (to check/award) and client (to display).
 */

// ── Achievement Categories ───────────────────────────────────────────

export type AchievementCategory =
  | 'onboarding'
  | 'consistency'
  | 'volume'
  | 'code'
  | 'community'
  | 'efficiency'
  | 'power_user'
  | 'easter_eggs'
  | 'competitive'

export interface AchievementDef {
  slug: string
  title: string
  description: string
  category: AchievementCategory
  xp: number
  icon: string // emoji
  /** Field on LifetimeStats used for threshold check (or null for custom logic) */
  statKey: string | null
  threshold: number | null
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // ── Onboarding ──
  { slug: 'first_task', title: 'First Steps', description: 'Complete your first task', category: 'onboarding', xp: 10, icon: '👣', statKey: 'totalTasksCompleted', threshold: 1 },
  { slug: 'first_plan', title: 'Planner', description: 'Create your first project', category: 'onboarding', xp: 10, icon: '📋', statKey: 'totalProjectsCreated', threshold: 1 },
  { slug: 'first_pr', title: 'Ship It', description: 'Merge your first PR', category: 'onboarding', xp: 20, icon: '🚀', statKey: 'totalPrsMerged', threshold: 1 },

  // ── Consistency ──
  { slug: 'streak_7', title: 'Week Warrior', description: '7-day activity streak', category: 'consistency', xp: 50, icon: '🔥', statKey: 'longestStreak', threshold: 7 },
  { slug: 'streak_30', title: 'Month Machine', description: '30-day activity streak', category: 'consistency', xp: 200, icon: '⚡', statKey: 'longestStreak', threshold: 30 },
  { slug: 'streak_100', title: 'Centurion', description: '100-day activity streak', category: 'consistency', xp: 1000, icon: '🏛️', statKey: 'longestStreak', threshold: 100 },

  // ── Volume ──
  { slug: 'tasks_10', title: 'Getting Started', description: 'Complete 10 tasks', category: 'volume', xp: 25, icon: '✅', statKey: 'totalTasksCompleted', threshold: 10 },
  { slug: 'tasks_100', title: 'Century Club', description: 'Complete 100 tasks', category: 'volume', xp: 100, icon: '💯', statKey: 'totalTasksCompleted', threshold: 100 },
  { slug: 'tasks_1000', title: 'Automation Master', description: 'Complete 1,000 tasks', category: 'volume', xp: 500, icon: '🤖', statKey: 'totalTasksCompleted', threshold: 1000 },

  // ── Code ──
  { slug: 'lines_1k', title: 'Code Craftsman', description: 'Write 1,000 lines of code', category: 'code', xp: 30, icon: '🔨', statKey: 'totalLinesAdded', threshold: 1000 },
  { slug: 'lines_10k', title: 'Code Wizard', description: 'Write 10,000 lines of code', category: 'code', xp: 150, icon: '🧙', statKey: 'totalLinesAdded', threshold: 10000 },
  { slug: 'lines_100k', title: 'Code Legend', description: 'Write 100,000 lines of code', category: 'code', xp: 750, icon: '🏆', statKey: 'totalLinesAdded', threshold: 100000 },

  // ── Community ──
  { slug: 'share_first', title: 'Open Source', description: 'Share your first plan', category: 'community', xp: 40, icon: '🌍', statKey: 'totalPlansShared', threshold: 1 },
  { slug: 'star_first', title: 'Fan Favorite', description: 'Receive your first star', category: 'community', xp: 50, icon: '⭐', statKey: 'totalStarsReceived', threshold: 1 },
  { slug: 'stars_10', title: 'Rising Star', description: 'Receive 10 stars', category: 'community', xp: 200, icon: '🌟', statKey: 'totalStarsReceived', threshold: 10 },

  // ── Efficiency ──
  { slug: 'perfect_day', title: 'Flawless', description: '100% success rate in a day', category: 'efficiency', xp: 75, icon: '💎', statKey: null, threshold: null },
  { slug: 'five_in_a_day', title: 'Power Sprint', description: 'Complete 5 tasks in one day', category: 'efficiency', xp: 60, icon: '🏃', statKey: 'bestDayTasks', threshold: 5 },

  // ── Power User ──
  { slug: 'three_projects', title: 'Portfolio Builder', description: 'Create 3 projects', category: 'power_user', xp: 80, icon: '📁', statKey: 'totalProjectsCreated', threshold: 3 },
  { slug: 'active_30days', title: 'Dedicated', description: 'Be active for 30 days', category: 'power_user', xp: 100, icon: '📅', statKey: 'totalActiveDays', threshold: 30 },

  // ── Easter Eggs ──
  { slug: 'night_owl', title: 'Night Owl', description: 'Complete a task between 2-5am', category: 'easter_eggs', xp: 30, icon: '🦉', statKey: 'hasNightOwlTask', threshold: 1 },
  { slug: 'speed_demon', title: 'Speed Demon', description: 'Complete a task in under 30 seconds', category: 'easter_eggs', xp: 40, icon: '💨', statKey: 'hasSpeedDemonTask', threshold: 1 },
  { slug: 'weekend_warrior', title: 'Weekend Warrior', description: 'Be active on 10 weekends', category: 'easter_eggs', xp: 60, icon: '🎮', statKey: 'weekendsActive', threshold: 10 },
  { slug: 'marathon', title: 'Marathon Runner', description: 'Single execution over 1 hour', category: 'easter_eggs', xp: 35, icon: '🏅', statKey: 'longestExecutionMinutes', threshold: 60 },
  { slug: 'oops', title: 'Oops', description: '5 failed tasks in one day', category: 'easter_eggs', xp: 15, icon: '😅', statKey: 'maxFailedInDay', threshold: 5 },

  // ── Competitive ──
  { slug: 'top_week', title: 'Weekly Champion', description: 'Complete 20+ tasks in a week', category: 'competitive', xp: 150, icon: '👑', statKey: 'bestWeekTasks', threshold: 20 },
  { slug: 'streak_longest', title: 'Streak Breaker', description: 'Beat your own longest streak record', category: 'competitive', xp: 100, icon: '📈', statKey: null, threshold: null },
  { slug: 'cost_efficient', title: 'Penny Pincher', description: 'Complete 10 tasks for under $0.50', category: 'competitive', xp: 120, icon: '💰', statKey: null, threshold: null },
  { slug: 'ten_in_a_day', title: 'Speedrunner', description: 'Complete 10 tasks in one day', category: 'competitive', xp: 200, icon: '⚡', statKey: 'bestDayTasks', threshold: 10 },
]

export const ACHIEVEMENT_MAP = new Map(ACHIEVEMENTS.map(a => [a.slug, a]))

export const ACHIEVEMENT_CATEGORIES: { key: AchievementCategory; label: string }[] = [
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'consistency', label: 'Consistency' },
  { key: 'volume', label: 'Volume' },
  { key: 'code', label: 'Code' },
  { key: 'community', label: 'Community' },
  { key: 'efficiency', label: 'Efficiency' },
  { key: 'power_user', label: 'Power User' },
  { key: 'easter_eggs', label: 'Easter Eggs' },
  { key: 'competitive', label: 'Competitive' },
]

// ── Level System ─────────────────────────────────────────────────────

const XP_THRESHOLDS = [0, 100, 300, 700, 1500, 3000, 6000, 12000, 25000]
const LEVEL_TITLES = [
  'Apprentice',
  'Journeyman',
  'Craftsman',
  'Expert',
  'Master',
  'Grandmaster',
  'Legend',
  'Mythic',
  'Transcendent',
]

export interface LevelInfo {
  level: number
  title: string
  xp: number
  currentLevelXp: number
  nextLevelXp: number
  progress: number // 0-1
}

export function computeLevel(totalXp: number): LevelInfo {
  let level = 0
  for (let i = XP_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalXp >= XP_THRESHOLDS[i]) {
      level = i
      break
    }
  }

  const currentLevelXp = XP_THRESHOLDS[level]
  const nextLevelXp = level < XP_THRESHOLDS.length - 1
    ? XP_THRESHOLDS[level + 1]
    : XP_THRESHOLDS[level] + 25000 // beyond max

  const progress = nextLevelXp > currentLevelXp
    ? (totalXp - currentLevelXp) / (nextLevelXp - currentLevelXp)
    : 1

  return {
    level,
    title: LEVEL_TITLES[level] || 'Transcendent',
    xp: totalXp,
    currentLevelXp,
    nextLevelXp,
    progress: Math.min(progress, 1),
  }
}

export function computeTotalXp(earnedSlugs: string[]): number {
  return earnedSlugs.reduce((sum, slug) => {
    const def = ACHIEVEMENT_MAP.get(slug)
    return sum + (def?.xp ?? 0)
  }, 0)
}

// ── Lifetime Stats Interface ─────────────────────────────────────────

export interface LifetimeStats {
  currentStreak: number
  longestStreak: number
  totalTasksCompleted: number
  totalLinesAdded: number
  totalPrsMerged: number
  totalStarsReceived: number
  totalProjectsCreated: number
  totalPlansShared: number
  totalCostUsd: number
  totalActiveDays: number
  bestWeekTasks: number
  cheapestTenTasksCost: number | null
  hasNightOwlTask: boolean
  hasSpeedDemonTask: boolean
  weekendsActive: number
  longestExecutionMinutes: number
  maxFailedInDay: number
  bestDayTasks: number
}

/**
 * Check which achievements are earned based on stats.
 * Returns slugs of newly earned achievements (not in `alreadyEarned`).
 */
export function checkAchievements(
  stats: LifetimeStats,
  alreadyEarned: Set<string>
): string[] {
  const newlyEarned: string[] = []

  for (const def of ACHIEVEMENTS) {
    if (alreadyEarned.has(def.slug)) continue

    // Custom logic achievements
    if (def.statKey === null) {
      switch (def.slug) {
        case 'perfect_day':
          // Handled server-side via usage_metrics query
          if (stats.bestDayTasks > 0 && stats.maxFailedInDay === 0) {
            // Approximation: if they've completed tasks and never had failures in a day
            // The actual check is more nuanced (per-day), handled in server
          }
          break
        case 'streak_longest':
          // Awarded when currentStreak > previous longestStreak
          // This is tracked server-side by comparing before/after
          break
        case 'cost_efficient':
          if (stats.cheapestTenTasksCost !== null && stats.cheapestTenTasksCost < 0.5) {
            newlyEarned.push(def.slug)
          }
          break
        default:
          break
      }
      continue
    }

    // Standard threshold-based achievements
    const value = stats[def.statKey as keyof LifetimeStats]
    if (typeof value === 'boolean') {
      if (value && def.threshold === 1) {
        newlyEarned.push(def.slug)
      }
    } else if (typeof value === 'number' && def.threshold !== null) {
      if (value >= def.threshold) {
        newlyEarned.push(def.slug)
      }
    }
  }

  return newlyEarned
}

// ── Display Helpers ──────────────────────────────────────────────────

export function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

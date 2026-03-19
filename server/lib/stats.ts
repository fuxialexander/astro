/**
 * Stats computation & achievement checking
 *
 * Aggregates data from usage_metrics, task_executions, file_changes,
 * plan_nodes, shared_plans, projects, and user_achievements.
 */
import { db } from './db/index.js'
import {
  usageMetrics,
  taskExecutions,
  streamingEvents,
  planNodes,
  sharedPlans,
  sharedPlanStars,
  projects,
  userAchievements,
} from './db/schema.js'
import { eq, and, sql, desc, gte, count, isNull } from 'drizzle-orm'
import {
  type LifetimeStats,
  checkAchievements,
  computeTotalXp,
  computeLevel,
} from '../../packages/core/src/achievements.js'

// ── In-process cache (5-minute TTL) ─────────────────────────────────

interface CacheEntry {
  data: unknown
  expiresAt: number
}

const statsCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000

function getCached<T>(key: string): T | null {
  const entry = statsCache.get(key)
  if (!entry || Date.now() > entry.expiresAt) {
    statsCache.delete(key)
    return null
  }
  return entry.data as T
}

function setCache(key: string, data: unknown): void {
  statsCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

// ── Usage History (for heatmap) ─────────────────────────────────────

export interface DailyActivity {
  date: string
  tasksCompleted: number
  totalCostUsd: number
}

export async function getUsageHistory(userId: string, weeks: number = 52): Promise<DailyActivity[]> {
  const cacheKey = `usage_history:${userId}:${weeks}`
  const cached = getCached<DailyActivity[]>(cacheKey)
  if (cached) return cached

  const daysBack = weeks * 7
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - daysBack)
  const startStr = startDate.toISOString().slice(0, 10)

  const rows = await db.select({
    date: usageMetrics.sessionDate,
    tasksCompleted: usageMetrics.tasksCompleted,
    totalCostUsd: usageMetrics.totalCostUsd,
  })
    .from(usageMetrics)
    .where(
      and(
        eq(usageMetrics.userId, userId),
        gte(usageMetrics.sessionDate, startStr)
      )
    )
    .orderBy(usageMetrics.sessionDate)

  const result = rows.map(r => ({
    date: r.date,
    tasksCompleted: r.tasksCompleted,
    totalCostUsd: r.totalCostUsd,
  }))

  setCache(cacheKey, result)
  return result
}

// ── Hourly Activity (for hours×days heatmap) ────────────────────────

export interface HourlyActivity {
  date: string      // YYYY-MM-DD
  hour: number      // 0–23
  tasksCompleted: number
}

export async function getHourlyActivity(userId: string, days: number = 14): Promise<HourlyActivity[]> {
  const cacheKey = `hourly_activity:${userId}:${days}`
  const cached = getCached<HourlyActivity[]>(cacheKey)
  if (cached) return cached

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  const startStr = startDate.toISOString()

  const rows = await db.select({
    date: sql<string>`TO_CHAR(${taskExecutions.completedAt}, 'YYYY-MM-DD')`,
    hour: sql<number>`EXTRACT(HOUR FROM ${taskExecutions.completedAt})::int`,
    count: count(),
  })
    .from(taskExecutions)
    .where(
      and(
        sql`${taskExecutions.projectId} IN (SELECT id FROM projects WHERE owner_id = ${userId})`,
        sql`${taskExecutions.completedAt} IS NOT NULL`,
        gte(taskExecutions.completedAt, new Date(startStr)),
        eq(taskExecutions.status, 'success')
      )
    )
    .groupBy(
      sql`TO_CHAR(${taskExecutions.completedAt}, 'YYYY-MM-DD')`,
      sql`EXTRACT(HOUR FROM ${taskExecutions.completedAt})::int`
    )
    .orderBy(
      sql`TO_CHAR(${taskExecutions.completedAt}, 'YYYY-MM-DD')`,
      sql`EXTRACT(HOUR FROM ${taskExecutions.completedAt})::int`
    )

  const result: HourlyActivity[] = rows.map(r => ({
    date: r.date,
    hour: r.hour,
    tasksCompleted: r.count,
  }))

  setCache(cacheKey, result)
  return result
}

// ── Lifetime Stats ──────────────────────────────────────────────────

export async function computeLifetimeStats(userId: string): Promise<LifetimeStats> {
  const cacheKey = `lifetime_stats:${userId}`
  const cached = getCached<LifetimeStats>(cacheKey)
  if (cached) return cached

  // NOTE: Subqueries deliberately omit `status != 'deleted'` so that soft-deleted
  // projects still contribute to lifetime stats and achievement thresholds.
  // Deleting a project must never erase historical accomplishments — only hard-
  // deleting a project row (which the API no longer does) would lose this data.
  // Run multiple queries in parallel
  const [
    usageRows,
    linesResult,
    prsMergedResult,
    starsResult,
    projectsResult,
    plansSharedResult,
    speedDemonResult,
    longestExecResult,
  ] = await Promise.all([
    // All usage metrics rows for this user, ordered by date desc
    db.select({
      date: usageMetrics.sessionDate,
      tasksCompleted: usageMetrics.tasksCompleted,
      tasksFailed: usageMetrics.tasksFailed,
      totalCostUsd: usageMetrics.totalCostUsd,
    })
      .from(usageMetrics)
      .where(eq(usageMetrics.userId, userId))
      .orderBy(desc(usageMetrics.sessionDate)),

    // Total lines added from streaming_events (file_change events store linesAdded in JSON data)
    db.select({
      total: sql<string>`COALESCE(SUM((${streamingEvents.data}->>'linesAdded')::int), 0)`,
    })
      .from(streamingEvents)
      .innerJoin(taskExecutions, eq(streamingEvents.executionId, taskExecutions.executionId))
      .where(
        and(
          eq(streamingEvents.eventType, 'file_change'),
          sql`${taskExecutions.projectId} IN (SELECT id FROM projects WHERE owner_id = ${userId})`,
          sql`${streamingEvents.data}->>'linesAdded' IS NOT NULL`,
          isNull(streamingEvents.deletedAt),
        )
      ),

    // PRs merged: plan_nodes with prUrl set and status completed
    db.select({ count: count() })
      .from(planNodes)
      .where(
        and(
          sql`${planNodes.projectId} IN (SELECT id FROM projects WHERE owner_id = ${userId})`,
          sql`${planNodes.prUrl} IS NOT NULL`,
          eq(planNodes.status, 'completed')
        )
      ),

    // Stars received on shared plans
    db.select({ total: count() })
      .from(sharedPlanStars)
      .innerJoin(sharedPlans, eq(sharedPlanStars.planId, sharedPlans.id))
      .where(eq(sharedPlans.authorId, userId)),

    // Projects created
    db.select({ count: count() })
      .from(projects)
      .where(eq(projects.ownerId, userId)),

    // Plans shared
    db.select({ count: count() })
      .from(sharedPlans)
      .where(eq(sharedPlans.authorId, userId)),

    // Speed demon: any task completed in < 30 seconds
    db.select({ count: count() })
      .from(taskExecutions)
      .where(
        and(
          sql`${taskExecutions.projectId} IN (SELECT id FROM projects WHERE owner_id = ${userId})`,
          eq(taskExecutions.status, 'success'),
          sql`${taskExecutions.durationMs} < 30000`,
          sql`${taskExecutions.durationMs} > 0`
        )
      ),

    // Longest execution in minutes
    db.select({
      maxDuration: sql<number>`COALESCE(MAX(${taskExecutions.durationMs}), 0)`,
    })
      .from(taskExecutions)
      .where(
        sql`${taskExecutions.projectId} IN (SELECT id FROM projects WHERE owner_id = ${userId})`
      ),
  ])

  // Process usage rows for streaks, daily stats, etc.
  const today = new Date().toISOString().slice(0, 10)

  let currentStreak = 0
  let longestStreak = 0
  let tempStreak = 0
  let totalTasksCompleted = 0
  let totalCostUsd = 0
  let totalActiveDays = 0
  let bestDayTasks = 0
  let bestWeekTasks = 0
  let maxFailedInDay = 0
  let weekendsActive = 0
  let hasNightOwlTask = false

  // Sort by date ascending for streak calculation
  const sortedRows = [...usageRows].reverse()
  const activeDates = new Set<string>()

  for (const row of sortedRows) {
    totalTasksCompleted += row.tasksCompleted
    totalCostUsd += row.totalCostUsd
    if (row.tasksCompleted > 0) {
      totalActiveDays++
      activeDates.add(row.date)
      if (row.tasksCompleted > bestDayTasks) bestDayTasks = row.tasksCompleted
      if (row.tasksFailed > maxFailedInDay) maxFailedInDay = row.tasksFailed
      const dayOfWeek = new Date(row.date + 'T12:00:00Z').getDay()
      if (dayOfWeek === 0 || dayOfWeek === 6) weekendsActive++
    }
  }

  // Calculate current streak (consecutive days back from today)
  const d = new Date(today + 'T12:00:00Z')
  for (let i = 0; i < 400; i++) {
    const dateStr = d.toISOString().slice(0, 10)
    if (activeDates.has(dateStr)) {
      currentStreak++
    } else if (i > 0) {
      // Allow today to be missing (day not over yet)
      break
    }
    d.setDate(d.getDate() - 1)
  }

  // Calculate longest streak
  const sortedDates = Array.from(activeDates).sort()
  tempStreak = 0
  for (let i = 0; i < sortedDates.length; i++) {
    if (i === 0) {
      tempStreak = 1
    } else {
      const prev = new Date(sortedDates[i - 1] + 'T12:00:00Z')
      const curr = new Date(sortedDates[i] + 'T12:00:00Z')
      const diffDays = (curr.getTime() - prev.getTime()) / (86400 * 1000)
      tempStreak = diffDays === 1 ? tempStreak + 1 : 1
    }
    if (tempStreak > longestStreak) longestStreak = tempStreak
  }

  // Calculate best week tasks
  const weekMap = new Map<string, number>()
  for (const row of sortedRows) {
    const weekStart = getWeekStart(row.date)
    weekMap.set(weekStart, (weekMap.get(weekStart) || 0) + row.tasksCompleted)
  }
  for (const total of weekMap.values()) {
    if (total > bestWeekTasks) bestWeekTasks = total
  }

  // Night owl check: look for task completions between 2-5am
  // We'll approximate based on task execution completedAt timestamps
  // For simplicity, set based on available data
  hasNightOwlTask = false // Would need timezone-aware query; skip for now

  // Cheapest 10 tasks
  let cheapestTenTasksCost: number | null = null
  if (totalTasksCompleted >= 10) {
    const cheapResult = await db.select({
      cost: taskExecutions.estimatedCostUsd,
    })
      .from(taskExecutions)
      .where(
        and(
          sql`${taskExecutions.projectId} IN (SELECT id FROM projects WHERE owner_id = ${userId})`,
          eq(taskExecutions.status, 'success'),
          sql`${taskExecutions.estimatedCostUsd} IS NOT NULL`
        )
      )
      .orderBy(taskExecutions.estimatedCostUsd)
      .limit(10)

    if (cheapResult.length >= 10) {
      cheapestTenTasksCost = cheapResult.reduce((s, r) => s + (r.cost || 0), 0)
    }
  }

  const stats: LifetimeStats = {
    currentStreak,
    longestStreak,
    totalTasksCompleted,
    totalLinesAdded: Number(linesResult[0]?.total) || 0,
    totalPrsMerged: prsMergedResult[0]?.count || 0,
    totalStarsReceived: starsResult[0]?.total || 0,
    totalProjectsCreated: projectsResult[0]?.count || 0,
    totalPlansShared: plansSharedResult[0]?.count || 0,
    totalCostUsd,
    totalActiveDays,
    bestWeekTasks,
    cheapestTenTasksCost,
    hasNightOwlTask,
    hasSpeedDemonTask: (speedDemonResult[0]?.count || 0) > 0,
    weekendsActive,
    longestExecutionMinutes: Math.round((longestExecResult[0]?.maxDuration || 0) / 60000),
    maxFailedInDay,
    bestDayTasks,
  }

  setCache(cacheKey, stats)
  return stats
}

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const day = d.getDay()
  d.setDate(d.getDate() - day)
  return d.toISOString().slice(0, 10)
}

// ── Achievement Checking & Awarding ─────────────────────────────────

export interface EarnedAchievement {
  slug: string
  earnedAt: string
  metadata: Record<string, unknown>
}

export async function checkAndAwardAchievements(userId: string): Promise<EarnedAchievement[]> {
  // Fetch existing achievements (table may not exist if migration hasn't been applied)
  let existing: { slug: string; earnedAt: Date; metadata: unknown }[]
  try {
    existing = await db.select({
      slug: userAchievements.slug,
      earnedAt: userAchievements.earnedAt,
      metadata: userAchievements.metadata,
    })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId))
  } catch (err) {
    // Table doesn't exist yet — return empty achievements
    const code = (err as { code?: string }).code
    if (code === '42P01') {
      console.warn('[stats] user_achievements table does not exist — skipping achievement check')
      return []
    }
    throw err
  }

  const alreadyEarned = new Set(existing.map(e => e.slug))

  // Compute stats and check for new achievements
  const stats = await computeLifetimeStats(userId)
  const newSlugs = checkAchievements(stats, alreadyEarned)

  // Bulk insert newly earned achievements
  if (newSlugs.length > 0) {
    const now = new Date()
    try {
      await db.insert(userAchievements).values(
        newSlugs.map(slug => ({
          userId,
          slug,
          earnedAt: now,
          metadata: {},
        }))
      ).onConflictDoNothing()
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === '42P01') return existing.map(e => ({
        slug: e.slug,
        earnedAt: e.earnedAt.toISOString(),
        metadata: (e.metadata || {}) as Record<string, unknown>,
      }))
      throw err
    }
  }

  // Return all achievements (existing + new)
  const allEarned: EarnedAchievement[] = [
    ...existing.map(e => ({
      slug: e.slug,
      earnedAt: e.earnedAt.toISOString(),
      metadata: (e.metadata || {}) as Record<string, unknown>,
    })),
    ...newSlugs.map(slug => ({
      slug,
      earnedAt: new Date().toISOString(),
      metadata: {},
    })),
  ]

  return allEarned
}

// ── Full Stats Response ─────────────────────────────────────────────

export interface StatsResponse {
  stats: LifetimeStats
  achievements: EarnedAchievement[]
  xp: number
  level: number
  levelTitle: string
  nextLevelXp: number
}

export async function getFullStats(userId: string): Promise<StatsResponse> {
  const cacheKey = `full_stats:${userId}`
  const cached = getCached<StatsResponse>(cacheKey)
  if (cached) return cached

  const [stats, achievements] = await Promise.all([
    computeLifetimeStats(userId),
    checkAndAwardAchievements(userId),
  ])

  const xp = computeTotalXp(achievements.map(a => a.slug))
  const levelInfo = computeLevel(xp)

  const response: StatsResponse = {
    stats,
    achievements,
    xp,
    level: levelInfo.level,
    levelTitle: levelInfo.title,
    nextLevelXp: levelInfo.nextLevelXp,
  }

  setCache(cacheKey, response)
  return response
}

/**
 * Observations Route
 *
 * Query API for the observability system.
 * Provides endpoints for filtering, listing, and summarizing observation events.
 */

import { Hono } from 'hono'
import { db } from '../lib/db/index.js'
import { observationEvents, taskExecutions } from '../lib/db/schema.js'
import { eq, and, sql, asc, gte, lte } from 'drizzle-orm'

const observationsRoute = new Hono()

/**
 * GET /api/observations
 * List observations with filters.
 *
 * Query params:
 * - executionId: filter by trace/execution ID
 * - projectId: filter by project
 * - type: filter by observation type (span, generation, tool, event)
 * - level: filter by level (debug, default, warning, error)
 * - name: filter by observation name
 * - startAfter: ISO timestamp — observations starting after this time
 * - startBefore: ISO timestamp — observations starting before this time
 * - limit: max results (default 100, max 1000)
 * - offset: pagination offset (default 0)
 */
observationsRoute.get('/', async (c) => {
  try {
    const {
      executionId,
      projectId,
      type,
      level,
      name,
      startAfter,
      startBefore,
      limit: limitStr,
      offset: offsetStr,
    } = c.req.query()

    const limit = Math.min(Math.max(parseInt(limitStr || '100', 10) || 100, 1), 1000)
    const offset = Math.max(parseInt(offsetStr || '0', 10) || 0, 0)

    const conditions = []
    if (executionId) conditions.push(eq(observationEvents.traceId, executionId))
    if (projectId) conditions.push(eq(observationEvents.projectId, projectId))
    if (type) conditions.push(eq(observationEvents.type, type))
    if (level) conditions.push(eq(observationEvents.level, level))
    if (name) conditions.push(eq(observationEvents.name, name))
    if (startAfter) conditions.push(gte(observationEvents.startTime, new Date(startAfter)))
    if (startBefore) conditions.push(lte(observationEvents.startTime, new Date(startBefore)))

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const rows = await db
      .select()
      .from(observationEvents)
      .where(where)
      .orderBy(asc(observationEvents.startTime))
      .limit(limit)
      .offset(offset)

    return c.json({ data: rows, limit, offset })
  } catch (err) {
    console.error('[observations] Query failed:', err)
    return c.json({ error: 'Failed to query observations' }, 500)
  }
})

/**
 * GET /api/observations/stats
 * Aggregate statistics across observations.
 *
 * Query params:
 * - executionId: scope stats to a single execution
 * - projectId: scope stats to a project
 */
observationsRoute.get('/stats', async (c) => {
  try {
    const { executionId, projectId } = c.req.query()

    const conditions = []
    if (executionId) conditions.push(eq(observationEvents.traceId, executionId))
    if (projectId) conditions.push(eq(observationEvents.projectId, projectId))

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [stats] = await db
      .select({
        totalEvents: sql<number>`count(*)::int`,
        totalSpans: sql<number>`count(*) filter (where ${observationEvents.type} = 'span')::int`,
        totalGenerations: sql<number>`count(*) filter (where ${observationEvents.type} = 'generation')::int`,
        totalTools: sql<number>`count(*) filter (where ${observationEvents.type} = 'tool')::int`,
        totalEventType: sql<number>`count(*) filter (where ${observationEvents.type} = 'event')::int`,
        errorCount: sql<number>`count(*) filter (where ${observationEvents.level} = 'error')::int`,
        warningCount: sql<number>`count(*) filter (where ${observationEvents.level} = 'warning')::int`,
        totalCostUsd: sql<number>`coalesce(sum(${observationEvents.estimatedCostUsd}), 0)::real`,
        totalInputTokens: sql<number>`coalesce(sum(${observationEvents.inputTokens}), 0)::int`,
        totalOutputTokens: sql<number>`coalesce(sum(${observationEvents.outputTokens}), 0)::int`,
      })
      .from(observationEvents)
      .where(where)

    return c.json(stats)
  } catch (err) {
    console.error('[observations] Stats query failed:', err)
    return c.json({ error: 'Failed to query observation stats' }, 500)
  }
})

/**
 * GET /api/observations/:traceId
 * All observations for a specific execution, ordered by startTime.
 */
observationsRoute.get('/:traceId', async (c) => {
  try {
    const { traceId } = c.req.param()

    // Check if this looks like a summary request (handled by next route)
    // Hono matches routes in order, so /stats and /:traceId/summary are handled first

    const rows = await db
      .select()
      .from(observationEvents)
      .where(eq(observationEvents.traceId, traceId))
      .orderBy(asc(observationEvents.startTime))

    return c.json({ data: rows, traceId })
  } catch (err) {
    console.error('[observations] Trace query failed:', err)
    return c.json({ error: 'Failed to query observations for trace' }, 500)
  }
})

/**
 * GET /api/observations/:traceId/summary
 * Markdown summary for an execution.
 */
observationsRoute.get('/:traceId/summary', async (c) => {
  try {
    const { traceId } = c.req.param()

    // Try to get the pre-generated markdown summary from taskExecutions
    const [execution] = await db
      .select({ markdownSummary: taskExecutions.markdownSummary })
      .from(taskExecutions)
      .where(eq(taskExecutions.executionId, traceId))

    if (execution?.markdownSummary) {
      return c.text(execution.markdownSummary)
    }

    // No pre-generated summary — generate one on-the-fly from observations
    const rows = await db
      .select()
      .from(observationEvents)
      .where(eq(observationEvents.traceId, traceId))
      .orderBy(asc(observationEvents.startTime))

    if (rows.length === 0) {
      return c.text('No observations found for this trace.', 404)
    }

    // Build a basic summary from DB observations
    const tools = rows.filter((r) => r.type === 'tool')
    const events = rows.filter((r) => r.type === 'event')
    const generations = rows.filter((r) => r.type === 'generation')
    const errors = rows.filter((r) => r.level === 'error')

    const totalCost = rows.reduce((sum, r) => sum + (r.estimatedCostUsd ?? 0), 0)

    const lines = [
      '# Execution Summary',
      '',
      `**Trace ID:** \`${traceId}\``,
      `**Total observations:** ${rows.length}`,
      '',
      '## Breakdown',
      '',
      `| Type | Count |`,
      `|------|-------|`,
      `| Tools | ${tools.length} |`,
      `| Events | ${events.length} |`,
      `| Generations | ${generations.length} |`,
      `| Errors | ${errors.length} |`,
    ]

    if (totalCost > 0) {
      lines.push('')
      lines.push(`**Estimated cost:** $${totalCost.toFixed(4)}`)
    }

    return c.text(lines.join('\n'))
  } catch (err) {
    console.error('[observations] Summary query failed:', err)
    return c.json({ error: 'Failed to generate summary' }, 500)
  }
})

export { observationsRoute }

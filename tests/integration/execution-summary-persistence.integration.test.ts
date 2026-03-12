/**
 * Integration test: Execution summary JSONB persistence
 *
 * Verifies that the task_executions.summary jsonb column exists in PGlite
 * (Drizzle migration 0024) and round-trips correctly through the API.
 *
 * This test prevents regressions like PR #912 where the Supabase migration
 * was added but the Drizzle migration was missed, breaking local mode.
 *
 * Run with: npx vitest run tests/integration/execution-summary-persistence.integration.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  setupTestServer,
  postJson,
  db,
} from '../helpers/test-server.js'
import { taskExecutions } from '../../server/lib/db/schema.js'
import { eq } from 'drizzle-orm'

let testProjectId: string

beforeAll(async () => {
  await setupTestServer()
  // Create a real project so FK constraints are satisfied
  const res = await postJson('/api/data/projects', { name: 'Summary Test Project' })
  const project = await res.json()
  testProjectId = project.id
})

describe('task_executions.summary column', () => {
  it('column exists in PGlite schema', async () => {
    // Direct SQL check — the column must exist for any insert/select to work
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (db as any).execute(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'task_executions' AND column_name = 'summary'
    `)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].data_type).toBe('jsonb')
  })

  it('persists ExecutionSummary JSONB via direct insert and read', async () => {
    const testSummary = {
      workCompleted: 'Generated daily digest for 30 papers',
      keyFindings: ['Found 5 trending papers', 'All papers categorized'],
      filesChanged: ['daily-digest-2026-03-11.html', 'daily-digest-2026-03-11.md'],
      status: 'success',
      followUps: ['Review categorization accuracy'],
    }

    const executionId = `test-summary-${Date.now()}`

    // Insert via Drizzle ORM (same path as persist())
    await db.insert(taskExecutions).values({
      executionId,
      nodeClientId: 'test-node-1',
      projectId: testProjectId,
      status: 'success',
      summary: testSummary,
    })

    // Read back via Drizzle ORM
    const rows = await db
      .select()
      .from(taskExecutions)
      .where(eq(taskExecutions.executionId, executionId))

    expect(rows).toHaveLength(1)
    expect(rows[0].summary).toEqual(testSummary)
    const summary = rows[0].summary as Record<string, unknown>
    expect(summary.workCompleted).toBe('Generated daily digest for 30 papers')
    expect(summary.keyFindings).toHaveLength(2)
    expect(summary.status).toBe('success')

    // Cleanup
    await db.delete(taskExecutions).where(eq(taskExecutions.executionId, executionId))
  })

  it('persists summary via POST /api/data/executions endpoint', async () => {
    const executionId = `test-api-summary-${Date.now()}`
    const summary = {
      workCompleted: 'Implemented feature X',
      keyFindings: ['All tests pass'],
      filesChanged: ['src/feature.ts'],
      status: 'success',
      followUps: [],
    }

    // POST execution with summary (API expects `nodeId` not `nodeClientId`)
    const postRes = await postJson('/api/data/executions', {
      executionId,
      nodeId: 'test-api-node',
      projectId: testProjectId,
      status: 'success',
      summary,
    })
    expect(postRes.status).toBe(200)

    // Read back via direct Drizzle query to verify DB round-trip
    const rows = await db
      .select()
      .from(taskExecutions)
      .where(eq(taskExecutions.executionId, executionId))

    expect(rows).toHaveLength(1)
    expect(rows[0].summary).toEqual(summary)

    // Cleanup
    await db.delete(taskExecutions).where(eq(taskExecutions.executionId, executionId))
  })

  it('handles null summary gracefully', async () => {
    const executionId = `test-null-summary-${Date.now()}`

    await db.insert(taskExecutions).values({
      executionId,
      nodeClientId: 'test-node-null',
      projectId: testProjectId,
      status: 'running',
      // summary omitted — should be null
    })

    const rows = await db
      .select()
      .from(taskExecutions)
      .where(eq(taskExecutions.executionId, executionId))

    expect(rows).toHaveLength(1)
    expect(rows[0].summary).toBeNull()

    // Cleanup
    await db.delete(taskExecutions).where(eq(taskExecutions.executionId, executionId))
  })

  it('upsert without summary preserves existing summary', async () => {
    const executionId = `test-update-summary-${Date.now()}`
    const originalSummary = {
      workCompleted: 'Original work',
      keyFindings: ['Finding 1'],
      filesChanged: [],
      status: 'success',
      followUps: [],
    }

    // Insert with summary
    await db.insert(taskExecutions).values({
      executionId,
      nodeClientId: 'test-node-update',
      projectId: testProjectId,
      status: 'success',
      summary: originalSummary,
    })

    // Upsert via POST WITHOUT summary — should preserve original
    const postRes = await postJson('/api/data/executions', {
      executionId,
      nodeId: 'test-node-update',
      projectId: testProjectId,
      status: 'success',
      // summary intentionally omitted
    })
    expect(postRes.status).toBe(200)

    // Verify original summary is preserved
    const rows = await db
      .select()
      .from(taskExecutions)
      .where(eq(taskExecutions.executionId, executionId))

    expect(rows).toHaveLength(1)
    expect(rows[0].summary).toEqual(originalSummary)

    // Cleanup
    await db.delete(taskExecutions).where(eq(taskExecutions.executionId, executionId))
  })
})

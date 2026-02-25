process.env.ASTRO_LOCAL_MODE = 'true'

import { describe, it, expect, beforeAll } from 'vitest'
import { runMigrations } from '../server/lib/db/migrate.js'
import { db } from '../server/lib/db/index.js'
import { planNodes, projects } from '../packages/core/src/db/schema.js'
import { eq, sql } from 'drizzle-orm'

describe('AcceptanceCriteria E2E', () => {
  let projectId: string
  const suffix = Date.now().toString(36)

  beforeAll(async () => {
    await runMigrations()

    // Ensure acceptance_criteria column exists (may not yet have a Drizzle migration)
    await db.execute(sql`ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb`)

    // Create a test project
    const [project] = await db.insert(projects).values({
      ownerId: '00000000-0000-0000-0000-000000000001',
      name: `AC Test Project ${suffix}`,
      description: 'Test project for acceptance criteria',
    }).returning()
    projectId = project.id
  })

  describe('DB round-trip', () => {
    it('stores and retrieves acceptanceCriteria as JSONB', async () => {
      const criteria = [
        { id: 'ac1', type: 'test', description: 'Run unit tests', command: 'npm test', autoVerifiable: true },
        { id: 'ac2', type: 'manual', description: 'Check UI design', autoVerifiable: false },
      ]

      const clientId = `ac-node-store-${suffix}`
      await db.insert(planNodes).values({
        clientId,
        projectId,
        type: 'task',
        title: 'Test Task',
        description: 'A test task',
        status: 'planned',
        verification: 'auto',
        positionX: 40,
        positionY: 40,
        acceptanceCriteria: criteria,
      })

      const [node] = await db.select().from(planNodes).where(eq(planNodes.clientId, clientId))
      expect(node.acceptanceCriteria).toEqual(criteria)
    })

    it('defaults to empty array when not provided', async () => {
      const clientId = `ac-node-default-${suffix}`
      await db.insert(planNodes).values({
        clientId,
        projectId,
        type: 'task',
        title: 'Task without criteria',
        description: 'No criteria',
        status: 'planned',
        verification: 'auto',
        positionX: 40,
        positionY: 140,
      })

      const [node] = await db.select().from(planNodes).where(eq(planNodes.clientId, clientId))
      expect(node.acceptanceCriteria).toEqual([])
    })

    it('updates criteria on existing node', async () => {
      const clientId = `ac-node-update-${suffix}`
      // Insert first
      await db.insert(planNodes).values({
        clientId,
        projectId,
        type: 'task',
        title: 'Task to update',
        description: 'Will be updated',
        status: 'planned',
        verification: 'auto',
        positionX: 40,
        positionY: 240,
        acceptanceCriteria: [{ id: 'ac-old', type: 'test', description: 'Old check', command: 'echo old', autoVerifiable: true }],
      })

      const newCriteria = [
        { id: 'ac3', type: 'build', description: 'Build passes', command: 'npm run build', autoVerifiable: true },
      ]

      await db.update(planNodes)
        .set({ acceptanceCriteria: newCriteria })
        .where(eq(planNodes.clientId, clientId))

      const [node] = await db.select().from(planNodes).where(eq(planNodes.clientId, clientId))
      expect(node.acceptanceCriteria).toEqual(newCriteria)
    })
  })
})

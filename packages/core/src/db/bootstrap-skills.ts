/**
 * Bootstrap Built-in Skills
 *
 * Seeds built-in skill definitions on server startup.
 * Idempotent — safe to call on every restart.
 *
 * Built-in skills:
 * - Source is 'builtin'
 * - Have no authorId (global, not user-owned)
 * - Have no teamId (visible to all teams)
 * - Are identified by name (unique for builtins)
 */

import { db } from './index.js'
import { skills } from './schema.js'
import { builtinSkills } from '../skills/index.js'

/**
 * Seed built-in skills into the database.
 *
 * Uses onConflictDoUpdate to handle concurrent startup race conditions.
 * Wrapped in a transaction for consistency.
 */
export async function bootstrapBuiltinSkills(): Promise<void> {
  console.log('[bootstrap] Seeding built-in skills...')

  // Warm up the DB connection to ensure readiness before bootstrap
  await db.select().from(skills).limit(1)

  let inserted = 0
  let updated = 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.transaction(async (tx: any) => {
    for (const skill of builtinSkills) {
      try {
        const result = await tx.insert(skills).values({
          name: skill.name,
          version: skill.version,
          description: skill.description,
          instructions: skill.instructions,
          category: skill.category,
          tags: skill.tags,
          source: 'builtin',
          sourceUrl: null,
          authorId: null,
          teamId: null,
          enabled: true,
          allowedTools: skill.allowedTools,
          config: {},
        }).onConflictDoUpdate({
          target: skills.id,
          set: {
            version: skill.version,
            description: skill.description,
            instructions: skill.instructions,
            category: skill.category,
            tags: skill.tags,
            allowedTools: skill.allowedTools,
            updatedAt: new Date(),
          },
        }).returning()

        if (result.length > 0) {
          // Check if this was an insert or update by comparing timestamps
          const row = result[0]
          const timeDiff = Math.abs(new Date(row.createdAt).getTime() - new Date(row.updatedAt).getTime())
          if (timeDiff < 1000) {
            console.log(`[bootstrap] Inserted builtin skill: ${skill.name}`)
            inserted++
          } else {
            console.log(`[bootstrap] Updated builtin skill: ${skill.name}`)
            updated++
          }
        }
      } catch (e) {
        console.error(`[bootstrap] Failed to seed builtin skill: ${skill.name}`, e)
        throw e // Re-throw to roll back the transaction
      }
    }
  })

  console.log(
    `[bootstrap] Built-in skills seeding complete: ${inserted} inserted, ${updated} updated`
  )
}

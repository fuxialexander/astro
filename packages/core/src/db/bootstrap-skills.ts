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

import { eq, and } from 'drizzle-orm'
import { db } from './index.js'
import { skills } from './schema.js'
import { builtinSkills } from '../skills/index.js'

/**
 * Seed built-in skills into the database.
 *
 * Uses check-then-insert/update pattern since the unique constraint
 * is a partial index (name WHERE source='builtin'), which Drizzle's
 * onConflictDoUpdate cannot target. Wrapped in a transaction.
 */
export async function bootstrapBuiltinSkills(): Promise<void> {
  console.log('[bootstrap] Seeding built-in skills...')

  // Warm up the DB connection to ensure readiness before bootstrap
  await db.select().from(skills).limit(1)

  let inserted = 0
  let updated = 0

  // tx inherits `any` from the dual-driver db proxy (PGlite + postgres-js)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.transaction(async (tx: any) => {
    for (const skill of builtinSkills) {
      try {
        const [existing] = await tx.select({ id: skills.id, version: skills.version })
          .from(skills)
          .where(and(eq(skills.name, skill.name), eq(skills.source, 'builtin')))

        if (existing) {
          // Update if version or content changed
          await tx.update(skills).set({
            version: skill.version,
            description: skill.description,
            instructions: skill.instructions,
            category: skill.category,
            tags: skill.tags,
            allowedTools: skill.allowedTools,
            updatedAt: new Date(),
          }).where(eq(skills.id, existing.id))
          console.log(`[bootstrap] Updated builtin skill: ${skill.name}`)
          updated++
        } else {
          await tx.insert(skills).values({
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
          })
          console.log(`[bootstrap] Inserted builtin skill: ${skill.name}`)
          inserted++
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


/**
 * Load all enabled skills from DB into the in-memory skill-manager.
 * Called after bootstrap and after API mutations to keep the
 * in-memory registry (used for prompt injection) in sync with DB.
 */
export async function syncSkillsFromDb(
  skillManager: { loadSkills: (skills: Array<{
    name: string; description: string; instructions: string;
    source: string; enabled: boolean;
    config?: Record<string, unknown>;
    userInvocable?: boolean; disableModelInvocation?: boolean;
  }>) => void }
): Promise<void> {
  const rows = await db.select().from(skills).where(eq(skills.enabled, true))
  const mapped = rows.map((s) => ({
    name: s.name,
    description: s.description,
    instructions: s.instructions,
    source: s.source ?? 'workspace',
    enabled: s.enabled,
    config: (s.config ?? {}) as Record<string, unknown>,
    userInvocable: ((s.config as Record<string, unknown>)?.userInvocable as boolean | undefined),
    disableModelInvocation: ((s.config as Record<string, unknown>)?.disableModelInvocation as boolean | undefined),
  }))
  skillManager.loadSkills(mapped)
}

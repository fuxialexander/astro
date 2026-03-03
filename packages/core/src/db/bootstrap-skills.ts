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
import type { BuiltinSkillDefinition } from '../skills/types.js'

/**
 * Seed built-in skills into the database.
 *
 * Uses check-then-insert/update pattern since the unique constraint
 * is a partial index (name WHERE source='builtin'), which Drizzle's
 * onConflictDoUpdate cannot target. Wrapped in a transaction.
 *
 * @param builtinSkills - Skill definitions loaded from SKILL.md files on disk
 */
export async function bootstrapBuiltinSkills(builtinSkills: BuiltinSkillDefinition[]): Promise<void> {
  console.log('[bootstrap] Seeding built-in skills...')

  if (builtinSkills.length === 0) {
    console.log('[bootstrap] No built-in skills to seed')
    return
  }

  // Warm up the DB connection to ensure readiness before bootstrap
  await db.select().from(skills).limit(1)

  let inserted = 0
  let updated = 0
  let unchanged = 0

  // tx inherits `any` from the dual-driver db proxy (PGlite + postgres-js).
  // Both drivers expose identical Drizzle query-builder APIs at runtime, but
  // TypeScript cannot unify their incompatible generic type declarations
  // (PgliteDatabase vs PostgresJsDatabase). The `db` export is typed as
  // `any` at the proxy boundary (see packages/core/src/db/index.ts), so the
  // transaction callback parameter inherits that `any`. Narrowing to one
  // driver's type would break the other driver at compile time, so `any` is
  // the correct tradeoff here — callers still get full Drizzle API
  // autocompletion and runtime safety; only the TypeScript-level generic
  // parameter is lost.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.transaction(async (tx: any) => {
    for (const skill of builtinSkills) {
      try {
        const [existing] = await tx.select({
          id: skills.id,
          version: skills.version,
          description: skills.description,
          instructions: skills.instructions,
          category: skills.category,
          tags: skills.tags,
          allowedTools: skills.allowedTools,
        })
          .from(skills)
          .where(and(eq(skills.name, skill.name), eq(skills.source, 'builtin')))

        if (existing) {
          // Compare all fields to avoid unnecessary writes
          const tagsMatch = JSON.stringify(existing.tags ?? []) === JSON.stringify(skill.tags ?? [])
          const toolsMatch = JSON.stringify(existing.allowedTools ?? []) === JSON.stringify(skill.allowedTools ?? [])
          const isUnchanged =
            existing.version === skill.version &&
            existing.description === skill.description &&
            existing.instructions === skill.instructions &&
            existing.category === skill.category &&
            tagsMatch &&
            toolsMatch

          if (isUnchanged) {
            console.log(`[bootstrap] Unchanged builtin skill: ${skill.name}`)
            unchanged++
          } else {
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
          }
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
    `[bootstrap] Built-in skills seeding complete: ${inserted} inserted, ${updated} updated, ${unchanged} unchanged`
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
  // rows inherits `any[]` from the dual-driver db proxy — annotate explicitly
  const mapped = rows.map((s: { name: string; description: string; instructions: string; source: string | null; enabled: boolean; config: Record<string, unknown> | null; teamId: string | null }) => ({
    name: s.name,
    description: s.description,
    instructions: s.instructions,
    source: s.source ?? 'workspace',
    enabled: s.enabled,
    config: (s.config ?? {}) as Record<string, unknown>,
    userInvocable: (s.config?.userInvocable as boolean | undefined),
    disableModelInvocation: (s.config?.disableModelInvocation as boolean | undefined),
    teamId: s.teamId,
  }))
  skillManager.loadSkills(mapped)
}

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

import { eq, and, sql } from 'drizzle-orm'
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
 * NOTE: Builtin skills have team_id=NULL, but the RLS INSERT policy requires
 * team_id IS NOT NULL. This works because the Hono API server connects with
 * the service_role key, which bypasses RLS. If the DB connection changes to
 * use a non-privileged role, this function will fail to seed builtins.
 *
 * @param builtinSkills - Skill definitions loaded from SKILL.md files on disk
 */
export async function bootstrapBuiltinSkills(builtinSkills: BuiltinSkillDefinition[]): Promise<void> {
  console.log('[bootstrap] Seeding built-in skills...')

  if (builtinSkills.length === 0) {
    console.log('[bootstrap] No built-in skills to seed')
    return
  }

  // Warm up the DB connection and verify RLS bypass capability.
  // Builtin skills have team_id=NULL, but the RLS INSERT policy requires
  // team_id IS NOT NULL. Bootstrap only works with service_role (bypasses RLS)
  // or PGlite (RLS not enforced). Fail-fast if we detect a restricted role.
  await db.select().from(skills).limit(1)
  try {
    const [roleCheck] = await db.select({ role: sql<string>`current_setting('role')` }).from(sql`(SELECT 1) AS _`)
    const role = roleCheck?.role
    if (role && !['service_role', 'rds_superuser', 'postgres', 'supabase_admin', 'none'].includes(role)) {
      throw new Error(
        `[bootstrap] DB role "${role}" lacks RLS bypass privileges required to seed builtin skills (team_id=NULL). `
        + `Connect with service_role or add an RLS policy exception for builtin skills.`
      )
    }
  } catch (e) {
    // Re-throw bootstrap errors; only swallow PGlite current_setting failures
    if (e instanceof Error && e.message.includes('[bootstrap]')) throw e
    // PGlite may not support current_setting on some versions — safe to ignore (no RLS enforced)
  }

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
      // Validate required fields — prevents malformed SKILL.md files from creating
      // invalid DB rows. Shared validation with the API route (server/routes/skills.ts).
      if (!skill.name || typeof skill.name !== 'string') {
        console.error(`[bootstrap] Skipping builtin skill with invalid name:`, skill)
        continue
      }
      if (!skill.instructions || typeof skill.instructions !== 'string') {
        console.error(`[bootstrap] Skipping builtin skill "${skill.name}" — missing instructions`)
        continue
      }
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
          // Compare all frontmatter fields to avoid unnecessary writes.
          // Note: `config` is intentionally excluded — builtin skills use frontmatter
          // fields only; the config JSONB column is reserved for user/ClawHub skills.
          // Sort arrays before comparing to avoid false positives from order differences
          const tagsMatch = JSON.stringify([...(existing.tags ?? [])].sort()) === JSON.stringify([...(skill.tags ?? [])].sort())
          const toolsMatch = JSON.stringify([...(existing.allowedTools ?? [])].sort()) === JSON.stringify([...(skill.allowedTools ?? [])].sort())
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


/** Map a DB skill row to the shape expected by SkillManager */
function mapSkillRow(s: { name: string; description: string; instructions: string; source: string | null; enabled: boolean; config: Record<string, unknown> | null; teamId: string | null; tags?: string[] | null }) {
  return {
    name: s.name,
    description: s.description,
    instructions: s.instructions,
    source: s.source ?? 'workspace',
    enabled: s.enabled,
    config: (s.config ?? {}) as Record<string, unknown>,
    userInvocable: (s.config?.userInvocable as boolean | undefined),
    disableModelInvocation: (s.config?.disableModelInvocation as boolean | undefined),
    teamId: s.teamId,
    tags: s.tags ?? [],
  }
}

/** Skill manager interface for sync functions */
interface SyncableSkillManager {
  loadSkills: (skills: Array<ReturnType<typeof mapSkillRow>>) => void
  addSkill?: (skill: ReturnType<typeof mapSkillRow>) => void
  removeSkill?: (name: string, teamId?: string | null) => boolean
}

/**
 * Load all enabled skills from DB into the in-memory skill-manager.
 * Called after bootstrap to do a full initial load.
 */
export async function syncSkillsFromDb(
  skillManager: SyncableSkillManager
): Promise<void> {
  const rows = await db.select().from(skills).where(eq(skills.enabled, true))
  // rows inherits `any[]` from the dual-driver db proxy — annotate explicitly
  const mapped = (rows as Array<{ name: string; description: string; instructions: string; source: string | null; enabled: boolean; config: Record<string, unknown> | null; teamId: string | null; tags?: string[] | null }>).map(mapSkillRow)
  skillManager.loadSkills(mapped)
}

/**
 * Incrementally sync a single skill by ID after an API mutation.
 * Avoids the O(N) full DB reload of syncSkillsFromDb.
 * Falls back to full sync if the manager doesn't support incremental ops.
 */
export async function syncSkillById(
  skillManager: SyncableSkillManager,
  skillId: string,
): Promise<void> {
  if (!skillManager.addSkill || !skillManager.removeSkill) {
    // Fallback to full sync for managers without incremental support
    return syncSkillsFromDb(skillManager)
  }

  const [row] = await db.select().from(skills).where(
    and(eq(skills.id, skillId), eq(skills.enabled, true))
  )

  if (row) {
    skillManager.addSkill(mapSkillRow(row as { name: string; description: string; instructions: string; source: string | null; enabled: boolean; config: Record<string, unknown> | null; teamId: string | null; tags?: string[] | null }))
  } else {
    // Skill was deleted or disabled — need to remove from cache.
    // Fetch the skill regardless of enabled status to get its name/teamId for removal.
    const [deleted] = await db.select().from(skills).where(eq(skills.id, skillId))
    if (deleted) {
      skillManager.removeSkill(
        (deleted as { name: string; teamId: string | null }).name,
        (deleted as { teamId: string | null }).teamId,
      )
    }
    // If not found at all, it was hard-deleted — do a full sync to clean up
    if (!deleted) {
      return syncSkillsFromDb(skillManager)
    }
  }
}

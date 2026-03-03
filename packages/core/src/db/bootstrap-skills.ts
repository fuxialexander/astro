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
import { eq, and } from 'drizzle-orm'
// Skills live at repo root (skills/) — path alias configured in packages/core/tsconfig.json.
// At runtime (tsx), this resolves via relative path; tsc uses the @skills alias for type checking.
import { builtinSkills } from '../../../../skills/index.js' // @skills

/**
 * Check if any builtin skill field has changed compared to the DB row.
 */
function builtinNeedsUpdate(
  existing: { version: string | null; description: string; instructions: string; category: string | null; tags: string[]; allowedTools: string[] },
  skill: { version: string; description: string; instructions: string; category: string; tags: string[]; allowedTools: string[] },
): boolean {
  return (
    existing.version !== skill.version ||
    existing.description !== skill.description ||
    existing.instructions !== skill.instructions ||
    existing.category !== skill.category ||
    JSON.stringify(existing.tags) !== JSON.stringify(skill.tags) ||
    JSON.stringify(existing.allowedTools) !== JSON.stringify(skill.allowedTools)
  )
}

/**
 * Seed built-in skills into the database.
 *
 * For each built-in skill definition:
 * - Check if a skill with the same name and source='builtin' exists
 * - If not, insert it
 * - If yes, update it if any field has changed (not just version)
 */
export async function bootstrapBuiltinSkills(): Promise<void> {
  console.log('[bootstrap] Seeding built-in skills...')

  // Warm up the DB connection to ensure readiness before bootstrap
  await db.select().from(skills).limit(1)

  let inserted = 0
  let updated = 0
  let unchanged = 0

  for (const skill of builtinSkills) {
    // Check if this builtin skill exists by name and source='builtin'
    const [existing] = await db
      .select()
      .from(skills)
      .where(
        and(
          eq(skills.name, skill.name),
          eq(skills.source, 'builtin')
        )
      )

    if (!existing) {
      // Insert new built-in skill
      await db.insert(skills).values({
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
    } else if (builtinNeedsUpdate(existing, skill)) {
      // Update existing skill if any field has changed
      await db
        .update(skills)
        .set({
          version: skill.version,
          description: skill.description,
          instructions: skill.instructions,
          category: skill.category,
          tags: skill.tags,
          allowedTools: skill.allowedTools,
          updatedAt: new Date(),
        })
        .where(eq(skills.id, existing.id))
      console.log(`[bootstrap] Updated builtin skill: ${skill.name} (${existing.version} -> ${skill.version})`)
      updated++
    } else {
      unchanged++
    }
  }

  console.log(
    `[bootstrap] Built-in skills seeding complete: ${inserted} inserted, ${updated} updated, ${unchanged} unchanged`
  )
}

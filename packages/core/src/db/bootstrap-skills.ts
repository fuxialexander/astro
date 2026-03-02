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
import { builtinSkills } from '../skills/index.js'

/**
 * Seed built-in skills into the database.
 *
 * For each built-in skill definition:
 * - Check if a skill with the same name and source='builtin' exists
 * - If not, insert it
 * - If yes, update it if version changed (allows skill updates on upgrade)
 */
export async function bootstrapBuiltinSkills(): Promise<void> {
  console.log('[bootstrap] Seeding built-in skills...')

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
    } else if (existing.version !== skill.version) {
      // Update existing skill if version changed (skill definition updated)
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

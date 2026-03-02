/**
 * Seed Built-in Skills
 *
 * Checks the `skills` table for missing built-in skill definitions and
 * inserts any that don't already exist (by name). Idempotent — safe to
 * call on every server startup.
 *
 * Returns the full list of built-in skills from the DB (for loading into
 * the in-memory SkillManager).
 */

import { db } from './index.js'
import { skills } from './schema.js'
import { eq, inArray } from 'drizzle-orm'
import { builtInSkills, getBuiltInSkillNames } from '../skills/index.js'
import type { OpenClawSkill } from '../types/skill.js'

/**
 * Seed built-in skills into the database.
 *
 * For each built-in skill definition:
 * 1. Check if a row with that name already exists
 * 2. If not, insert it with source='builtin'
 *
 * Returns all built-in skills from the DB (including previously-seeded ones)
 * as OpenClawSkill objects, ready to load into the SkillManager.
 */
export async function seedBuiltinSkills(): Promise<OpenClawSkill[]> {
  const names = getBuiltInSkillNames()
  if (names.length === 0) {
    console.log('[seed-skills] No built-in skills defined, skipping')
    return []
  }

  console.log(`[seed-skills] Checking ${names.length} built-in skill(s)...`)

  // Find which built-in skills already exist in the DB
  const existing = await db
    .select({ name: skills.name })
    .from(skills)
    .where(inArray(skills.name, names))

  const existingNames = new Set(existing.map((r: { name: string }) => r.name))

  // Insert any missing built-in skills
  const toInsert = builtInSkills.filter((s) => !existingNames.has(s.name))

  if (toInsert.length > 0) {
    await db.insert(skills).values(
      toInsert.map((s) => ({
        name: s.name,
        description: s.description,
        instructions: s.instructions,
        source: s.source,
        enabled: s.enabled,
        userInvocable: s.userInvocable ?? true,
        disableModelInvocation: s.disableModelInvocation ?? false,
        commandDispatch: s.commandDispatch ?? null,
        commandTool: s.commandTool ?? null,
        homepage: s.homepage ?? null,
        metadata: (s.metadata as Record<string, unknown>) ?? null,
        pluginId: s.pluginId ?? null,
        config: s.config ?? null,
      }))
    )
    console.log(`[seed-skills] Inserted ${toInsert.length} built-in skill(s): ${toInsert.map((s) => s.name).join(', ')}`)
  } else {
    console.log('[seed-skills] All built-in skills already present')
  }

  // Return all built-in skills from DB (for loading into SkillManager)
  const rows = await db
    .select()
    .from(skills)
    .where(eq(skills.source, 'builtin'))

  return rows.map((r: Record<string, unknown>): OpenClawSkill => ({
    name: r.name as string,
    description: (r.description as string) || '',
    instructions: (r.instructions as string) || '',
    source: r.source as OpenClawSkill['source'],
    enabled: r.enabled as boolean,
    userInvocable: r.userInvocable as boolean,
    disableModelInvocation: r.disableModelInvocation as boolean,
    commandDispatch: r.commandDispatch as OpenClawSkill['commandDispatch'],
    commandTool: r.commandTool as string | undefined,
    homepage: r.homepage as string | undefined,
    metadata: r.metadata as OpenClawSkill['metadata'],
    pluginId: r.pluginId as string | undefined,
    config: r.config as Record<string, unknown> | undefined,
  }))
}

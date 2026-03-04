/**
 * Bootstrap Catalog Skills
 *
 * Seeds catalog skill definitions on server startup.
 * Idempotent — safe to call on every restart.
 *
 * Catalog skills:
 * - Source is 'catalog'
 * - Have no authorId (global, not user-owned)
 * - Have no teamId (visible to all teams)
 * - Start disabled (teams opt in via collection toggle)
 * - Store collectionId, collectionName, provider in config JSONB
 */

import { eq, and } from 'drizzle-orm'
import { db } from './index.js'
import { skills } from './schema.js'
import type { CatalogCollection } from '../skills/types.js'

/**
 * Seed catalog skills into the database.
 *
 * Same check-then-insert/update pattern as bootstrapBuiltinSkills().
 * Catalog skills have `enabled=false` by default (opt-in via collection toggle).
 */
export async function bootstrapCatalogSkills(collections: CatalogCollection[]): Promise<void> {
  const totalSkills = collections.reduce((acc, c) => acc + c.skills.length, 0)
  if (totalSkills === 0) {
    console.log('[catalog] No catalog skills to seed')
    return
  }

  let inserted = 0
  let updated = 0
  let unchanged = 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.transaction(async (tx: any) => {
    for (const collection of collections) {
      for (const skill of collection.skills) {
        if (!skill.name || typeof skill.name !== 'string') {
          console.error(`[catalog] Skipping catalog skill with invalid name:`, skill)
          continue
        }
        if (!skill.instructions || typeof skill.instructions !== 'string') {
          console.error(`[catalog] Skipping catalog skill "${skill.name}" — missing instructions`)
          continue
        }

        const config: Record<string, unknown> = {
          collectionId: collection.manifest.id,
          collectionName: collection.manifest.name,
          provider: collection.manifest.provider,
        }
        // Pack optional boolean fields into config
        if (skill.disableModelInvocation !== undefined) {
          config.disableModelInvocation = skill.disableModelInvocation
        }
        if (skill.userInvocable !== undefined) {
          config.userInvocable = skill.userInvocable
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
            enabled: skills.enabled,
            config: skills.config,
          })
            .from(skills)
            .where(and(eq(skills.name, skill.name), eq(skills.source, 'catalog')))

          if (existing) {
            // Compare all frontmatter fields to avoid unnecessary writes.
            // Preserve the existing enabled state (user's toggle choice).
            const tagsMatch = JSON.stringify([...(existing.tags ?? [])].sort()) === JSON.stringify([...(skill.tags ?? [])].sort())
            const toolsMatch = JSON.stringify([...(existing.allowedTools ?? [])].sort()) === JSON.stringify([...(skill.allowedTools ?? [])].sort())
            const existingConfig = (existing.config ?? {}) as Record<string, unknown>
            const configMatch =
              existingConfig.collectionId === config.collectionId &&
              existingConfig.collectionName === config.collectionName &&
              existingConfig.provider === config.provider &&
              existingConfig.disableModelInvocation === config.disableModelInvocation &&
              existingConfig.userInvocable === config.userInvocable

            const isUnchanged =
              existing.version === skill.version &&
              existing.description === skill.description &&
              existing.instructions === skill.instructions &&
              existing.category === skill.category &&
              tagsMatch &&
              toolsMatch &&
              configMatch

            if (isUnchanged) {
              unchanged++
            } else {
              // Merge config: preserve user-set fields, update catalog metadata
              const mergedConfig = { ...existingConfig, ...config }
              await tx.update(skills).set({
                version: skill.version,
                description: skill.description,
                instructions: skill.instructions,
                category: skill.category,
                tags: skill.tags,
                allowedTools: skill.allowedTools,
                config: mergedConfig,
                updatedAt: new Date(),
                // Do NOT update enabled — preserve user's toggle choice
              }).where(eq(skills.id, existing.id))
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
              source: 'catalog',
              sourceUrl: null,
              authorId: null,
              teamId: null,
              enabled: false, // Catalog skills start disabled — opt-in via collection toggle
              allowedTools: skill.allowedTools,
              config,
            })
            inserted++
          }
        } catch (e) {
          console.error(`[catalog] Failed to seed catalog skill: ${skill.name}`, e)
          throw e
        }
      }
    }
  })

  console.log(
    `[catalog] Catalog skills seeding complete: ${inserted} inserted, ${updated} updated, ${unchanged} unchanged`
  )
}

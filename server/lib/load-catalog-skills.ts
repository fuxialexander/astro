/**
 * Load Catalog Skill Collections from Disk
 *
 * Reads COLLECTION.yaml + SKILL.md files from the skills-catalog/ directory,
 * parses them into CatalogCollection objects.
 *
 * This is server-only code (uses fs/path).
 */

import { readdirSync, readFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseCollectionYaml } from '../../packages/core/src/skills/collection-parser.js'
import { parseBuiltinSkillMd } from '../../packages/core/src/skills/builtin-parser.js'
import type { CatalogCollection } from '../../packages/core/src/skills/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** Repo root (server/lib/ → repo root) */
const REPO_ROOT = join(__dirname, '..', '..')

/**
 * Load all catalog collections from skills-catalog/ directory.
 *
 * Structure expected:
 * ```
 * skills-catalog/
 *   anthropic/
 *     COLLECTION.yaml
 *     frontend-design/SKILL.md
 *     code-review/SKILL.md
 *     ...
 * ```
 */
export function loadCatalogCollectionsFromDisk(catalogDir?: string): CatalogCollection[] {
  const dir = catalogDir ?? join(REPO_ROOT, 'skills-catalog')

  let collectionDirs: string[]
  try {
    collectionDirs = readdirSync(dir)
  } catch {
    console.warn(`[catalog] Catalog directory not found: ${dir}`)
    return []
  }

  const collections: CatalogCollection[] = []

  for (const collectionDir of collectionDirs) {
    const collectionPath = join(dir, collectionDir)
    try {
      if (!statSync(collectionPath).isDirectory()) continue
    } catch {
      continue
    }

    // Parse COLLECTION.yaml manifest
    const manifestPath = join(collectionPath, 'COLLECTION.yaml')
    let manifestContent: string
    try {
      manifestContent = readFileSync(manifestPath, 'utf-8')
    } catch {
      console.warn(`[catalog] No COLLECTION.yaml in ${collectionDir}/ — skipping`)
      continue
    }

    const manifest = parseCollectionYaml(manifestContent, collectionDir)
    if (!manifest) {
      console.warn(`[catalog] Failed to parse COLLECTION.yaml in ${collectionDir}/`)
      continue
    }

    // Scan subdirectories for SKILL.md files
    const collection: CatalogCollection = { manifest, skills: [] }

    let skillDirs: string[]
    try {
      skillDirs = readdirSync(collectionPath)
    } catch {
      continue
    }

    for (const skillDir of skillDirs) {
      const skillDirPath = join(collectionPath, skillDir)
      try {
        if (!statSync(skillDirPath).isDirectory()) continue
      } catch {
        continue
      }

      const skillMdPath = join(skillDirPath, 'SKILL.md')
      let skillContent: string
      try {
        skillContent = readFileSync(skillMdPath, 'utf-8')
      } catch {
        continue
      }

      const skill = parseBuiltinSkillMd(skillContent)
      if (skill) {
        collection.skills.push(skill)
      } else {
        console.warn(`[catalog] Failed to parse SKILL.md in ${collectionDir}/${skillDir}/`)
      }
    }

    if (collection.skills.length > 0) {
      collections.push(collection)
      console.log(`[catalog] Loaded collection "${manifest.name}" (${collection.skills.length} skills)`)
    } else {
      console.warn(`[catalog] Collection "${manifest.name}" has no valid skills — skipping`)
    }
  }

  return collections
}

/**
 * Load Built-in Skills from Disk
 *
 * Reads SKILL.md files from the skills/ directory at the repo root,
 * parses them into BuiltinSkillDefinition objects using the builtin parser.
 *
 * This is server-only code (uses fs/path).
 */

import { readdirSync, readFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseBuiltinSkillMd } from '../../packages/core/src/skills/builtin-parser.js'
import type { BuiltinSkillDefinition } from '../../packages/core/src/skills/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** Repo root (server/lib/ → repo root) */
const REPO_ROOT = join(__dirname, '..', '..')

/**
 * Load all built-in skill definitions from skills/ directory.
 *
 * Scans `{repoRoot}/skills/` for subdirectories containing SKILL.md files.
 * Each SKILL.md is parsed into a BuiltinSkillDefinition.
 *
 * @param skillsDir - Override the skills directory path (defaults to `{repoRoot}/skills`)
 */
export function loadBuiltinSkillsFromDisk(skillsDir?: string): BuiltinSkillDefinition[] {
  const dir = skillsDir ?? join(REPO_ROOT, 'skills')

  try {
    readdirSync(dir)
  } catch {
    console.warn(`[skills] Skills directory not found: ${dir}`)
    return []
  }

  const loaded: BuiltinSkillDefinition[] = []

  function scanDir(scanPath: string, prefix: string) {
    let dirEntries: string[]
    try {
      dirEntries = readdirSync(scanPath)
    } catch {
      return
    }

    for (const entry of dirEntries) {
      const entryPath = join(scanPath, entry)
      try {
        if (!statSync(entryPath).isDirectory()) continue
      } catch {
        continue
      }

      const skillMdPath = join(entryPath, 'SKILL.md')
      let content: string | undefined
      try {
        content = readFileSync(skillMdPath, 'utf-8')
      } catch {
        // No SKILL.md — check if it's a group directory with subdirs
        scanDir(entryPath, `${prefix}${entry}/`)
        continue
      }

      const skill = parseBuiltinSkillMd(content)
      if (skill) {
        loaded.push(skill)
        console.log(`[skills] Loaded builtin skill: ${skill.name} (v${skill.version})`)
      } else {
        console.warn(`[skills] Failed to parse SKILL.md in ${prefix}${entry}/`)
      }
    }
  }

  scanDir(dir, '')
  return loaded
}

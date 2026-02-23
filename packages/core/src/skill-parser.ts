/**
 * Skill Parser (Shared, Pure)
 *
 * Parses SKILL.md files into OpenClawSkill objects.
 * No filesystem dependencies — works in browser, server, and Tauri.
 */

import type { OpenClawSkill } from './types/skill.js'

/**
 * Parse a SKILL.md file content string into an OpenClawSkill.
 *
 * Format:
 * ```
 * ---
 * name: skill-name
 * description: What it does
 * ...
 * ---
 *
 * Instructions body (markdown)
 * ```
 */
export function parseSkillMd(content: string, source: OpenClawSkill['source']): OpenClawSkill | null {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!fmMatch) return null

  const frontmatter = fmMatch[1]
  const instructions = fmMatch[2].trim()

  // Simple YAML-like key: value parser (no nested objects for the basics)
  const meta: Record<string, string> = {}
  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    if (key && value) meta[key] = value
  }

  if (!meta.name) return null

  return {
    name: meta.name,
    description: meta.description || '',
    instructions,
    userInvocable: meta.userInvocable !== 'false',
    disableModelInvocation: meta.disableModelInvocation === 'true',
    source,
    enabled: true,
  }
}

/**
 * Built-in Skill SKILL.md Parser
 *
 * Parses SKILL.md frontmatter + markdown body into BuiltinSkillDefinition.
 * Extends the basic parseSkillMd with support for version, category, tags,
 * and allowedTools fields used by built-in skills.
 *
 * Pure function — no filesystem dependencies.
 */

import type { BuiltinSkillDefinition, AllowedTool } from './types.js'

/**
 * Parse a simple YAML inline array like `[Bash, Read, Write]` into string[].
 * Returns empty array if the value is not in array format.
 */
function parseYamlArray(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  }
  return []
}

/**
 * Parse a SKILL.md file content into a BuiltinSkillDefinition.
 *
 * Expected format:
 * ```
 * ---
 * name: kubernetes-workflow
 * version: "1.0.0"
 * description: "When to use this skill..."
 * category: tools
 * tags: [kubernetes, k8s, cloud]
 * allowedTools: [Bash, Read, Write]
 * ---
 *
 * # Skill Instructions (markdown body)
 * ```
 */
export function parseBuiltinSkillMd(content: string): BuiltinSkillDefinition | null {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!fmMatch) return null

  const frontmatter = fmMatch[1]
  const instructions = fmMatch[2].trim()

  // Parse key: value pairs from frontmatter
  const meta: Record<string, string> = {}
  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    // Value is everything after the first colon, trimmed
    const value = line.slice(colonIdx + 1).trim()
    if (key && value) meta[key] = value
  }

  if (!meta.name) return null

  // Strip surrounding quotes from description (YAML allows quoted strings)
  const description = meta.description?.replace(/^["']|["']$/g, '') || ''
  const version = meta.version?.replace(/^["']|["']$/g, '') || '1.0.0'

  return {
    name: meta.name,
    version,
    description,
    instructions,
    category: (meta.category || 'tools') as BuiltinSkillDefinition['category'],
    tags: parseYamlArray(meta.tags || '[]'),
    allowedTools: parseYamlArray(meta.allowedTools || '[]') as AllowedTool[],
  }
}

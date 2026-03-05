/**
 * Skill Injector (Stateless)
 *
 * Pure function: takes an array of skills, returns XML prompt injection string.
 * No filesystem access, no state — suitable for any runtime.
 */

import type { OpenClawSkill } from './types/skill.js'

/**
 * Escape XML special characters in attribute values to prevent XML injection.
 * Skill names and descriptions are user-controlled and must be sanitized
 * before embedding in XML attributes.
 */
function escapeXmlAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Sanitize instruction content to prevent it from breaking the XML structure.
 * Replaces any closing </skill> tags that could prematurely end the block.
 */
function sanitizeInstructions(text: string): string {
  return text.replace(/<\/skill>/gi, '&lt;/skill&gt;')
}

/**
 * Filter skills eligible for prompt injection (enabled + not model-invocation-disabled)
 */
export function getEligibleSkills(skills: OpenClawSkill[]): OpenClawSkill[] {
  return skills.filter(s => s.enabled && !s.disableModelInvocation)
}

/**
 * Build XML prompt injection for eligible skills.
 * Receives skills as input — does not read from disk or manage state.
 * XML attributes are escaped to prevent injection via malicious skill names/descriptions.
 *
 * Skills are namespaced with "astro/" prefix to distinguish Astro platform skills
 * (cloud-stored, team-scoped, synced across devices) from local Claude Code skills
 * (stored in ~/.claude/skills/). This prevents name collisions when users have
 * both Astro skills and local skills with the same name.
 */
/** Maps compute backend IDs to skill tags */
export const BACKEND_SKILL_TAGS: Record<string, string[]> = {
  'k8s-exec': ['kubernetes', 'k8s'],
  'slurm': ['slurm', 'hpc'],
  'docker': ['docker', 'container'],
  'direct': [],
}

/** All tags that are backend-specific */
const ALL_BACKEND_TAGS = new Set(Object.values(BACKEND_SKILL_TAGS).flat())

/**
 * Filter skills by selected compute backends.
 * - undefined/empty → NO backend-specific skills (lean default)
 * - ["direct"] → only skills WITHOUT backend-specific tags
 * - ["k8s-exec"] → skills tagged kubernetes/k8s + non-backend skills
 * - ["k8s-exec", "slurm"] → union of both + non-backend skills
 */
export function filterSkillsByBackends(
  skills: OpenClawSkill[],
  selectedBackends?: string[]
): OpenClawSkill[] {
  if (!selectedBackends || selectedBackends.length === 0) {
    // No backends selected → exclude all backend-specific skills
    return skills.filter(s => {
      const tags = s.tags ?? []
      return !tags.some(t => ALL_BACKEND_TAGS.has(t))
    })
  }

  // Collect allowed tags from selected backends
  const allowedTags = new Set<string>()
  for (const backend of selectedBackends) {
    const tags = BACKEND_SKILL_TAGS[backend]
    if (tags) {
      for (const tag of tags) allowedTags.add(tag)
    }
  }

  return skills.filter(s => {
    const tags = s.tags ?? []
    const hasBackendTag = tags.some(t => ALL_BACKEND_TAGS.has(t))
    if (!hasBackendTag) return true // Non-backend skill → always include
    // Backend-specific skill → include only if at least one tag matches
    return tags.some(t => allowedTags.has(t))
  })
}

export function buildSkillPromptInjection(skills: OpenClawSkill[]): string {
  const eligible = getEligibleSkills(skills)
  if (eligible.length === 0) return ''

  const skillBlocks = eligible.map(
    s => `  <skill name="${escapeXmlAttr('astro/' + s.name)}" description="${escapeXmlAttr(s.description)}">\n${sanitizeInstructions(s.instructions)}\n  </skill>`
  )

  return `<skills>\n${skillBlocks.join('\n')}\n</skills>`
}

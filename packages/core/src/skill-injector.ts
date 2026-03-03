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
export function buildSkillPromptInjection(skills: OpenClawSkill[]): string {
  const eligible = getEligibleSkills(skills)
  if (eligible.length === 0) return ''

  const skillBlocks = eligible.map(
    s => `  <skill name="${escapeXmlAttr('astro/' + s.name)}" description="${escapeXmlAttr(s.description)}">\n${sanitizeInstructions(s.instructions)}\n  </skill>`
  )

  return `<skills>\n${skillBlocks.join('\n')}\n</skills>`
}

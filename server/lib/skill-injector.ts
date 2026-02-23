/**
 * Skill Injector (Stateless)
 *
 * Pure function: takes an array of skills, returns XML prompt injection string.
 * No filesystem access, no state — suitable for any runtime.
 */

import type { OpenClawSkill } from '../../src/types/skill.js'

/**
 * Filter skills eligible for prompt injection (enabled + not model-invocation-disabled)
 */
export function getEligibleSkills(skills: OpenClawSkill[]): OpenClawSkill[] {
  return skills.filter(s => s.enabled && !s.disableModelInvocation)
}

/**
 * Build XML prompt injection for eligible skills.
 * Receives skills as input — does not read from disk or manage state.
 */
export function buildSkillPromptInjection(skills: OpenClawSkill[]): string {
  const eligible = getEligibleSkills(skills)
  if (eligible.length === 0) return ''

  const skillBlocks = eligible.map(
    s => `  <skill name="${s.name}" description="${s.description}">\n${s.instructions}\n  </skill>`
  )

  return `<skills>\n${skillBlocks.join('\n')}\n</skills>`
}

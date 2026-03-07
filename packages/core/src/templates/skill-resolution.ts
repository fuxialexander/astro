/**
 * Skill Resolution for Use Case Templates
 *
 * Derives the effective skill list from a template's `recommendedSkills` and
 * `conditionalSkills` based on current parameter values.
 *
 * Used by the example-picker-dialog to determine which SKILL.md files to fetch
 * and include in the project's visionDoc.
 */

import type { UseCaseTemplate } from '../types/use-case-template.js'

/**
 * Derive the effective skill names for a template given current parameter values.
 *
 * Combines:
 * 1. `recommendedSkills` — always included
 * 2. `conditionalSkills` — included only when the referenced parameter matches a mapped value
 *
 * @returns Sorted, deduplicated array of skill names
 */
export function deriveEffectiveSkills(
  template: Pick<UseCaseTemplate, 'recommendedSkills' | 'conditionalSkills'> | null | undefined,
  parameterValues: Record<string, unknown>,
): string[] {
  if (!template) return []

  const names = new Set(template.recommendedSkills ?? [])

  if (template.conditionalSkills) {
    for (const [paramId, valueMap] of Object.entries(template.conditionalSkills)) {
      const paramValue = parameterValues[paramId]
      if (typeof paramValue === 'string' && valueMap[paramValue]) {
        for (const skill of valueMap[paramValue]) {
          names.add(skill)
        }
      }
    }
  }

  return Array.from(names).sort()
}

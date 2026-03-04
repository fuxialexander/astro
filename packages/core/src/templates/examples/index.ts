/**
 * Built-in Use Case Template Examples
 *
 * Curated example templates available to all Astro users.
 *
 * Note: Previous templates (web-app, ml-pipeline, etc.) remain on disk
 * but are not imported. They can be restored by re-adding their imports
 * and entries to BUILTIN_TEMPLATES.
 */

export { academicPresentationTemplate } from './academic-presentation.js'
export { academicReviewTemplate } from './academic-review.js'
export { moatFragilityTemplate } from './moat-fragility.js'

import { academicPresentationTemplate } from './academic-presentation.js'
import { academicReviewTemplate } from './academic-review.js'
import { moatFragilityTemplate } from './moat-fragility.js'
import type { UseCaseTemplate } from '../../types/use-case-template.js'

/** All built-in templates */
export const BUILTIN_TEMPLATES: UseCaseTemplate[] = [
  academicPresentationTemplate,
  academicReviewTemplate,
  moatFragilityTemplate,
]

/** Templates grouped by category */
export const TEMPLATES_BY_CATEGORY: Record<string, UseCaseTemplate[]> = {
  'research-analysis': [academicPresentationTemplate, academicReviewTemplate],
  'data-science': [moatFragilityTemplate],
}

/** Get a template by ID */
export function getTemplateById(id: string): UseCaseTemplate | undefined {
  return BUILTIN_TEMPLATES.find(t => t.id === id)
}

/** Get templates by category */
export function getTemplatesByCategory(category: string): UseCaseTemplate[] {
  return TEMPLATES_BY_CATEGORY[category] ?? []
}

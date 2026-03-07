/**
 * Built-in Use Case Template Examples
 *
 * Curated example templates available to all Astro users.
 *
 * Only the active 3 templates are maintained here.
 * Obsolete templates (web-app, ml-pipeline, etc.) have been removed.
 */

export { academicPresentationTemplate } from './academic-presentation.js'
export { academicReviewTemplate } from './academic-review.js'
export { moatFragilityTemplate } from './moat-fragility.js'

import { academicPresentationTemplate } from './academic-presentation.js'
import { academicReviewTemplate } from './academic-review.js'
import { moatFragilityTemplate } from './moat-fragility.js'
import type { UseCaseTemplate } from '../../types/use-case-template.js'

/** All built-in templates/examples */
export const BUILTIN_TEMPLATES: UseCaseTemplate[] = [
  academicPresentationTemplate,
  academicReviewTemplate,
  moatFragilityTemplate,
]

/** Templates/examples grouped by category */
export const TEMPLATES_BY_CATEGORY: Record<string, UseCaseTemplate[]> = {
  'research-analysis': [academicPresentationTemplate, academicReviewTemplate],
  'data-science': [moatFragilityTemplate],
}

/** Get a template/example by ID */
export function getTemplateById(id: string): UseCaseTemplate | undefined {
  return BUILTIN_TEMPLATES.find(t => t.id === id)
}

/** Get templates/examples by category */
export function getTemplatesByCategory(category: string): UseCaseTemplate[] {
  return TEMPLATES_BY_CATEGORY[category] ?? []
}

// ── Example Aliases (UI uses "Examples") ─────────────────────────

/** Alias for BUILTIN_TEMPLATES — the UI calls these "Examples" */
export const BUILTIN_EXAMPLES = BUILTIN_TEMPLATES

/** Alias for TEMPLATES_BY_CATEGORY */
export const EXAMPLES_BY_CATEGORY = TEMPLATES_BY_CATEGORY

/** Alias for getTemplateById */
export const getExampleById = getTemplateById

/** Alias for getTemplatesByCategory */
export const getExamplesByCategory = getTemplatesByCategory

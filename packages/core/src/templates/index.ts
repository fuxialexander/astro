/**
 * Builtin Use Case Templates
 *
 * This module exports all built-in templates shipped with Astro.
 * Templates define reusable planning patterns for common workflows.
 *
 * To add a new builtin template:
 * 1. Create a new file in this directory (e.g., `my-template.ts`)
 * 2. Export a `UseCaseTemplate` constant from it
 * 3. Import and add it to the `builtinTemplates` array below
 * 4. Re-export the template from this index file
 */

import type { UseCaseTemplate } from '../types/use-case-template.js'
import { paperToSlidesTemplate } from './paper-to-slides.js'

// ── Re-exports ──────────────────────────────────────────────────────────
export { paperToSlidesTemplate } from './paper-to-slides.js'

// ── All builtin templates ───────────────────────────────────────────────

/**
 * Registry of all built-in templates.
 * Used by the template picker UI and the plan generation API.
 */
export const builtinTemplates: UseCaseTemplate[] = [
  paperToSlidesTemplate,
]

/**
 * Look up a builtin template by slug.
 *
 * @param slug - Template slug (e.g., 'paper-to-slides')
 * @returns The template, or undefined if not found
 */
export function getBuiltinTemplate(slug: string): UseCaseTemplate | undefined {
  return builtinTemplates.find((t) => t.slug === slug)
}

/**
 * Look up a builtin template by ID.
 *
 * @param id - Template ID (e.g., 'builtin-paper-to-slides')
 * @returns The template, or undefined if not found
 */
export function getBuiltinTemplateById(id: string): UseCaseTemplate | undefined {
  return builtinTemplates.find((t) => t.id === id)
}

/**
 * Built-in skill definitions for seeding and prompt injection.
 *
 * Each skill is a complete definition extracted from SKILL.md files,
 * containing the full instructions, metadata, and tool allowlists.
 */

export type { BuiltinSkillDefinition } from './types.js'

export { KUBERNETES_WORKFLOW } from './kubernetes-workflow.js'
export { SKYPILOT_WORKFLOW } from './skypilot-workflow.js'

import { KUBERNETES_WORKFLOW } from './kubernetes-workflow.js'
import { SKYPILOT_WORKFLOW } from './skypilot-workflow.js'
import type { BuiltinSkillDefinition } from './types.js'

/** All built-in skill definitions, for seeding or iteration */
export const BUILTIN_SKILLS: BuiltinSkillDefinition[] = [
  KUBERNETES_WORKFLOW,
  SKYPILOT_WORKFLOW,
]

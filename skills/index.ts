/**
 * Built-in Skills
 *
 * This module exports built-in skill definitions that can be used for seeding
 * the skills database or injecting into agent prompts.
 *
 * Note: `astro-plan-bridge/` is intentionally NOT included in `builtinSkills`.
 * It's a SKILL.md-format definition that requires per-user configuration
 * (ASTRO_SERVER_URL, ASTRO_AUTH_TOKEN) and is installed via the "Paste SKILL.md"
 * flow in the skill settings UI, not auto-seeded on server startup.
 */

// Types
export * from './types.js'

// Individual skills
export { kubernetesWorkflowSkill } from './kubernetes-workflow/index.js'
export { skypilotWorkflowSkill } from './skypilot-workflow/index.js'

// All built-in skills as an array (useful for seeding)
import { kubernetesWorkflowSkill } from './kubernetes-workflow/index.js'
import { skypilotWorkflowSkill } from './skypilot-workflow/index.js'
import type { BuiltinSkillDefinition } from './types.js'

export const builtinSkills: BuiltinSkillDefinition[] = [
  kubernetesWorkflowSkill,
  skypilotWorkflowSkill,
]

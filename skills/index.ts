/**
 * Built-in Skills
 *
 * This module exports built-in skill definitions that can be used for seeding
 * the skills database or injecting into agent prompts.
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

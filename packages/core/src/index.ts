// @astro/core — Pure TypeScript library
// No HTTP, no UI, no filesystem (except DB layer which uses Node APIs)

// Types
export * from './types.js'
export * from './types/skill.js'
export * from './types/github.js'
export * from './types/relay.js'
export * from './types/device-auth.js'

// Utilities
export * from './error-utils.js'
export * from './bibtex-writer.js'
export * from './bibtex-parser.js'
export {
  convertToSshUrl,
  convertToHttpsUrl,
  validateGitUrl,
  detectRemoteType,
  urlsMatchSameRepo,
  extractRepoInfo,
} from './git-url-utils.js'
export type { GitUrlValidation } from './git-url-utils.js'
export { isLocalMode } from './app-mode.js'
export { parseSkillMd } from './skill-parser.js'
export { getEligibleSkills, buildSkillPromptInjection } from './skill-injector.js'
export * from './prompt-templates.js'
export { extractPlanJsonFromText } from './plan-extraction.js'
export type { PlanJsonResult } from './plan-extraction.js'
export { BUILTIN_TEMPLATE_IDS, BUILTIN_TEMPLATES, BUILTIN_EXAMPLES } from './templates/index.js'
// Built-in skills
export * from './skills/index.js'

// Transport-agnostic command layer
export * as commands from './commands/index.js'

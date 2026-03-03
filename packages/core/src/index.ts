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

// Built-in skills — definitions live at repo root (skills/) for co-location with SKILL.md files.
// The relative import is required for tsx runtime resolution; @skills alias handles tsc type checking.
export * from '../../../skills/index.js' // @skills

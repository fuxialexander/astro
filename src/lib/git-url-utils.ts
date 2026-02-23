/**
 * Git URL utilities (frontend)
 *
 * Re-exports from @astro/core for backward compatibility.
 */
export {
  convertToSshUrl,
  convertToHttpsUrl,
  validateGitUrl,
  extractRepoInfo,
} from '@astro/core/git-url-utils'

export type { GitUrlValidation } from '@astro/core/git-url-utils'

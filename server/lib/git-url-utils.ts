/**
 * Git URL utilities (server-side)
 *
 * Re-exports from @astro/core for backward compatibility.
 */
export {
  convertToSshUrl,
  convertToHttpsUrl,
  validateGitUrl,
  detectRemoteType,
  urlsMatchSameRepo,
  extractRepoInfo,
} from '../../packages/core/src/git-url-utils.js'

export type { GitUrlValidation, RemoteType } from '../../packages/core/src/git-url-utils.js'

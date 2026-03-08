/**
 * Project Source Utilities
 *
 * Helper functions for working with the structured ProjectSource model.
 * Used throughout the frontend to resolve source info from legacy fields,
 * detect remote types, and derive delivery modes.
 */

import type { Project, ProjectSource, DeliveryMode, RemoteType } from '@/types'

/** @deprecated Use ProjectSource without 'type' field. Kept for backward compat. */
export type SourceType = 'local-git' | 'cloned-git' | 'local-dir'

/**
 * Extract GitHub owner and repo from a git remote URL.
 * Supports HTTPS, SSH, and shorthand formats:
 *   - https://github.com/owner/repo.git
 *   - git@github.com:owner/repo.git
 *   - ssh://git@github.com/owner/repo
 * Returns null if the URL is not a GitHub URL or can't be parsed.
 */
export function extractGitHubOwnerRepo(url: string | undefined): { owner: string; repo: string } | null {
  if (!url) return null
  const normalized = url.trim().replace(/\.git\/?$/, '').replace(/\/+$/, '')
  // SSH: git@github.com:owner/repo
  const sshMatch = normalized.match(/git@github\.com:([^/]+)\/([^/]+)$/i)
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] }
  // HTTPS / SSH protocol: https://github.com/owner/repo or ssh://git@github.com/owner/repo
  const httpsMatch = normalized.match(/github\.com\/([^/]+)\/([^/]+)$/i)
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] }
  return null
}

/**
 * Detect the remote type from a git URL.
 */
export function detectRemoteType(url: string | undefined): RemoteType {
  if (!url) return 'none'
  const lower = url.toLowerCase()
  if (lower.includes('github.com')) return 'github'
  // Match gitlab.com and self-hosted GitLab instances (gitlab.company.com)
  if (lower.includes('gitlab.com') || lower.includes('gitlab.')) return 'gitlab'
  if (lower.includes('bitbucket.org') || lower.includes('bitbucket.')) return 'bitbucket'
  // Has a URL but doesn't match known forges
  if (lower.startsWith('git@') || lower.startsWith('http') || lower.startsWith('ssh://')) return 'generic'
  return 'none'
}

/**
 * Derive the delivery mode from a ProjectSource.
 *
 * - Git repo with GitHub/GitLab/Bitbucket remote → 'pr'
 * - Git repo with generic remote → 'push'
 * - Git repo with no remote → 'branch'
 * - Non-git directory → 'direct'
 */
export function deriveDeliveryMode(source: ProjectSource): DeliveryMode {
  if (!source.isGit) return 'direct'
  switch (source.remoteType) {
    case 'github':
    case 'gitlab':
    case 'bitbucket':
      return 'pr'
    case 'generic':
      return 'push'
    case 'none':
    default:
      return 'branch'
  }
}

/**
 * Resolve a ProjectSource from a Project's legacy fields.
 * Used when project.source is undefined (backward compatibility).
 */
export function resolveProjectSource(project: Project): ProjectSource | undefined {
  // If source is already populated, return it
  if (project.source) return project.source

  const localPath = project.workingDirectory
  if (!localPath) return undefined

  const remoteUrl = project.repository || undefined
  const remoteType = detectRemoteType(remoteUrl)
  const isGit = !!remoteUrl || remoteType !== 'none'

  return {
    localPath,
    remoteUrl,
    remoteType,
    baseBranch: 'main',
    isGit,
  }
}

/**
 * Normalize a git URL for comparison (strip protocol, trailing .git, trailing slashes).
 */
function normalizeGitUrl(url: string): string {
  let normalized = url.trim().toLowerCase()
  // Remove trailing .git
  normalized = normalized.replace(/\.git$/, '')
  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, '')
  // Convert SSH to a canonical form: git@host:path → host/path
  const sshMatch = normalized.match(/^git@([^:]+):(.+)$/)
  if (sshMatch) {
    normalized = `${sshMatch[1]}/${sshMatch[2]}`
  }
  // Strip protocol prefix
  normalized = normalized.replace(/^(https?:\/\/|ssh:\/\/)/, '')
  // Strip auth info (user@)
  normalized = normalized.replace(/^[^@]+@/, '')
  return normalized
}

/**
 * Check if two git URLs refer to the same repository.
 */
export function urlsMatchSameRepo(url1: string, url2: string): boolean {
  return normalizeGitUrl(url1) === normalizeGitUrl(url2)
}

/**
 * Get a human-readable label for a delivery mode.
 */
export function deliveryModeLabel(mode: DeliveryMode): string {
  switch (mode) {
    case 'pr': return 'Pull Request'
    case 'push': return 'Push to Remote'
    case 'branch': return 'Local Branch'
    case 'copy': return 'Copy to Worktree'
    case 'direct': return 'Direct (in-place)'
  }
}

/**
 * Get a human-readable label for a remote type.
 */
export function remoteTypeLabel(type: RemoteType): string {
  switch (type) {
    case 'github': return 'GitHub'
    case 'gitlab': return 'GitLab'
    case 'bitbucket': return 'Bitbucket'
    case 'generic': return 'Git Remote'
    case 'none': return 'No Remote'
  }
}

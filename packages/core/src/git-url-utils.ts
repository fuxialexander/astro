/**
 * Git URL utilities for converting between HTTPS and SSH formats
 */

export interface GitUrlValidation {
  isValid: boolean;
  error?: string;
  sshUrl?: string;
  httpsUrl?: string;
}

/**
 * Convert GitHub HTTPS URL to SSH format
 * Example: https://github.com/user/repo.git -> git@github.com:user/repo.git
 */
export function convertToSshUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;

  const trimmed = url.trim();

  // Already SSH format
  if (trimmed.startsWith('git@')) {
    return trimmed;
  }

  // HTTPS format - extract owner/repo
  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?$/);
  if (httpsMatch) {
    const owner = httpsMatch[1];
    const repo = httpsMatch[2];
    return `git@github.com:${owner}/${repo}.git`;
  }

  return null;
}

/**
 * Convert GitHub SSH URL to HTTPS format
 * Example: git@github.com:user/repo.git -> https://github.com/user/repo.git
 */
export function convertToHttpsUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;

  const trimmed = url.trim();

  // Already HTTPS format
  if (trimmed.startsWith('http')) {
    return trimmed;
  }

  // SSH format - extract owner/repo
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(\.git)?$/);
  if (sshMatch) {
    const owner = sshMatch[1];
    const repo = sshMatch[2];
    return `https://github.com/${owner}/${repo}.git`;
  }

  return null;
}

/**
 * Validate Git URL (supports SSH + HTTPS for any git host)
 */
export function validateGitUrl(url: string): GitUrlValidation {
  if (!url || typeof url !== 'string') {
    return { isValid: false, error: 'URL is required' };
  }

  const trimmed = url.trim();

  // SSH format: git@host:user/repo.git
  const isSsh = /^git@[^:]+:.+/.test(trimmed);
  // HTTPS format: https://host/user/repo.git (or without .git)
  const isHttps = /^https?:\/\/.+\/.+/.test(trimmed);
  // SSH protocol: ssh://git@host/user/repo.git
  const isSshProtocol = /^ssh:\/\/.+/.test(trimmed);

  if (!isSsh && !isHttps && !isSshProtocol) {
    return {
      isValid: false,
      error: 'Invalid Git URL format. Expected: git@host:user/repo.git, https://host/user/repo.git, or ssh://git@host/user/repo.git',
    };
  }

  // For GitHub URLs, provide SSH conversion
  let sshUrl: string | undefined = isSsh ? trimmed : undefined;
  let httpsUrl: string | undefined = isHttps ? trimmed : undefined;

  if (!sshUrl && isHttps) {
    sshUrl = convertToSshUrl(trimmed) || undefined;
  }
  if (!httpsUrl && isSsh) {
    httpsUrl = convertToHttpsUrl(trimmed) || undefined;
  }

  return {
    isValid: true,
    sshUrl: sshUrl || trimmed,
    httpsUrl: httpsUrl || undefined,
  };
}

export type RemoteType = 'github' | 'gitlab' | 'bitbucket' | 'generic' | 'none'

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
  if (lower.startsWith('git@') || lower.startsWith('http') || lower.startsWith('ssh://')) return 'generic'
  return 'none'
}

/**
 * Normalize a git URL for comparison (strip protocol, trailing .git, trailing slashes).
 */
function normalizeGitUrl(url: string): string {
  let normalized = url.trim().toLowerCase()
  normalized = normalized.replace(/\.git$/, '')
  normalized = normalized.replace(/\/+$/, '')
  const sshMatch = normalized.match(/^git@([^:]+):(.+)$/)
  if (sshMatch) {
    normalized = `${sshMatch[1]}/${sshMatch[2]}`
  }
  normalized = normalized.replace(/^(https?:\/\/|ssh:\/\/)/, '')
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
 * Extract owner/repo from GitHub URL (any format).
 * Supports HTTPS, SSH shorthand, and ssh:// protocol:
 *   - https://github.com/owner/repo.git
 *   - git@github.com:owner/repo.git
 *   - ssh://git@github.com/owner/repo.git
 * Returns null if the URL is not a GitHub URL or can't be parsed.
 */
export function extractRepoInfo(url: string | undefined): { owner: string; repo: string } | null {
  if (!url || typeof url !== 'string') return null;

  const trimmed = url.trim().replace(/\.git\/?$/, '').replace(/\/+$/, '');

  // SSH shorthand: git@github.com:owner/repo
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  // HTTPS: https://github.com/owner/repo
  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  // SSH protocol: ssh://git@github.com/owner/repo (or ssh://github.com/owner/repo)
  const sshProtoMatch = trimmed.match(/^ssh:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/]+)$/i);
  if (sshProtoMatch) return { owner: sshProtoMatch[1], repo: sshProtoMatch[2] };

  return null;
}

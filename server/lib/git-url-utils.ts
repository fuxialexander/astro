/**
 * Git URL utilities for converting between HTTPS and SSH formats (server-side)
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
 * Validate Git URL and ensure it's in SSH format
 */
export function validateGitUrl(url: string): GitUrlValidation {
  if (!url || typeof url !== 'string') {
    return { isValid: false, error: 'URL is required' };
  }

  const trimmed = url.trim();

  // Check if it's a valid GitHub URL (SSH or HTTPS)
  const isSsh = /^git@github\.com:[^/]+\/[^/]+\.git$/.test(trimmed);
  const isHttps = /^https?:\/\/github\.com\/[^/]+\/[^/]+\.git$/.test(trimmed);

  if (!isSsh && !isHttps) {
    return {
      isValid: false,
      error: 'Invalid GitHub URL format. Expected: git@github.com:user/repo.git or https://github.com/user/repo.git',
    };
  }

  // Convert to SSH if HTTPS
  const sshUrl = isSsh ? trimmed : convertToSshUrl(trimmed);
  const httpsUrl = isHttps ? trimmed : convertToHttpsUrl(trimmed);

  if (!sshUrl) {
    return {
      isValid: false,
      error: 'Failed to convert URL to SSH format',
    };
  }

  return {
    isValid: true,
    sshUrl,
    httpsUrl: httpsUrl || undefined,
  };
}

/**
 * Extract owner/repo from GitHub URL (any format)
 */
export function extractRepoInfo(url: string): { owner: string; repo: string } | null {
  if (!url || typeof url !== 'string') return null;

  const trimmed = url.trim();

  // SSH format
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2].replace(/\.git$/, '') };
  }

  // HTTPS format
  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2].replace(/\.git$/, '') };
  }

  return null;
}

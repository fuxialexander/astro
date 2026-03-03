/**
 * GitHub SKILL.md import utilities
 *
 * Fetches and parses SKILL.md files from GitHub repositories.
 * Supports multiple URL formats including subfolder paths for skill collections.
 */

import { parseSkillMd } from '@astro/core/skill-parser'
import type { OpenClawSkill } from '@astro/core/types/skill'

interface ParsedGitHubUrl {
  owner: string
  repo: string
  branch?: string
  path?: string
  isDirectFile?: boolean
}

/**
 * Parse GitHub URL to extract owner, repo, branch, and optional subfolder path.
 *
 * Supported formats:
 * 1. Root repository:
 *    - https://github.com/owner/repo
 *    - github.com/owner/repo
 *    - owner/repo
 *
 * 2. Subfolder (tree URL):
 *    - https://github.com/owner/repo/tree/main/path/to/folder
 *    - https://github.com/owner/repo/tree/master/skill-name
 *
 * 3. Direct SKILL.md file (blob URL):
 *    - https://github.com/owner/repo/blob/main/path/to/SKILL.md
 *
 * 4. Shorthand with path:
 *    - owner/repo/path/to/folder
 *
 * This enables importing from skill collections like:
 * - ComposioHQ/awesome-claude-skills/mcp-builder
 * - sickn33/antigravity-awesome-skills/skills/agent-memory-mcp
 */
export function parseGitHubUrl(repoUrl: string): ParsedGitHubUrl {
  // Remove trailing slashes and .git extension
  let normalized = repoUrl.trim().replace(/\/+$/, '').replace(/\.git$/, '')

  // Remove protocol if present
  normalized = normalized.replace(/^https?:\/\//, '')

  // Remove github.com prefix if present
  normalized = normalized.replace(/^github\.com\//, '')

  // Split into parts
  const parts = normalized.split('/')
  if (parts.length < 2) {
    throw new Error(
      `Invalid GitHub URL format. Expected "owner/repo" or "https://github.com/owner/repo", got "${repoUrl}"`
    )
  }

  const [owner, repo] = parts
  if (!owner || !repo) {
    throw new Error(`Invalid GitHub URL: owner or repo is empty in "${repoUrl}"`)
  }

  // Check for tree/blob patterns with branch: owner/repo/tree|blob/branch/path
  if (parts.length >= 4 && (parts[2] === 'tree' || parts[2] === 'blob')) {
    const urlType = parts[2]
    const branch = parts[3]
    const pathParts = parts.slice(4)
    const path = pathParts.length > 0 ? pathParts.join('/') : undefined

    // Check if it's a direct SKILL.md file link
    const isDirectFile = urlType === 'blob' && path?.endsWith('SKILL.md')

    return {
      owner,
      repo,
      branch,
      path: isDirectFile && path ? path.replace(/\/SKILL\.md$/, '') || undefined : path,
      isDirectFile,
    }
  }

  // Check for shorthand path format: owner/repo/path/to/folder
  if (parts.length > 2) {
    const path = parts.slice(2).join('/')
    return { owner, repo, path }
  }

  return { owner, repo }
}

/**
 * Construct the raw GitHub URL for a SKILL.md file.
 */
function buildRawUrl(owner: string, repo: string, branch: string, path?: string): string {
  const pathPrefix = path ? `${path}/` : ''
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pathPrefix}SKILL.md`
}

/**
 * Get a human-readable location string for error messages.
 */
function getLocationString(owner: string, repo: string, path?: string): string {
  if (path) {
    return `${owner}/${repo}/${path}`
  }
  return `${owner}/${repo}`
}

/**
 * Fetch SKILL.md from a GitHub repository or subfolder.
 *
 * Supports multiple URL formats:
 * - Repository root: https://github.com/owner/repo or owner/repo
 * - Subfolder (tree): https://github.com/owner/repo/tree/main/skill-folder
 * - Direct file (blob): https://github.com/owner/repo/blob/main/skill-folder/SKILL.md
 * - Shorthand with path: owner/repo/skill-folder
 *
 * When no branch is specified in the URL, tries main branch first, then falls back to master.
 *
 * @param repoUrl - GitHub URL pointing to a repository, folder, or SKILL.md file
 * @returns Parsed OpenClawSkill object
 * @throws Error if fetch fails, SKILL.md not found, or parsing fails
 */
export async function fetchSkillFromGitHub(repoUrl: string): Promise<OpenClawSkill> {
  const { owner, repo, branch: explicitBranch, path } = parseGitHubUrl(repoUrl)
  const location = getLocationString(owner, repo, path)

  let response: Response
  let branch = explicitBranch || 'main'

  try {
    // If branch is explicitly specified, only try that branch
    if (explicitBranch) {
      const url = buildRawUrl(owner, repo, explicitBranch, path)
      response = await fetch(url)

      if (response.status === 404) {
        throw new Error(
          `SKILL.md not found at ${location} (${explicitBranch} branch). ` +
            `Make sure the path points to a folder containing a SKILL.md file.`
        )
      }
    } else {
      // Try main branch first
      const mainUrl = buildRawUrl(owner, repo, 'main', path)
      response = await fetch(mainUrl)

      // If main branch returns 404, try master branch
      if (response.status === 404) {
        const masterUrl = buildRawUrl(owner, repo, 'master', path)
        response = await fetch(masterUrl)
        branch = 'master'
      }

      // If still 404, SKILL.md doesn't exist
      if (response.status === 404) {
        const hint = path
          ? `Make sure the path points to a folder containing a SKILL.md file.`
          : `The repository root doesn't contain a SKILL.md. For skill collections, specify the path to a specific skill folder (e.g., owner/repo/skill-name).`
        throw new Error(
          `SKILL.md not found at ${location}. Checked both main and master branches. ${hint}`
        )
      }
    }

    // Handle other HTTP errors
    if (!response.ok) {
      throw new Error(
        `Failed to fetch SKILL.md from ${location} (${branch} branch): ` +
          `${response.status} ${response.statusText}`
      )
    }
  } catch (error) {
    // Handle network errors
    if (error instanceof TypeError) {
      throw new Error(
        `Network error while fetching SKILL.md from ${location}: ${error.message}`
      )
    }
    throw error
  }

  // Parse response text
  let content: string
  try {
    content = await response.text()
  } catch (error) {
    throw new Error(
      `Failed to read SKILL.md content from ${location}: ` +
        `${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  // Parse SKILL.md content
  const skill = parseSkillMd(content, 'user')

  if (!skill) {
    throw new Error(
      `Failed to parse SKILL.md from ${location}. ` +
        `The file must follow the OpenClaw SKILL.md format with YAML frontmatter and markdown body.`
    )
  }

  // Build homepage URL - include path if specified
  const homepage = path
    ? `https://github.com/${owner}/${repo}/tree/${branch}/${path}`
    : `https://github.com/${owner}/${repo}`

  // Add GitHub metadata to the skill
  return {
    ...skill,
    homepage,
    config: {
      ...skill.config,
      githubRepo: `${owner}/${repo}`,
      githubBranch: branch,
      ...(path && { githubPath: path }),
    },
  }
}

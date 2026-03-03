/**
 * GitHub SKILL.md import utilities
 *
 * Fetches and parses SKILL.md files from GitHub repositories.
 */

import { parseSkillMd } from '@astro/core/skill-parser'
import type { OpenClawSkill } from '@astro/core/types/skill'

interface ParsedGitHubUrl {
  owner: string
  repo: string
}

/**
 * Parse GitHub repository URL to extract owner and repo.
 * Handles both full URLs and shorthand formats:
 * - https://github.com/owner/repo
 * - github.com/owner/repo
 * - owner/repo
 */
function parseGitHubUrl(repoUrl: string): ParsedGitHubUrl {
  // Remove trailing slashes and .git extension
  let normalized = repoUrl.trim().replace(/\/+$/, '').replace(/\.git$/, '')

  // Remove protocol if present
  normalized = normalized.replace(/^https?:\/\//, '')

  // Remove github.com prefix if present
  normalized = normalized.replace(/^github\.com\//, '')

  // Split into owner/repo
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

  return { owner, repo }
}

/**
 * Fetch SKILL.md from a GitHub repository.
 *
 * Tries main branch first, then falls back to master branch if not found.
 *
 * @param repoUrl - GitHub repository URL (e.g., "owner/repo" or "https://github.com/owner/repo")
 * @returns Parsed OpenClawSkill object
 * @throws Error if fetch fails, SKILL.md not found, or parsing fails
 */
export async function fetchSkillFromGitHub(repoUrl: string): Promise<OpenClawSkill> {
  const { owner, repo } = parseGitHubUrl(repoUrl)

  // Try main branch first
  const mainUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/SKILL.md`
  let response: Response
  let branch = 'main'

  try {
    response = await fetch(mainUrl)

    // If main branch returns 404, try master branch
    if (response.status === 404) {
      const masterUrl = `https://raw.githubusercontent.com/${owner}/${repo}/master/SKILL.md`
      response = await fetch(masterUrl)
      branch = 'master'
    }

    // If still 404, SKILL.md doesn't exist
    if (response.status === 404) {
      throw new Error(
        `SKILL.md not found in repository ${owner}/${repo}. ` +
          `Checked both main and master branches.`
      )
    }

    // Handle other HTTP errors
    if (!response.ok) {
      throw new Error(
        `Failed to fetch SKILL.md from ${owner}/${repo} (${branch} branch): ` +
          `${response.status} ${response.statusText}`
      )
    }
  } catch (error) {
    // Handle network errors
    if (error instanceof TypeError) {
      throw new Error(
        `Network error while fetching SKILL.md from ${owner}/${repo}: ${error.message}`
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
      `Failed to read SKILL.md content from ${owner}/${repo}: ` +
        `${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  // Parse SKILL.md content
  const skill = parseSkillMd(content, 'user')

  if (!skill) {
    throw new Error(
      `Failed to parse SKILL.md from ${owner}/${repo}. ` +
        `The file must follow the OpenClaw SKILL.md format with YAML frontmatter and markdown body.`
    )
  }

  // Add GitHub metadata to the skill
  return {
    ...skill,
    homepage: `https://github.com/${owner}/${repo}`,
    config: {
      ...skill.config,
      githubRepo: `${owner}/${repo}`,
      githubBranch: branch,
    },
  }
}

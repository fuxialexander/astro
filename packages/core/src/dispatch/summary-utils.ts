/**
 * Summary Utilities
 *
 * Utilities for generating summaries of git changes and execution results.
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Default timeout for git commands (10 seconds) */
const DEFAULT_GIT_TIMEOUT = 10000

/**
 * Generate a markdown summary of git changes in a worktree
 *
 * Runs git commands to gather:
 * - File change summary (git diff --stat HEAD~1)
 * - Recent commits (git log --oneline -5)
 *
 * @param worktreePath - Path to the worktree directory
 * @param timeout - Timeout in milliseconds for git commands (default: 10000)
 * @returns Formatted markdown string with ## Changes and ## Commits sections, or null on error
 *
 * @example
 * ```typescript
 * const summary = generateGitDiffSummary('/path/to/worktree')
 * if (summary) {
 *   console.log(summary)
 *   // ## Changes
 *   //  src/index.ts | 10 +++++-----
 *   //  1 file changed, 5 insertions(+), 5 deletions(-)
 *   //
 *   // ## Commits
 *   // abc1234 feat: add new feature
 *   // def5678 fix: resolve bug
 * }
 * ```
 */
export function generateGitDiffSummary(
  worktreePath: string,
  timeout: number = DEFAULT_GIT_TIMEOUT
): string | null {
  // Validate input
  if (!worktreePath || typeof worktreePath !== 'string') {
    return null
  }

  // Check if path exists
  if (!existsSync(worktreePath)) {
    return null
  }

  // Check if it's a git repository
  const gitDir = join(worktreePath, '.git')
  // .git can be a file (for worktrees) or a directory
  if (!existsSync(gitDir)) {
    return null
  }

  let diffStat: string | null = null
  let commitLog: string | null = null

  // Get file change summary
  try {
    diffStat = execSync('git diff --stat HEAD~1', {
      cwd: worktreePath,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    // May fail if there's only one commit or no commits
    // Try getting diff against empty tree for initial commit
    try {
      diffStat = execSync('git diff --stat $(git rev-list --max-parents=0 HEAD)..HEAD', {
        cwd: worktreePath,
        encoding: 'utf-8',
        timeout,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: '/bin/sh',
      }).trim()
    } catch {
      // Still failed, leave as null
      diffStat = null
    }
  }

  // Get recent commits
  try {
    commitLog = execSync('git log --oneline -5', {
      cwd: worktreePath,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    // May fail if no commits exist
    commitLog = null
  }

  // If both failed, return null
  if (!diffStat && !commitLog) {
    return null
  }

  // Build markdown output
  const sections: string[] = []

  if (diffStat) {
    sections.push(`## Changes\n${diffStat}`)
  } else {
    sections.push('## Changes\nNo changes detected')
  }

  if (commitLog) {
    sections.push(`## Commits\n${commitLog}`)
  } else {
    sections.push('## Commits\nNo commits found')
  }

  return sections.join('\n\n')
}

/**
 * Options for git diff summary generation
 */
export interface GitDiffSummaryOptions {
  /** Timeout in milliseconds for git commands */
  timeout?: number
  /** Number of commits to include in log (default: 5) */
  commitCount?: number
  /** Base ref for diff (default: HEAD~1) */
  baseRef?: string
}

/**
 * Generate a git diff summary with configurable options
 *
 * @param worktreePath - Path to the worktree directory
 * @param options - Configuration options
 * @returns Formatted markdown string, or null on error
 */
export function generateGitDiffSummaryWithOptions(
  worktreePath: string,
  options: GitDiffSummaryOptions = {}
): string | null {
  const {
    timeout = DEFAULT_GIT_TIMEOUT,
    commitCount = 5,
    baseRef = 'HEAD~1',
  } = options

  // Validate input
  if (!worktreePath || typeof worktreePath !== 'string') {
    return null
  }

  // Check if path exists
  if (!existsSync(worktreePath)) {
    return null
  }

  // Check if it's a git repository
  const gitDir = join(worktreePath, '.git')
  if (!existsSync(gitDir)) {
    return null
  }

  let diffStat: string | null = null
  let commitLog: string | null = null

  // Get file change summary
  try {
    diffStat = execSync(`git diff --stat ${baseRef}`, {
      cwd: worktreePath,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    // Try fallback for initial commit scenario
    try {
      diffStat = execSync('git diff --stat $(git rev-list --max-parents=0 HEAD)..HEAD', {
        cwd: worktreePath,
        encoding: 'utf-8',
        timeout,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: '/bin/sh',
      }).trim()
    } catch {
      diffStat = null
    }
  }

  // Get recent commits
  try {
    commitLog = execSync(`git log --oneline -${commitCount}`, {
      cwd: worktreePath,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    commitLog = null
  }

  // If both failed, return null
  if (!diffStat && !commitLog) {
    return null
  }

  // Build markdown output
  const sections: string[] = []

  if (diffStat) {
    sections.push(`## Changes\n${diffStat}`)
  } else {
    sections.push('## Changes\nNo changes detected')
  }

  if (commitLog) {
    sections.push(`## Commits\n${commitLog}`)
  } else {
    sections.push('## Commits\nNo commits found')
  }

  return sections.join('\n\n')
}

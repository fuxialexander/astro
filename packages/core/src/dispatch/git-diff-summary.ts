/**
 * Git diff summary generation for worktrees.
 *
 * SERVER-ONLY: This module uses child_process and must not be imported
 * from browser code. It is intentionally NOT exported from the main
 * dispatch index.ts to prevent Vite from bundling it for the browser.
 *
 * Import directly when needed in server code:
 *   import { generateGitDiffSummary } from '@astro/core/dispatch/git-diff-summary'
 */

import { execSync } from 'child_process'

/** Default timeout for git commands (ms) */
const GIT_COMMAND_TIMEOUT_MS = 10_000

/**
 * Generate a markdown summary of git changes in a worktree.
 *
 * Runs git commands to collect:
 * - File change statistics (git diff --stat HEAD~1)
 * - Recent commit history (git log --oneline -5)
 *
 * Returns a formatted markdown string with ## Changes and ## Commits sections.
 * Handles errors gracefully (no commits, not a git repo, etc.) by returning null.
 *
 * @param worktreePath - Absolute path to the git worktree directory
 * @returns Formatted markdown string, or null on error
 *
 * @example
 * ```ts
 * const summary = generateGitDiffSummary('/path/to/worktree')
 * if (summary) {
 *   console.log(summary)
 *   // ## Changes
 *   //
 *   // ```
 *   //  src/index.ts | 10 +++++-----
 *   //  1 file changed, 5 insertions(+), 5 deletions(-)
 *   // ```
 *   //
 *   // ## Commits
 *   //
 *   // ```
 *   // abc1234 Fix bug in authentication
 *   // def5678 Add new feature
 *   // ...
 *   // ```
 * }
 * ```
 */
export function generateGitDiffSummary(worktreePath: string): string | null {
  if (!worktreePath || typeof worktreePath !== 'string') {
    return null
  }

  const execOptions: { cwd: string; encoding: 'utf-8'; timeout: number } = {
    cwd: worktreePath,
    encoding: 'utf-8',
    timeout: GIT_COMMAND_TIMEOUT_MS,
  }

  let diffStat: string | null = null
  let commitLog: string | null = null

  // Get file change statistics
  // git diff --stat HEAD~1 shows changes in the last commit
  try {
    const result = execSync('git diff --stat HEAD~1', execOptions)
    diffStat = result.trim()
  } catch {
    // This can fail if:
    // - Not a git repository
    // - No commits yet
    // - Only one commit (no HEAD~1)
    // - git not installed
    // Fall back to showing staged/unstaged changes
    try {
      const result = execSync('git diff --stat', execOptions)
      const staged = execSync('git diff --stat --staged', execOptions).trim()
      diffStat = result.trim()
      if (staged) {
        diffStat = diffStat ? `${diffStat}\n\n**Staged:**\n${staged}` : `**Staged:**\n${staged}`
      }
    } catch {
      // Still failed - likely not a git repo
      diffStat = null
    }
  }

  // Get recent commit history
  // git log --oneline -5 shows the last 5 commits in compact format
  try {
    const result = execSync('git log --oneline -5', execOptions)
    commitLog = result.trim()
  } catch {
    // This can fail if:
    // - Not a git repository
    // - No commits yet
    commitLog = null
  }

  // If both commands failed, return null (likely not a git repo or no commits)
  if (!diffStat && !commitLog) {
    return null
  }

  // Build markdown output
  const sections: string[] = []

  if (diffStat) {
    sections.push(`## Changes\n\n\`\`\`\n${diffStat}\n\`\`\``)
  } else {
    sections.push(`## Changes\n\n_No file changes detected._`)
  }

  if (commitLog) {
    sections.push(`## Commits\n\n\`\`\`\n${commitLog}\n\`\`\``)
  } else {
    sections.push(`## Commits\n\n_No commits found._`)
  }

  return sections.join('\n\n')
}

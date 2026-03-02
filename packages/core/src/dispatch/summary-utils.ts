/**
 * Summary Utilities
 *
 * Server-side utilities for:
 * - Parsing structured Executive Summary blocks from agent output text
 * - Generating git diff summaries for worktrees
 */

import { execSync } from 'child_process'

/**
 * Parsed result from an Executive Summary block.
 */
export interface ExecutiveSummaryParsed {
  status?: 'success' | 'partial' | 'failure'
  workCompleted?: string
  keyFindings?: string[]
  followUps?: string[]
}

/**
 * Parse an Executive Summary block from agent output text.
 */
export function parseExecutiveSummaryFromOutput(output: string): ExecutiveSummaryParsed | null {
  if (!output || typeof output !== 'string') {
    return null
  }

  const headerMatch = output.match(/#{2,3}\s*Executive\s+Summary\s*\n/i)
  if (!headerMatch) {
    return null
  }

  const startIndex = headerMatch.index! + headerMatch[0].length
  const remainder = output.slice(startIndex)

  const endMatch = remainder.match(/\n#{2,3}\s+[A-Z]|\n\x60\x60\x60|$/)
  const block = endMatch
    ? remainder.slice(0, endMatch.index !== undefined ? endMatch.index : remainder.length)
    : remainder

  const statusMatch = block.match(/\*\*Status:?\*\*:?\s*(success|partial|failure)/i)
  const whatMatch = block.match(/\*\*What\s+was\s+done:?\*\*:?\s*(.+?)(?:\n|$)/i)

  const lines = block.split('\n')
  const keyFindings: string[] = []
  const followUps: string[] = []

  let inFollowUps = false
  let pastWhatWasDone = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (/\*\*Follow-?ups?:?\*\*/i.test(trimmed)) {
      inFollowUps = true
      continue
    }
    if (/\*\*What\s+was\s+done:?\*\*:?\s*/i.test(trimmed)) {
      pastWhatWasDone = true
      inFollowUps = false
      continue
    }
    if (/\*\*Status:?\*\*/i.test(trimmed)) {
      inFollowUps = false
      continue
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/)
    if (bulletMatch) {
      const bulletText = bulletMatch[1].trim()
      if (!bulletText) continue

      if (inFollowUps) {
        followUps.push(bulletText)
      } else if (pastWhatWasDone) {
        keyFindings.push(bulletText)
      }
    }
  }

  const status = statusMatch?.[1]?.toLowerCase() as ExecutiveSummaryParsed['status']
  const workCompleted = whatMatch?.[1]?.trim()

  if (!status && !workCompleted && keyFindings.length === 0 && followUps.length === 0) {
    return null
  }

  const result: ExecutiveSummaryParsed = {}
  if (status) result.status = status
  if (workCompleted) result.workCompleted = workCompleted
  if (keyFindings.length > 0) result.keyFindings = keyFindings
  if (followUps.length > 0) result.followUps = followUps

  return result
}

/**
 * Check if an output string contains a valid Executive Summary block.
 */
export function hasExecutiveSummary(output: string): boolean {
  if (!output || typeof output !== 'string') {
    return false
  }
  return /#{2,3}\s*Executive\s+Summary\s*\n/i.test(output)
}

// ============================================================================
// Git Diff Summary Generation
// ============================================================================

const DEFAULT_GIT_TIMEOUT_MS = 10000

/**
 * Options for generating git diff summary
 */
export interface GitDiffSummaryOptions {
  timeout?: number
  commitCount?: number
}

/**
 * Generate a summary of git changes in a worktree.
 * 
 * Runs:
 * 1. git diff --stat HEAD~1 for file change summary
 * 2. git log --oneline -5 for recent commits
 * 
 * Returns formatted markdown with ## Changes and ## Commits sections.
 * Returns null on error (not a git repo, no commits, etc.)
 */
export function generateGitDiffSummary(
  worktreePath: string,
  options: GitDiffSummaryOptions = {}
): string | null {
  const timeout = options.timeout ?? DEFAULT_GIT_TIMEOUT_MS
  const commitCount = options.commitCount ?? 5

  try {
    // Check if the path is a git repository
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: worktreePath,
        timeout,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      return null
    }

    // Check if there are any commits
    let hasCommits = true
    try {
      execSync('git rev-parse HEAD', {
        cwd: worktreePath,
        timeout,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      hasCommits = false
    }

    if (!hasCommits) {
      return null
    }

    // Get file change summary (diff stat)
    let diffStat = ''
    try {
      execSync('git rev-parse HEAD~1', {
        cwd: worktreePath,
        timeout,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      diffStat = execSync('git diff --stat HEAD~1', {
        cwd: worktreePath,
        timeout,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    } catch {
      // Only one commit, show diff against empty tree
      diffStat = execSync('git diff --stat 4b825dc642cb6eb9a060e54bf8d69288fbee4904 HEAD', {
        cwd: worktreePath,
        timeout,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    }

    // Get recent commits
    let recentCommits = ''
    try {
      recentCommits = execSync('git log --oneline -' + commitCount, {
        cwd: worktreePath,
        timeout,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    } catch {
      recentCommits = ''
    }

    // Build markdown output
    const parts: string[] = []

    parts.push('## Changes')
    parts.push('')
    if (diffStat) {
      parts.push('\x60\x60\x60')
      parts.push(diffStat)
      parts.push('\x60\x60\x60')
    } else {
      parts.push('No file changes detected.')
    }

    parts.push('')
    parts.push('## Commits')
    parts.push('')
    if (recentCommits) {
      parts.push('\x60\x60\x60')
      parts.push(recentCommits)
      parts.push('\x60\x60\x60')
    } else {
      parts.push('No commits found.')
    }

    return parts.join('\n')
  } catch {
    return null
  }
}

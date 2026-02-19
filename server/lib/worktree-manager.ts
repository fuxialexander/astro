/**
 * Server-side worktree manager for local dispatch
 *
 * Creates isolated git worktrees for task execution and handles
 * PR creation after task completion.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const execFileAsync = promisify(execFile)

function withGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  }
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export interface ServerWorktreeSetup {
  worktreePath: string
  branchName: string
  cleanup: (options?: { keepBranch?: boolean }) => Promise<void>
}

/**
 * Create a worktree for server-side (local dispatch) task execution
 */
export async function createServerWorktree(options: {
  repoPath: string
  taskId: string
  nodeId: string
}): Promise<ServerWorktreeSetup | null> {
  const { repoPath, taskId, nodeId } = options
  const gitRoot = resolve(repoPath)

  // Verify it's a git repo with commits
  try {
    await execFileAsync('git', ['-C', gitRoot, 'rev-parse', '--verify', 'HEAD'], {
      env: withGitEnv(),
      timeout: 5_000,
    })
  } catch {
    return null
  }

  // Check for remote origin
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', gitRoot, 'remote', 'get-url', 'origin'],
      { env: withGitEnv(), timeout: 5_000 }
    )
    if (!stdout.trim()) return null
  } catch {
    return null
  }

  const repoName = sanitize(basename(gitRoot))
  const baseRoot = join(homedir(), '.astro', 'worktrees', repoName)
  await mkdir(baseRoot, { recursive: true })

  const branchName = `astro/${sanitize(nodeId)}`
  const worktreePath = join(baseRoot, sanitize(taskId))

  // Clean up any existing worktree at this path
  await rm(worktreePath, { recursive: true, force: true })

  // Prune stale worktrees
  try {
    await execFileAsync('git', ['-C', gitRoot, 'worktree', 'prune'], {
      env: withGitEnv(),
      timeout: 30_000,
    })
  } catch {
    // Ignore
  }

  // Delete branch if it already exists
  try {
    await execFileAsync('git', ['-C', gitRoot, 'branch', '-D', branchName], {
      env: withGitEnv(),
      timeout: 10_000,
    })
  } catch {
    // Branch didn't exist
  }

  // Create worktree
  await execFileAsync(
    'git',
    ['-C', gitRoot, 'worktree', 'add', '-b', branchName, worktreePath],
    { env: withGitEnv(), timeout: 30_000 }
  )

  return {
    worktreePath,
    branchName,
    cleanup: async (opts?: { keepBranch?: boolean }) => {
      // Remove worktree
      try {
        await execFileAsync(
          'git',
          ['-C', gitRoot, 'worktree', 'remove', '--force', worktreePath],
          { env: withGitEnv(), timeout: 30_000 }
        )
        await execFileAsync('git', ['-C', gitRoot, 'worktree', 'prune'], {
          env: withGitEnv(),
          timeout: 30_000,
        })
      } catch {
        // Ignore
      }

      // Remove directory
      try {
        await rm(worktreePath, { recursive: true, force: true })
      } catch {
        // Ignore
      }

      // Delete branch unless keeping for PR
      if (!opts?.keepBranch) {
        // Delete remote branch first
        try {
          await execFileAsync('git', ['-C', gitRoot, 'push', 'origin', '--delete', branchName], {
            env: withGitEnv(),
            timeout: 15_000,
          })
        } catch {
          // Remote branch may not exist
        }
        // Delete local branch
        try {
          await execFileAsync('git', ['-C', gitRoot, 'branch', '-D', branchName], {
            env: withGitEnv(),
            timeout: 10_000,
          })
        } catch {
          // Ignore
        }
      }
    },
  }
}

/**
 * Detect the default branch (main/master) for the repo
 */
export async function getDefaultBranch(repoDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', repoDir, 'symbolic-ref', 'refs/remotes/origin/HEAD'],
      { env: withGitEnv(), timeout: 5_000 }
    )
    const parts = stdout.trim().split('/')
    return parts[parts.length - 1]
  } catch {
    // Fallback
  }

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', repoDir, 'branch', '-r', '--list', 'origin/main', 'origin/master'],
      { env: withGitEnv(), timeout: 5_000 }
    )
    const branches = stdout.trim().split('\n').map((b) => b.trim())
    if (branches.includes('origin/main')) return 'main'
    if (branches.includes('origin/master')) return 'master'
  } catch {
    // Fallback
  }

  return 'main'
}

/**
 * Check if branch has commits ahead of base
 */
export async function hasBranchCommits(
  worktreePath: string,
  baseBranch: string,
): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'rev-list', '--count', `origin/${baseBranch}..HEAD`],
      { env: withGitEnv(), timeout: 10_000 }
    )
    return parseInt(stdout.trim(), 10) > 0
  } catch {
    return false
  }
}

/**
 * Auto-commit any uncommitted changes in the worktree.
 * This is a fallback for when the agent doesn't commit its own changes.
 */
export async function autoCommitChanges(
  worktreePath: string,
  taskTitle: string,
): Promise<boolean> {
  try {
    // Check if there are any changes to commit
    const { stdout: statusOutput } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'status', '--porcelain'],
      { env: withGitEnv(), timeout: 10_000 }
    )

    if (!statusOutput.trim()) {
      return false // No changes
    }

    // Stage all changes
    await execFileAsync(
      'git',
      ['-C', worktreePath, 'add', '-A'],
      { env: withGitEnv(), timeout: 30_000 }
    )

    // Commit
    await execFileAsync(
      'git',
      ['-C', worktreePath, 'commit', '-m', `${taskTitle}\n\nAuto-committed by Astro task automation`],
      { env: withGitEnv(), timeout: 30_000 }
    )

    console.log(`[worktree-manager] Auto-committed uncommitted changes for: ${taskTitle}`)
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[worktree-manager] Auto-commit failed: ${msg}`)
    return false
  }
}

/**
 * Push branch and create PR. Returns PR info or null.
 */
export async function pushAndCreatePR(options: {
  worktreePath: string
  branchName: string
  baseBranch: string
  title: string
  body: string
}): Promise<{ branchName: string; prUrl?: string; prNumber?: number }> {
  const { worktreePath, branchName, baseBranch, title, body } = options
  const result: { branchName: string; prUrl?: string; prNumber?: number } = { branchName }

  // Push the branch
  try {
    await execFileAsync(
      'git',
      ['-C', worktreePath, 'push', '-u', 'origin', branchName],
      { env: withGitEnv(), timeout: 60_000 }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[worktree-manager] Failed to push branch ${branchName}: ${msg}`)
    return result
  }

  // Check if gh is available
  try {
    await execFileAsync('gh', ['auth', 'status'], { env: withGitEnv(), timeout: 10_000 })
  } catch {
    console.log('[worktree-manager] gh CLI not available, skipping PR creation')
    return result
  }

  // Create PR
  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr', 'create',
        '--base', baseBranch,
        '--head', branchName,
        '--title', title,
        '--body', body,
      ],
      { cwd: worktreePath, env: withGitEnv(), timeout: 30_000 }
    )

    const prUrl = stdout.trim()
    const match = prUrl.match(/\/pull\/(\d+)/)
    result.prUrl = prUrl
    result.prNumber = match ? parseInt(match[1], 10) : undefined

    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[worktree-manager] Failed to create PR: ${msg}`)
    return result
  }
}

/**
 * Check if a directory is a git repo
 */
export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', dir, 'rev-parse', '--git-dir'], {
      env: withGitEnv(),
      timeout: 5_000,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Check if repo has a remote origin
 */
export async function hasRemoteOrigin(dir: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', dir, 'remote', 'get-url', 'origin'],
      { env: withGitEnv(), timeout: 5_000 }
    )
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

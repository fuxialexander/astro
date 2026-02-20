/**
 * Server-side worktree manager for local dispatch
 *
 * Creates isolated git worktrees for task execution and handles
 * PR creation after task completion.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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
}): Promise<ServerWorktreeSetup> {
  const { repoPath, taskId, nodeId } = options
  const gitRoot = resolve(repoPath)

  // Verify it's a git repo with commits
  try {
    await execFileAsync('git', ['-C', gitRoot, 'rev-parse', '--verify', 'HEAD'], {
      env: withGitEnv(),
      timeout: 5_000,
    })
  } catch (err) {
    throw new Error(`Repository has no commits (HEAD not found): ${err instanceof Error ? err.message : String(err)}`)
  }

  // Check for remote origin
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', gitRoot, 'remote', 'get-url', 'origin'],
      { env: withGitEnv(), timeout: 5_000 }
    )
    if (!stdout.trim()) {
      throw new Error('Remote origin URL is empty')
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Remote origin URL')) throw err
    throw new Error(`No remote origin configured: ${err instanceof Error ? err.message : String(err)}`)
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

  // Find and remove any existing worktree that uses this branch.
  // Without this, `git branch -D` fails because the branch is checked out
  // by a lingering worktree from a previous execution.
  // This is critical — if cleanup fails, the entire worktree creation will fail.
  const { stdout: wtList } = await execFileAsync(
    'git',
    ['-C', gitRoot, 'worktree', 'list', '--porcelain'],
    { env: withGitEnv(), timeout: 10_000 }
  )
  // Parse porcelain output: blocks separated by blank lines,
  // each block has "worktree <path>" and "branch refs/heads/<name>"
  let currentWorktreePath: string | null = null
  for (const line of wtList.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentWorktreePath = line.slice('worktree '.length)
    } else if (line.startsWith('branch ') && currentWorktreePath) {
      const ref = line.slice('branch '.length)
      if (ref === `refs/heads/${branchName}`) {
        console.log(`[worktree-manager] Removing existing worktree at ${currentWorktreePath} (branch: ${branchName})`)
        // Try git worktree remove first, fall back to force-removing the directory + prune
        try {
          await execFileAsync(
            'git',
            ['-C', gitRoot, 'worktree', 'remove', '--force', currentWorktreePath],
            { env: withGitEnv(), timeout: 30_000 }
          )
        } catch (removeErr) {
          console.warn(`[worktree-manager] 'git worktree remove' failed for ${currentWorktreePath}: ${removeErr instanceof Error ? removeErr.message : String(removeErr)}`)
          // Fallback: force-remove the directory and prune to deregister
          await rm(currentWorktreePath, { recursive: true, force: true })
          await execFileAsync('git', ['-C', gitRoot, 'worktree', 'prune'], {
            env: withGitEnv(),
            timeout: 30_000,
          })
          console.log(`[worktree-manager] Fallback cleanup succeeded: removed dir + pruned for ${currentWorktreePath}`)
        }
        // Clean up directory if it still exists after either path
        if (existsSync(currentWorktreePath)) {
          await rm(currentWorktreePath, { recursive: true, force: true })
        }
      }
    } else if (line.trim() === '') {
      currentWorktreePath = null
    }
  }

  // Delete local branch if it already exists
  try {
    await execFileAsync('git', ['-C', gitRoot, 'branch', '-D', branchName], {
      env: withGitEnv(),
      timeout: 10_000,
    })
  } catch {
    // Branch didn't exist
  }

  // Delete remote branch if it exists — prevents non-fast-forward push
  // failures when re-executing a task whose previous branch was already pushed
  try {
    await execFileAsync('git', ['-C', gitRoot, 'push', 'origin', '--delete', branchName], {
      env: withGitEnv(),
      timeout: 15_000,
    })
    console.log(`[worktree-manager] Deleted remote branch ${branchName}`)
  } catch {
    // Remote branch didn't exist
  }

  // Fetch latest so we branch from up-to-date origin
  try {
    await execFileAsync('git', ['-C', gitRoot, 'fetch', 'origin'], {
      env: withGitEnv(),
      timeout: 30_000,
    })
  } catch {
    // Non-fatal: proceed with potentially stale refs
  }

  // Detect the default branch to use as start point
  const defaultBranch = await getDefaultBranch(gitRoot)

  // Ensure the git root is on the default branch.
  // A previous execution that fell back to the repo directly may have
  // left HEAD on a task branch, which would contaminate new worktrees.
  try {
    await execFileAsync('git', ['-C', gitRoot, 'checkout', defaultBranch], {
      env: withGitEnv(),
      timeout: 10_000,
    })
  } catch {
    // May fail if there are uncommitted changes; non-fatal
  }

  // Create worktree from origin/<defaultBranch> — NOT from HEAD.
  // Using HEAD is dangerous because it could be on a stale task branch
  // (from a previous execution that fell back to the repo directly),
  // which would cause cross-task commit contamination.
  await execFileAsync(
    'git',
    ['-C', gitRoot, 'worktree', 'add', '-b', branchName, worktreePath, `origin/${defaultBranch}`],
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

/**
 * Find a worktree directory on disk by executionId.
 *
 * Scans ~/.astro/worktrees/{repoName}/ for a directory whose name
 * matches the sanitized executionId. Returns the full path if found.
 *
 * This enables session recovery after a server restart when the
 * in-memory worktree registry has been lost.
 */
export async function findWorktreeOnDisk(executionId: string): Promise<string | null> {
  const sanitizedId = sanitize(executionId)
  const worktreesRoot = join(homedir(), '.astro', 'worktrees')

  if (!existsSync(worktreesRoot)) return null

  try {
    const repoDirs = await readdir(worktreesRoot, { withFileTypes: true })
    for (const repoDir of repoDirs) {
      if (!repoDir.isDirectory()) continue
      const candidate = join(worktreesRoot, repoDir.name, sanitizedId)
      if (existsSync(candidate)) {
        // Verify it's actually a git worktree (has .git file/dir)
        if (existsSync(join(candidate, '.git'))) {
          return candidate
        }
      }
    }
  } catch {
    // Scan failed — disk may be unavailable
  }

  return null
}

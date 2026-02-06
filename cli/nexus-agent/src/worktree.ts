/**
 * Worktree Support for Agent Runner
 *
 * Creates isolated git worktrees for task execution, providing:
 * - Clean environment for each task
 * - Branch-based isolation
 * - Automatic cleanup on completion
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import chalk from 'chalk'

const execAsync = promisify(exec)

export interface WorktreeOptions {
  /** Base working directory (must be inside a git repo) */
  workingDirectory: string
  /** Task ID for unique branch naming */
  taskId: string
  /** Project ID for organization */
  projectId?: string
  /** Optional override for worktree root directory */
  rootOverride?: string
  /** Callback for stdout logging */
  onOutput?: (stream: 'stdout' | 'stderr', data: string) => void
}

export interface WorktreeSetup {
  /** Working directory inside the worktree */
  workingDirectory: string
  /** Name of the branch created */
  branchName: string
  /** Cleanup function to remove worktree */
  cleanup: () => Promise<void>
}

/**
 * Create a git worktree for isolated task execution
 */
export async function createWorktree(options: WorktreeOptions): Promise<WorktreeSetup | null> {
  const { workingDirectory, taskId, projectId, rootOverride, onOutput } = options

  const log = (level: 'stdout' | 'stderr', msg: string) => {
    onOutput?.(level, msg + '\n')
    if (level === 'stderr') {
      console.log(chalk.yellow(`  [worktree] ${msg}`))
    } else {
      console.log(chalk.gray(`  [worktree] ${msg}`))
    }
  }

  // Find git root
  const gitRoot = await getGitRoot(workingDirectory)
  if (!gitRoot) {
    log('stderr', 'Not a git repository, skipping worktree creation')
    return null
  }

  // Check if repo has commits
  const hasHead = await hasCommits(gitRoot)
  if (!hasHead) {
    log('stderr', 'Repository has no commits, skipping worktree creation')
    return null
  }

  // Prepare worktree directory
  const repoName = sanitize(path.basename(gitRoot))
  const worktreeBase = rootOverride ?? path.join(os.tmpdir(), 'nexus-worktrees', repoName)
  await fs.mkdir(worktreeBase, { recursive: true })

  // Create unique branch name
  const branchSuffix = sanitize(projectId ? `${projectId}-${taskId}` : taskId)
  const branchName = `nexus/${branchSuffix}`
  const worktreePath = path.join(worktreeBase, sanitize(taskId))

  try {
    // Clean up any existing worktree at this path
    await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => {})

    // Prune stale worktrees
    await pruneWorktrees(gitRoot)

    // Delete existing branch if it exists
    await deleteBranchIfExists(gitRoot, branchName)

    // Create the worktree with a new branch
    log('stdout', `Creating worktree at ${worktreePath}`)
    await execAsync(`git -C "${gitRoot}" worktree add -b "${branchName}" "${worktreePath}"`, {
      env: withGitEnv(),
      timeout: 30000,
    })

    // Run any .worktreesetup script if present
    await runSetupScript(gitRoot, worktreePath, log)

    // Calculate working directory inside worktree
    const relativePath = path.relative(gitRoot, path.resolve(workingDirectory))
    const isSubDir = relativePath && !relativePath.startsWith('..') && relativePath !== '.'
    const worktreeWorkingDir = isSubDir
      ? path.join(worktreePath, relativePath)
      : worktreePath

    log('stdout', `Worktree ready: ${worktreeWorkingDir}`)

    return {
      workingDirectory: worktreeWorkingDir,
      branchName,
      cleanup: async () => {
        await cleanupWorktree(gitRoot, worktreePath, branchName, log)
      },
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log('stderr', `Failed to create worktree: ${msg}`)
    return null
  }
}

/**
 * Get the git root directory
 */
async function getGitRoot(workingDir: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`git -C "${workingDir}" rev-parse --show-toplevel`, {
      env: withGitEnv(),
      timeout: 5000,
    })
    const root = stdout.trim()
    return root ? path.resolve(root) : null
  } catch {
    return null
  }
}

/**
 * Check if repo has any commits
 */
async function hasCommits(gitRoot: string): Promise<boolean> {
  try {
    await execAsync(`git -C "${gitRoot}" rev-parse --verify HEAD`, {
      env: withGitEnv(),
      timeout: 5000,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Delete a branch if it exists
 */
async function deleteBranchIfExists(gitRoot: string, branchName: string): Promise<void> {
  try {
    await execAsync(`git -C "${gitRoot}" branch -D "${branchName}"`, {
      env: withGitEnv(),
      timeout: 10000,
    })
  } catch {
    // Branch didn't exist, that's fine
  }
}

/**
 * Prune stale worktrees
 */
async function pruneWorktrees(gitRoot: string): Promise<void> {
  try {
    await execAsync(`git -C "${gitRoot}" worktree prune`, {
      env: withGitEnv(),
      timeout: 30000,
    })
  } catch {
    // Ignore prune errors
  }
}

/**
 * Run .worktreesetup script if present
 */
async function runSetupScript(
  gitRoot: string,
  worktreePath: string,
  log: (level: 'stdout' | 'stderr', msg: string) => void
): Promise<void> {
  const setupScriptPath = path.join(gitRoot, '.worktreesetup')

  try {
    await fs.access(setupScriptPath)
  } catch {
    // No setup script, that's fine
    return
  }

  log('stdout', 'Running .worktreesetup script...')

  try {
    const { stdout, stderr } = await execAsync(`bash "${setupScriptPath}"`, {
      cwd: worktreePath,
      timeout: 60000,
      env: {
        ...process.env,
        NEXUS_WORKTREE_PATH: worktreePath,
        NEXUS_GIT_ROOT: gitRoot,
      },
    })
    if (stdout) log('stdout', stdout)
    if (stderr) log('stderr', stderr)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log('stderr', `Setup script failed: ${msg}`)
  }
}

/**
 * Clean up a worktree and its branch
 */
async function cleanupWorktree(
  gitRoot: string,
  worktreePath: string,
  branchName: string,
  log: (level: 'stdout' | 'stderr', msg: string) => void
): Promise<void> {
  log('stdout', `Cleaning up worktree at ${worktreePath}`)

  // Remove worktree
  try {
    await execAsync(`git -C "${gitRoot}" worktree remove --force "${worktreePath}"`, {
      env: withGitEnv(),
      timeout: 30000,
    })
  } catch {
    // Try manual removal
    try {
      await fs.rm(worktreePath, { recursive: true, force: true })
    } catch {
      // Ignore
    }
  }

  // Prune worktrees
  await pruneWorktrees(gitRoot)

  // Delete the branch
  try {
    await execAsync(`git -C "${gitRoot}" branch -D "${branchName}"`, {
      env: withGitEnv(),
      timeout: 10000,
    })
  } catch {
    // Branch may already be deleted
  }

  log('stdout', 'Worktree cleaned up')
}

/**
 * Sanitize a string for use in file/branch names
 */
function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * Get git environment variables that disable interactive prompts
 */
function withGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  }
}

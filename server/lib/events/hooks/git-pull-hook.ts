/**
 * Git Pull Hook
 *
 * Automatically performs a git pull in the main project repository after task completion.
 * This ensures the main repo is up-to-date with any changes pushed from worktree execution.
 *
 * For relay-dispatched tasks (machineId is set), sends a git_pull.request via the relay
 * to the agent runner on the user's machine. For local execution, runs git pull directly.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { EventHook } from '../types.js'
import { relayServer } from '../../relay-server.js'

const execFileAsync = promisify(execFile)

/**
 * Git pull hook
 *
 * Triggers on task.completed events to pull latest changes from remote.
 * This keeps the main project working directory in sync after tasks complete.
 *
 * Conditions:
 * - Only runs on task.completed events
 * - Requires project.workingDirectory to be set
 * - If machineId is set: sends git pull request via relay to the agent runner
 * - If no machineId (local execution): runs git pull locally
 * - Non-blocking: failures are logged but don't prevent task completion
 */
export const gitPullHook: EventHook = async (event) => {
  if (event.type !== 'task.completed') return

  const { project } = event

  // Skip if no project or working directory
  if (!project?.workingDirectory) {
    console.log('[git-pull-hook] No working directory configured, skipping git pull')
    return
  }

  const workdir = project.workingDirectory

  // If machineId is set, the task ran on a remote machine — send via relay
  if (event.machineId) {
    const sent = relayServer.requestGitPull(event.machineId, workdir)
    if (sent) {
      console.log(`[git-pull-hook] Git pull request sent via relay to machine ${event.machineId} for ${workdir}`)
    } else {
      console.warn(`[git-pull-hook] Failed to send git pull via relay to machine ${event.machineId}`)
    }
    return
  }

  // Local execution fallback: run git pull directly
  // Verify directory exists
  if (!existsSync(workdir)) {
    console.warn(`[git-pull-hook] Working directory does not exist: ${workdir}`)
    return
  }

  // Verify it's a git repository
  const gitDir = join(workdir, '.git')
  if (!existsSync(gitDir)) {
    console.log(`[git-pull-hook] Not a git repository: ${workdir}`)
    return
  }

  try {
    console.log(`[git-pull-hook] Pulling latest changes in ${workdir}`)

    // Run git pull with timeout
    const { stdout, stderr } = await execFileAsync('git', ['pull'], {
      cwd: workdir,
      timeout: 30000, // 30 second timeout
    })

    if (stdout) {
      console.log(`[git-pull-hook] git pull output: ${stdout.trim()}`)
    }
    if (stderr) {
      console.log(`[git-pull-hook] git pull stderr: ${stderr.trim()}`)
    }
  } catch (error) {
    // Log error but don't fail - git pull is best-effort
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.warn(`[git-pull-hook] Failed to pull in ${workdir}: ${errorMsg}`)
  }
}

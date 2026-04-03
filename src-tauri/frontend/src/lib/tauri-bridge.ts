/**
 * Typed wrappers around Tauri invoke() calls.
 *
 * Each function corresponds to a Rust command registered in the Tauri
 * backend (src-tauri/src/main.rs). The types here must stay in sync
 * with the Rust side.
 */

import { invoke } from '@tauri-apps/api/core'
import type { FileEntry, SidecarStatus } from '@desktop/types'

// ── File System Commands ─────────────────────────────────────────────

/** List directory contents. */
export async function listDir(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('list_files', { path, gitignore: true })
}

/** Read a file as UTF-8 text. */
export async function readFile(path: string): Promise<string> {
  return invoke<string>('read_file', { path })
}

// NOTE: write_file, path_exists, create_dir, run_command are not yet
// implemented as Rust Tauri commands. Add them to fs_commands.rs as needed.

/** Get the raw `git diff` output (unstaged by default, staged if staged=true). */
export async function gitDiff(repoPath: string, staged = false): Promise<string> {
  return invoke<string>('git_diff', { repoPath, staged })
}

/** Stage all changes and commit with the given message. */
export async function gitCommit(repoPath: string, message: string): Promise<string> {
  return invoke<string>('git_commit', { repoPath, message })
}

/** Push the current branch to origin. */
export async function gitPush(repoPath: string): Promise<string> {
  return invoke<string>('git_push', { repoPath })
}

/** Create and check out a new branch. */
export async function gitCreateBranch(repoPath: string, branchName: string): Promise<void> {
  return invoke<void>('git_create_branch', { repoPath, branchName })
}

/** Open a path in the given editor (cursor|code|finder|terminal|iterm2|ghostty|xcode). */
export async function openInEditor(path: string, editor: string): Promise<void> {
  return invoke<void>('open_in_editor', { path, editor })
}

/** Return list of installed editor IDs on this system. */
export async function detectEditors(): Promise<string[]> {
  return invoke<string[]>('detect_editors')
}

/** Open a native folder-picker dialog; returns the selected path or null. */
export async function pickDirectory(): Promise<string | null> {
  return invoke<string | null>('pick_directory')
}

/** Return the current git branch for a repo path (empty string if not a git repo). */
export async function gitCurrentBranch(repoPath: string): Promise<string> {
  return invoke<string>('git_current_branch', { repoPath })
}

// ── Terminal Commands ────────────────────────────────────────────────

/** Spawn a persistent terminal session and return its ID. */
export async function spawnTerminal(cwd?: string): Promise<string> {
  const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  await invoke<void>('spawn_terminal', { id, cwd: cwd ?? '~' })
  return id
}

/** Send input to a terminal session. */
export async function writeTerminal(sessionId: string, input: string): Promise<void> {
  return invoke<void>('write_terminal', { id: sessionId, data: input })
}

/** Kill a terminal session. */
export async function killTerminal(sessionId: string): Promise<void> {
  return invoke<void>('kill_terminal', { id: sessionId })
}

// ── File Watcher ─────────────────────────────────────────────────────

/** Start watching a directory for file changes. Returns a watcher ID. */
export async function watchDir(path: string, recursive = true): Promise<string> {
  return invoke<string>('watch_directory', { path, recursive })
}

/** Stop watching a directory. */
export async function unwatchDir(watchId: string): Promise<void> {
  return invoke<void>('unwatch', { watchId })
}

// ── Sidecar (Agent Runner) ───────────────────────────────────────────

/** Get the status of the sidecar agent process. */
export async function getSidecarStatus(): Promise<SidecarStatus> {
  return invoke<SidecarStatus>('sidecar_status')
}

/** Start the sidecar agent process. */
export async function startSidecar(): Promise<void> {
  return invoke<void>('start_sidecar')
}

/** Stop the sidecar agent process. */
export async function stopSidecar(): Promise<void> {
  return invoke<void>('stop_sidecar')
}

/** Health-check: ping the sidecar and return true if responsive. */
export async function sidecarHealthCheck(): Promise<boolean> {
  try {
    const status = await getSidecarStatus()
    return status.running
  } catch {
    return false
  }
}

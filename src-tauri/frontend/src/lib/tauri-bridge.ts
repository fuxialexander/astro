/**
 * Typed wrappers around Tauri invoke() calls.
 *
 * Each function corresponds to a Rust command registered in the Tauri
 * backend (src-tauri/src/main.rs). The types here must stay in sync
 * with the Rust side.
 */

import { invoke } from '@tauri-apps/api/core'
import type { FileEntry, SidecarStatus, WatcherEvent } from '@desktop/types'

// ── File System Commands ─────────────────────────────────────────────

/** List directory contents. */
export async function listDir(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('list_dir', { path })
}

/** Read a file as UTF-8 text. */
export async function readFile(path: string): Promise<string> {
  return invoke<string>('read_file', { path })
}

/** Write UTF-8 text to a file. */
export async function writeFile(path: string, contents: string): Promise<void> {
  return invoke<void>('write_file', { path, contents })
}

/** Check if a path exists. */
export async function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>('path_exists', { path })
}

/** Create a directory (and parents). */
export async function createDir(path: string): Promise<void> {
  return invoke<void>('create_dir', { path })
}

// ── Terminal Commands ────────────────────────────────────────────────

export interface TerminalOutput {
  stdout: string
  stderr: string
  exitCode: number
}

/** Run a shell command in a given working directory. */
export async function runCommand(
  command: string,
  args: string[],
  cwd?: string,
): Promise<TerminalOutput> {
  return invoke<TerminalOutput>('run_command', { command, args, cwd })
}

/** Spawn a persistent terminal session and return its ID. */
export async function spawnTerminal(cwd?: string): Promise<string> {
  return invoke<string>('spawn_terminal', { cwd })
}

/** Send input to a terminal session. */
export async function writeTerminal(sessionId: string, input: string): Promise<void> {
  return invoke<void>('write_terminal', { sessionId, input })
}

/** Kill a terminal session. */
export async function killTerminal(sessionId: string): Promise<void> {
  return invoke<void>('kill_terminal', { sessionId })
}

// ── File Watcher ─────────────────────────────────────────────────────

/** Start watching a directory for file changes. Returns a watcher ID. */
export async function watchDir(path: string): Promise<string> {
  return invoke<string>('watch_dir', { path })
}

/** Stop watching a directory. */
export async function unwatchDir(watcherId: string): Promise<void> {
  return invoke<void>('unwatch_dir', { watcherId })
}

/**
 * Poll for watcher events since the last poll.
 * In a real implementation, this would use Tauri events (listen()),
 * but this provides a simpler initial API.
 */
export async function pollWatcherEvents(watcherId: string): Promise<WatcherEvent[]> {
  return invoke<WatcherEvent[]>('poll_watcher_events', { watcherId })
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

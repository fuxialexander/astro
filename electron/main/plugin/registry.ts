/**
 * In-memory plugin registry.
 *
 * Tracks every discovered plugin and its current state (`installed`,
 * `running`, `crashed`, `disabled`). Authoritative for the `plugin:list`
 * IPC channel. Persistence of the enabled flag will land in Phase 4B
 * (a tiny KV file under `app.getPath('userData')/plugins/state.json`);
 * for now, enabled state survives only the current process.
 */

import type { UtilityProcess } from 'electron'
import type { PluginManifest } from './types.js'

export type PluginState = 'installed' | 'running' | 'crashed' | 'disabled'

export interface PluginEntry {
  manifest: PluginManifest
  /** Absolute path to the plugin directory containing manifest.json + entry. */
  dir: string
  enabled: boolean
  state: PluginState
  /** Set while the plugin host process is alive. */
  proc?: UtilityProcess
  /** Last activation/runtime error. */
  error?: string
}

const entries = new Map<string, PluginEntry>()

export function upsert(entry: PluginEntry): void {
  entries.set(entry.manifest.id, entry)
}

export function get(id: string): PluginEntry | undefined {
  return entries.get(id)
}

export function all(): PluginEntry[] {
  return Array.from(entries.values())
}

export function remove(id: string): void {
  entries.delete(id)
}

export function setState(id: string, state: PluginState, error?: string): void {
  const entry = entries.get(id)
  if (!entry) return
  entry.state = state
  if (error !== undefined) entry.error = error
}

export function clear(): void {
  entries.clear()
}

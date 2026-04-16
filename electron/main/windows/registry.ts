/**
 * Window registry — single source of truth for live BrowserWindow handles
 * keyed by stable ID. The main process uses this to focus / target IPC /
 * coordinate cross-window state.
 *
 * IDs in use:
 *   - "main"             — the primary shell window
 *   - "find-in-page"     — Phase 5
 *   - "about"            — Phase 5
 *   - "template"         — Phase 5
 *   - "detached:<paneId>" — Phase 3 detached panes
 */

import type { BrowserWindow } from 'electron'

class WindowRegistry {
  private windows = new Map<string, BrowserWindow>()

  register(id: string, window: BrowserWindow): void {
    this.windows.set(id, window)
    window.on('closed', () => {
      if (this.windows.get(id) === window) {
        this.windows.delete(id)
      }
    })
  }

  get(id: string): BrowserWindow | undefined {
    return this.windows.get(id)
  }

  has(id: string): boolean {
    return this.windows.has(id)
  }

  delete(id: string): void {
    this.windows.delete(id)
  }

  all(): BrowserWindow[] {
    return Array.from(this.windows.values())
  }

  ids(): string[] {
    return Array.from(this.windows.keys())
  }
}

export const windowRegistry = new WindowRegistry()

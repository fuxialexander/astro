/**
 * pane-store — persisted dockview layout snapshot.
 *
 * Storage backends:
 *   - Desktop (Electron): file-backed via `desktopBridge.layout.save/load`,
 *     which writes to `userData/layouts/<key>.json` in the main process.
 *     This is durable across reinstalls-in-place and doesn't bloat
 *     localStorage with ~hundreds of KB of dockview JSON.
 *   - Web: localStorage, same as before.
 *
 * The store hydrates eagerly from localStorage so the host can restore
 * synchronously on first paint; on desktop we then kick off an async
 * load from the IPC backend and overwrite the snapshot when it arrives.
 * Saves are mirrored to both backends on desktop so a user who downgrades
 * to the web build doesn't lose their layout.
 */
import { create } from 'zustand'

import { isDesktop } from '@/lib/desktop-detect'
import { desktopBridge } from '@/lib/desktop-bridge'
import type { PaneLayoutSnapshot } from '@/components/panes/types'

const STORAGE_KEY = 'astro:pane-layout:v1'
const LAYOUT_KEY = 'pane-layout-v1'
const SCHEMA_VERSION = 1

interface PaneStoreState {
  snapshot: PaneLayoutSnapshot | null
  /** Replace the saved snapshot. Persists synchronously to localStorage and, on desktop, asynchronously to the file-backed layout store. */
  saveSnapshot: (layout: unknown) => void
  /** Drop the saved snapshot — host will fall back to default layout. */
  clearSnapshot: () => void
}

function loadFromLocalStorage(): PaneLayoutSnapshot | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PaneLayoutSnapshot
    if (parsed.version !== SCHEMA_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

function writeLocalStorage(snapshot: PaneLayoutSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // quota / private mode — ignore, in-memory state still works
  }
}

export const usePaneStore = create<PaneStoreState>()((set) => ({
  snapshot: loadFromLocalStorage(),

  saveSnapshot: (layout) => {
    const snapshot: PaneLayoutSnapshot = { version: SCHEMA_VERSION, layout }
    writeLocalStorage(snapshot)
    if (isDesktop()) {
      void desktopBridge.layout
        .save({ key: LAYOUT_KEY, value: snapshot })
        .catch(() => {
          // Best-effort — localStorage copy is the safety net.
        })
    }
    set({ snapshot })
  },

  clearSnapshot: () => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    if (isDesktop()) {
      void desktopBridge.layout
        .save({ key: LAYOUT_KEY, value: null })
        .catch(() => {
          // ignore
        })
    }
    set({ snapshot: null })
  },
}))

// Desktop: hydrate from the file-backed store and overwrite the localStorage
// seed if present. This runs once at module init and the promise is
// fire-and-forget — the PaneHost will pick up the snapshot when it updates.
if (typeof window !== 'undefined' && isDesktop()) {
  void desktopBridge.layout
    .load({ key: LAYOUT_KEY })
    .then((res) => {
      const value = res.value as PaneLayoutSnapshot | null
      if (!value || typeof value !== 'object') return
      if (value.version !== SCHEMA_VERSION) return
      usePaneStore.setState({ snapshot: value })
      writeLocalStorage(value)
    })
    .catch(() => {
      // Ignore — localStorage seed already loaded.
    })
}

/**
 * Preload for the template window (Phase 5 scaffold).
 *
 * Copy this file alongside `electron/main/windows/template-window.ts`
 * and `electron/renderers/template_window/` when you add a new aux
 * window. The bridge should expose ONLY what the window needs —
 * never re-export the full main-window bridge (which has streaming,
 * filesystem, etc.) into a small utility window.
 *
 * Sandbox-safe.
 */

import { contextBridge, ipcRenderer } from 'electron'

const api = {
  /** Example: call an IPC channel. Replace with real ones. */
  ping: () => ipcRenderer.invoke('template:ping') as Promise<{ ok: true }>,
}

contextBridge.exposeInMainWorld('astro', api)

export type TemplateBridge = typeof api

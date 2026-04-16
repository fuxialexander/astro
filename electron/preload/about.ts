/**
 * Preload for the About window.
 *
 * Exposes version / app-name info gathered at preload time via
 * `process.versions` and the injected environment. The main process
 * passes the app name + version through env vars (see about-window.ts
 * loader) — here we just read `process.versions` for the runtime data.
 *
 * There is no IPC channel for this window: the information is static.
 *
 * Sandbox-safe: `process.versions` is available in sandbox preloads.
 */

import { contextBridge, ipcRenderer } from 'electron'

export interface AboutVersions {
  appName: string
  appVersion: string
  electron: string
  chrome: string
  node: string
  v8: string
}

const api = {
  getVersions: (): Promise<AboutVersions> =>
    ipcRenderer.invoke('about:get-versions') as Promise<AboutVersions>,
}

contextBridge.exposeInMainWorld('astro', api)

export type AboutBridge = typeof api

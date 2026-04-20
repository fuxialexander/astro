/**
 * Typed renderer-side wrapper around `window.astro.*`. The preload script
 * (electron/preload/main.ts) exposes the raw IPC surface; this module gives
 * it a typed, ergonomic shape.
 *
 * IMPORTANT: types are written by hand for now. A future
 * scripts/gen-ipc-bridge.ts will codegen these from the Zod schemas in
 * electron/main/ipc/schema/. Until then, keep the shapes here in sync with
 * those files manually.
 *
 * Web build behavior: every method throws a clear "desktop only" error if
 * called when isDesktop() === false. Components must gate calls with
 * isDesktop() — see src/components/desktop/.
 */

import { isDesktop } from './desktop-detect.js'
import type { IpcRes } from './desktop-bridge.generated.js'

// ─── Types (auto-derived from electron/main/ipc/schema/ via codegen) ───────
// See src/lib/desktop-bridge.generated.ts (produced by scripts/gen-ipc-bridge.ts).
// Run `npm run gen:ipc` after editing any schema under electron/main/ipc/schema/.

export type FsStat = IpcRes<'fs:stat'>
export type FsEntry = IpcRes<'fs:list-dir'>['entries'][number]
export type GitStatus = IpcRes<'git:status'>
export type GitFileChange = GitStatus['files'][number]
export type GitCommit = IpcRes<'git:log'>['commits'][number]
export type WatchEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
export type WatchBatch = { events: Array<{ type: WatchEventType; path: string }> }
export type ServerStatus = IpcRes<'server:status'>
export type WindowInfo = IpcRes<'windows:list'>['windows'][number]
export type EditorInfo = IpcRes<'editor:detect'>['editors'][number]

export type {
  IpcChannels,
  IpcChannel,
  IpcReq,
  IpcRes,
  DesktopBridgeSurface,
} from './desktop-bridge.generated.js'

// Generic raw bridge — preload exposes a single `invoke(channel, payload)`
// plus a stream subscription mechanism.
interface RawBridge {
  invoke<T = unknown>(channel: string, payload: unknown): Promise<T>
  streams: {
    subscribe(channel: string, handler: (payload: unknown) => void): () => void
  }
  platform: {
    isElectron: true
    os: NodeJS.Platform
    versions: { electron: string; chrome: string; node: string }
  }
  onAuthCallback(
    handler: (tokens: { accessToken: string; refreshToken: string }) => void,
  ): () => void
  onUpdateReady(handler: (info: { version: string }) => void): () => void
}

function bridge(): RawBridge {
  if (!isDesktop()) {
    throw new Error('[desktop-bridge] called in non-desktop environment')
  }
  return (window as unknown as { astro: RawBridge }).astro
}

// ─── Typed surface ─────────────────────────────────────────────────────────

export const desktopBridge = {
  fs: {
    readFile: (path: string, encoding: 'utf8' | 'base64' = 'utf8') =>
      bridge().invoke<{ content: string }>('fs:read-file', { path, encoding }),
    writeFile: (path: string, content: string, encoding: 'utf8' | 'base64' = 'utf8') =>
      bridge().invoke<{ ok: true }>('fs:write-file', { path, content, encoding }),
    exists: (path: string) => bridge().invoke<{ exists: boolean }>('fs:exists', { path }),
    stat: (path: string) => bridge().invoke<FsStat>('fs:stat', { path }),
    listDir: (path: string) => bridge().invoke<{ entries: FsEntry[] }>('fs:list-dir', { path }),
    mkdir: (path: string, recursive = true) =>
      bridge().invoke<{ ok: true }>('fs:mkdir', { path, recursive }),
    rm: (path: string, opts: { recursive?: boolean; force?: boolean } = {}) =>
      bridge().invoke<{ ok: true }>('fs:rm', {
        path,
        recursive: opts.recursive ?? false,
        force: opts.force ?? false,
      }),
    search: (req: { root: string; query: string; limit?: number }) =>
      bridge().invoke<{
        matches: Array<{ path: string; name: string; type: 'file' | 'directory' }>
      }>('fs:search', req),
  },

  git: {
    status: (cwd: string) => bridge().invoke<GitStatus>('git:status', { cwd }),
    log: (cwd: string, maxCount = 50) =>
      bridge().invoke<{ commits: GitCommit[] }>('git:log', { cwd, maxCount }),
    diff: (
      cwd: string,
      opts: {
        revision?: string | null
        file?: string | null
        staged?: boolean
      } = {},
    ) =>
      bridge().invoke<{ diff: string }>('git:diff', {
        cwd,
        revision: opts.revision ?? null,
        file: opts.file ?? null,
        staged: opts.staged,
      }),
    branches: (cwd: string) =>
      bridge().invoke<{ current: string | null; all: string[] }>('git:branches', { cwd }),
    checkout: (cwd: string, ref: string) =>
      bridge().invoke<{ ok: true }>('git:checkout', { cwd, ref }),
    commit: (cwd: string, message: string, files?: string[]) =>
      bridge().invoke<{ commitHash: string }>('git:commit', { cwd, message, files }),
  },

  terminal: {
    spawn: (req: { cwd: string; shell?: string; cols?: number; rows?: number }) =>
      bridge().invoke<{ sessionId: string; pid: number }>('terminal:spawn', {
        cwd: req.cwd,
        shell: req.shell,
        cols: req.cols ?? 80,
        rows: req.rows ?? 24,
      }),
    write: (sessionId: string, data: string) =>
      bridge().invoke<{ ok: true }>('terminal:write', { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) =>
      bridge().invoke<{ ok: true }>('terminal:resize', { sessionId, cols, rows }),
    kill: (sessionId: string) => bridge().invoke<{ ok: true }>('terminal:kill', { sessionId }),
    onData: (sessionId: string, handler: (chunk: string) => void) =>
      bridge().streams.subscribe(`terminal:${sessionId}:data`, (p) =>
        handler(typeof p === 'string' ? p : (p as { data?: string }).data ?? '')
      ),
    onExit: (sessionId: string, handler: (info: { code: number | null; signal: string | null }) => void) =>
      bridge().streams.subscribe(`terminal:${sessionId}:exit`, (p) =>
        handler(p as { code: number | null; signal: string | null })
      ),
  },

  watcher: {
    subscribe: async (
      path: string,
      handler: (batch: WatchBatch) => void,
      opts: { ignored?: string[]; recursive?: boolean } = {}
    ) => {
      const { subscriptionId } = await bridge().invoke<{ subscriptionId: string }>(
        'watcher:subscribe',
        { path, ignored: opts.ignored, recursive: opts.recursive ?? true }
      )
      const off = bridge().streams.subscribe(`watcher:${subscriptionId}`, (p) =>
        handler(p as WatchBatch)
      )
      return async () => {
        off()
        await bridge().invoke<{ ok: true }>('watcher:unsubscribe', { subscriptionId })
      }
    },
  },

  pdf: {
    download: (req: { url: string; filename?: string | null; subdir?: string; timeoutMs?: number }) =>
      bridge().invoke<{ path: string; bytes: number }>('pdf:download', {
        url: req.url,
        filename: req.filename ?? null,
        subdir: req.subdir ?? 'pdfs',
        timeoutMs: req.timeoutMs ?? 60_000,
      }),
  },

  editor: {
    detect: () => bridge().invoke<{ editors: EditorInfo[] }>('editor:detect', {}),
    open: (editorId: string, path: string, line?: number) =>
      bridge().invoke<{ ok: true }>('editor:open', { editorId, path, line }),
    openExternal: (url: string) => bridge().invoke<{ ok: true }>('editor:open-external', { url }),
  },

  dialog: {
    showOpen: (req: {
      title?: string
      defaultPath?: string
      filters?: Array<{ name: string; extensions: string[] }>
      properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>
    }) => bridge().invoke<{ canceled: boolean; filePaths: string[] }>('dialog:open', req),
    showSave: (req: {
      title?: string
      defaultPath?: string
      filters?: Array<{ name: string; extensions: string[] }>
    }) => bridge().invoke<{ canceled: boolean; filePath: string | null }>('dialog:save', req),
    showMessage: (req: {
      type?: 'none' | 'info' | 'error' | 'question' | 'warning'
      title?: string
      message: string
      detail?: string
      buttons?: string[]
    }) =>
      bridge().invoke<{ response: number }>('dialog:message', {
        type: req.type ?? 'info',
        title: req.title,
        message: req.message,
        detail: req.detail,
        buttons: req.buttons,
      }),
  },

  windows: {
    focus: (id: string) => bridge().invoke<{ ok: true }>('windows:focus', { id }),
    list: () => bridge().invoke<{ windows: WindowInfo[] }>('windows:list', {}),
    detachPane: (req: { paneKind: string; paneId: string; paneTitle: string; paneState: unknown }) =>
      bridge().invoke<{ windowId: string }>('windows:detach-pane', req),
    close: (id: string) => bridge().invoke<{ ok: true }>('windows:close', { id }),
  },

  server: {
    status: () => bridge().invoke<ServerStatus>('server:status', {}),
    restart: () => bridge().invoke<{ ok: true }>('server:restart', {}),
  },

  plugins: {
    list: () =>
      bridge().invoke<{
        plugins: Array<{
          id: string
          name: string
          version: string
          enabled: boolean
          state: 'installed' | 'running' | 'crashed' | 'disabled'
        }>
      }>('plugin:list', {}),
    enable: (id: string) => bridge().invoke<{ ok: true }>('plugin:enable', { id }),
    disable: (id: string) => bridge().invoke<{ ok: true }>('plugin:disable', { id }),
    install: (sourcePath: string) =>
      bridge().invoke<{ id: string }>('plugin:install', { sourcePath }),
    uninstall: (id: string) => bridge().invoke<{ ok: true }>('plugin:uninstall', { id }),
  },

  layout: {
    load: (req: { key: string }) =>
      bridge().invoke<{ value: unknown }>('layout:load', req),
    save: (req: { key: string; value: unknown }) =>
      bridge().invoke<{ ok: true }>('layout:save', req),
  },

  platform: () => bridge().platform,

  auth: {
    onCallback: (handler: (tokens: { accessToken: string; refreshToken: string }) => void) =>
      bridge().onAuthCallback(handler),
  },

  updater: {
    onReady: (handler: (info: { version: string }) => void) =>
      bridge().onUpdateReady(handler),
    install: () => bridge().invoke<{ ok: true }>('updater:install', {}),
  },
}

export type DesktopBridge = typeof desktopBridge

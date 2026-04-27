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
    getSticky(channel: string): Promise<unknown>
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

// ─── Onboarding / providers / ssh types ────────────────────────────────────

export type DeviceAuthState =
  | { state: 'pending' }
  | { state: 'authorized'; machineId: string }
  | { state: 'expired' }
  | { state: 'denied' }
  | { state: 'error'; message: string }
  | { state: 'network-error'; message: string }

export type ProviderId = 'claude' | 'codex' | 'pi' | 'openclaw'

export type ProviderInfo = {
  id: ProviderId
  label: string
  installed: boolean
  authed: boolean
  version: string | null
  signInUrl: string | null
}

export type SSHHost = {
  alias: string
  hostname: string
  user: string | null
  port: number
  identityFile: string | null
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
    searchContent: (req: { root: string; pattern: string; caseSensitive?: boolean; maxMatchesPerFile?: number; limit?: number }) =>
      bridge().invoke<{
        matches: Array<{ path: string; lineNo: number; line: string; matchStart: number; matchEnd: number }>
        error?: string
      }>('fs:search-content', req),
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

  shell: {
    openTerminal: (command: string) =>
      bridge().invoke<{ ok: true }>('shell:open-terminal', { command }),
    openPath: (path: string) =>
      bridge().invoke<{ ok: true; error?: string }>('shell:open-path', { path }),
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
    download: (req: {
      url: string
      filename?: string | null
      subdir?: string
      headers?: Record<string, string>
      timeoutMs?: number
    }) =>
      bridge().invoke<{ path: string; bytes: number }>('pdf:download', {
        url: req.url,
        filename: req.filename ?? null,
        subdir: req.subdir ?? 'pdfs',
        headers: req.headers ?? {},
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

  calendar: {
    listEvents: (from: string, to: string) =>
      bridge().invoke<{
        events: Array<{
          id: string; calendarId: string; calendarName: string; calendarColor: string | null
          title: string; startDate: string; endDate: string; allDay: boolean
          notes: string | null; location: string | null; url: string | null; isRecurring: boolean
        }>
        source: 'eventkit' | 'ics-fallback'
        permissionDenied: boolean
      }>('apple-calendar:list-events', { from, to }),
    listCalendars: () =>
      bridge().invoke<{
        calendars: Array<{ id: string; name: string; color: string | null; isSubscribed: boolean; isWritable: boolean }>
      }>('apple-calendar:list-calendars', {}),
    listReminders: (from: string, to: string) =>
      bridge().invoke<{
        reminders: Array<{
          id: string; calendarId: string; calendarName: string; calendarColor: string | null
          title: string; isCompleted: boolean; priority: number
          dueDate: string | null; completedDate: string | null; notes: string | null
        }>
        permissionDenied: boolean
      }>('apple-calendar:list-reminders', { from, to }),
    createEvent: (req: { calendarName?: string; title: string; startDate: string; endDate: string; allDay?: boolean; notes?: string }) =>
      bridge().invoke<{ id: string; ok: boolean }>('apple-calendar:create-event', req),
    updateEvent: (req: { eventId: string; calendarId: string; title?: string; startDate?: string; endDate?: string; notes?: string }) =>
      bridge().invoke<{ ok: boolean }>('apple-calendar:update-event', req),
    deleteEvent: (eventId: string, calendarId: string) =>
      bridge().invoke<{ ok: boolean }>('apple-calendar:delete-event', { eventId, calendarId }),
  },

  cloudCreds: {
    detect: () =>
      bridge().invoke<{
        aws: {
          detected: boolean
          profiles?: string[]
          defaultRegion?: string | null
          source: 'env' | 'credentials-file' | 'config-file' | 'adc-file' | 'none'
        }
        gcp: {
          detected: boolean
          project?: string | null
          account?: string | null
          source: 'env' | 'credentials-file' | 'config-file' | 'adc-file' | 'none'
        }
      }>('cloud-creds:detect', {}),
  },

  cloudPool: {
    create: (req: {
      provider: 'aws' | 'gcp'
      config: { profile?: string; region?: string; project?: string; adcPath?: string; zone?: string }
      poolId: string
      teamId: string
      desiredRunners: number
      resourceProfile: { cpu?: number; memoryGb?: number; gpu?: number; ttlMinutes?: number }
      serverUrl: string
      relayUrl: string
    }) =>
      bridge().invoke<{
        ok: boolean
        instanceIds?: string[]
        region?: string
        instanceType?: string
        amiId?: string
        costMetadata?: { estimatedHourlyCostUsd?: number }
        error?: string
      }>('cloud-pool:create', req),
    scale: (req: {
      provider: 'aws' | 'gcp'
      config: { profile?: string; region?: string; project?: string; adcPath?: string; zone?: string }
      currentInstanceIds: string[]
      desiredRunners: number
      poolId: string
      teamId: string
      resourceProfile: { cpu?: number; memoryGb?: number; gpu?: number; ttlMinutes?: number }
      serverUrl: string
      relayUrl: string
    }) =>
      bridge().invoke<{
        ok: boolean
        instanceIds?: string[]
        added?: string[]
        removed?: string[]
        error?: string
      }>('cloud-pool:scale', req),
    terminate: (req: {
      provider: 'aws' | 'gcp'
      config: { profile?: string; region?: string; project?: string; adcPath?: string; zone?: string }
      instanceIds: string[]
    }) =>
      bridge().invoke<{ ok: boolean; error?: string }>('cloud-pool:terminate', req),
  },

  /** Generic invoke — use typed helpers above whenever possible */
  invoke: <T = unknown>(channel: string, payload: unknown): Promise<T> =>
    bridge().invoke<T>(channel, payload),

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

  onboarding: {
    pairStart: () =>
      bridge().invoke<{
        pairToken: string
        pairUrl: string
        expiresIn: number
      }>('agent:pair-start', {}),
    pairCancel: () =>
      bridge().invoke<{ ok: true }>('agent:pair-cancel', {}),
    authState: () =>
      bridge().invoke<{ authed: boolean; machineId: string | null }>(
        'agent:auth-state',
        {},
      ),
    onDeviceAuth: (handler: (s: DeviceAuthState) => void) => {
      // Subscribe first, then immediately replay the channel's last sticky
      // value if any. This catches the case where the renderer remounted
      // (e.g. astro://auth/callback re-rendered the auth tree) and missed
      // a state event published while there was no live subscriber.
      const unsub = bridge().streams.subscribe('onboarding:device-auth', (p) =>
        handler(p as DeviceAuthState),
      )
      void bridge()
        .streams.getSticky('onboarding:device-auth')
        .then((last) => {
          if (last) handler(last as DeviceAuthState)
        })
        .catch(() => {
          // getSticky failure is non-fatal — live events still flow.
        })
      return unsub
    },
    onHostProgress: (
      handler: (e: {
        alias: string
        state:
          | 'testing'
          | 'installing'
          | 'registering'
          | 'starting'
          | 'connected'
          | 'failed'
          | 'needs-manual'
        message?: string
      }) => void,
    ) =>
      bridge().streams.subscribe('onboarding:host-progress', (p) =>
        handler(
          p as {
            alias: string
            state:
              | 'testing'
              | 'installing'
              | 'registering'
              | 'starting'
              | 'connected'
              | 'failed'
              | 'needs-manual'
            message?: string
          },
        ),
      ),
  },

  localAgent: {
    start: () =>
      bridge().invoke<{ ok: boolean; pid: number | null; error: string | null }>(
        'agent:start-local',
        {},
      ),
    status: () =>
      bridge().invoke<{ running: boolean; pid: number | null; lastError: string | null }>(
        'agent:local-status',
        {},
      ),
  },

  providers: {
    detect: () =>
      bridge().invoke<{ providers: ProviderInfo[] }>('providers:detect', {}),
    verify: (id: ProviderId) =>
      bridge().invoke<ProviderInfo>('providers:verify', { id }),
    writeClaudeKey: (apiKey: string) =>
      bridge().invoke<{ ok: true }>('providers:write-claude-key', { apiKey }),
    openSignIn: (id: ProviderId) =>
      bridge().invoke<{ ok: true }>('providers:open-signin', { id }),
  },

  ssh: {
    discoverHosts: () =>
      bridge().invoke<{
        hosts: SSHHost[]
        hasIdentityKey: boolean
        defaultIdentityPath: string
      }>('ssh:discover-hosts', {}),
    testHost: (alias: string) =>
      bridge().invoke<{ reachable: boolean; needsAuth: boolean; error: string | null }>(
        'ssh:test-host',
        { alias },
      ),
    generateKey: () =>
      bridge().invoke<{ publicKeyPath: string; publicKey: string }>(
        'ssh:generate-key',
        {},
      ),
    copyKey: (alias: string) =>
      bridge().invoke<{
        ok: boolean
        method: 'ssh-copy-id' | 'manual'
        error: string | null
        instructions: string | null
      }>('ssh:copy-key', { alias }),
    installAndRegister: (aliases: string[]) =>
      bridge().invoke<{ ok: true }>('ssh:install-and-register', { aliases }),
  },

  agent: {
    binaryPaths: () =>
      bridge().invoke<{
        bundledAgentPath: string
        bundledCliPath: string
        installedAgentPath: string | null
        installedCliPath: string | null
      }>('agent:binary-paths', {}),
    setupStatus: () =>
      bridge().invoke<{
        installed: boolean
        binDir: string
        agentPath: string | null
        cliPath: string | null
        pathConfigured: boolean
      }>('agent:setup-status', {}),
    setup: () =>
      bridge().invoke<{
        ok: true
        agentPath: string
        cliPath: string
        binDir: string
        shellProfilesUpdated: string[]
      }>('agent:setup', {}),
  },
}

export type DesktopBridge = typeof desktopBridge

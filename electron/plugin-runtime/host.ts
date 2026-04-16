/**
 * Plugin runtime host — utilityProcess entry, one per active plugin.
 *
 * Responsibilities:
 *   1. Receive the bootstrap envelope `{ type: 'bootstrap', manifest }` plus
 *      a MessagePort from the parent (main process).
 *   2. Build a typed `PluginContext` proxy whose `storage`, `stores`, etc.
 *      operations forward to the host via that port (request/response keyed
 *      by an incrementing id).
 *   3. Dynamic-import the plugin entry, look up its `default` export (or
 *      named `plugin` export), and invoke `activate(context)`.
 *   4. On `SIGTERM` / `exit`, call `deactivate()` if defined.
 *
 * This file runs in a stock Node Electron utilityProcess — NOT a renderer.
 * It has no DOM, no contextBridge, no `window.astro`. The plugin author
 * sees only what we expose here, and every host-API call goes through the
 * permission gate on the main side.
 */

// Electron's parentPort emits `{ data, ports }` events shaped like the DOM
// MessageEvent but typed as `any` here to avoid pulling in DOM lib.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ParentMessage = { data: any; ports?: any[] }

interface BootstrapMessage {
  type: 'bootstrap'
  manifest: {
    id: string
    permissions?: string[]
  }
}

interface HostApiResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: { message: string; name?: string }
}

// The Electron utilityProcess parent port.
// Typed as `any` because @types/electron doesn't ship a node-side handle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parentPort: any = (process as any).parentPort

if (!parentPort) {
  console.error('[plugin-host] no parentPort — not running under Electron utilityProcess')
  process.exit(1)
}

let nextRequestId = 1
const pending = new Map<number, (res: HostApiResponse) => void>()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let hostPort: any = null

function callHost(op: string, args: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!hostPort) {
      reject(new Error('host port not yet wired'))
      return
    }
    const id = nextRequestId++
    pending.set(id, (res) => {
      if (res.ok) resolve(res.result)
      else reject(new Error(res.error?.message ?? 'host-api error'))
    })
    hostPort.postMessage({ id, op, args })
  })
}

interface PluginContext {
  manifest: BootstrapMessage['manifest']
  storage: {
    get<T>(key: string): Promise<T | undefined>
    set<T>(key: string, value: T): Promise<void>
  }
  projects: {
    list(): Promise<unknown[]>
  }
  ui: {
    registerCommand(spec: { id: string; title: string }): Promise<void>
  }
}

function buildContext(manifest: BootstrapMessage['manifest']): PluginContext {
  return {
    manifest,
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        const r = (await callHost('storage.get', { key })) as { value?: T }
        return r?.value
      },
      async set<T>(key: string, value: T): Promise<void> {
        await callHost('storage.set', { key, value })
      },
    },
    projects: {
      async list(): Promise<unknown[]> {
        const r = (await callHost('projects.list', {})) as { projects: unknown[] }
        return r?.projects ?? []
      },
    },
    ui: {
      async registerCommand(spec) {
        await callHost('ui.registerCommand', spec)
      },
    },
  }
}

interface PluginModule {
  activate?: (ctx: PluginContext) => Promise<unknown> | unknown
  deactivate?: () => Promise<void> | void
  default?: {
    activate?: (ctx: PluginContext) => Promise<unknown> | unknown
    deactivate?: () => Promise<void> | void
  }
}

let pluginModule: PluginModule | null = null

async function bootstrap(manifest: BootstrapMessage['manifest']): Promise<void> {
  const entry = process.env.ASTRO_PLUGIN_ENTRY
  if (!entry) throw new Error('ASTRO_PLUGIN_ENTRY env var not set')

  // Convert absolute path to a file:// URL so dynamic import works on Windows too.
  const { pathToFileURL } = await import('node:url')
  const url = pathToFileURL(entry).href
  pluginModule = (await import(url)) as PluginModule

  const activate = pluginModule.activate ?? pluginModule.default?.activate
  if (typeof activate !== 'function') {
    throw new Error(`plugin ${manifest.id}: no activate() export at ${entry}`)
  }

  const ctx = buildContext(manifest)
  await activate(ctx)
  console.log(`[plugin-host] activated ${manifest.id}`)
}

parentPort.on('message', (event: ParentMessage) => {
  // First message carries the host-api MessagePort in event.ports[0].
  if (!hostPort && event.ports && event.ports.length > 0) {
    hostPort = event.ports[0]
    hostPort.on('message', (e: ParentMessage) => {
      const res = e.data as HostApiResponse
      const cb = pending.get(res.id)
      if (cb) {
        pending.delete(res.id)
        cb(res)
      }
    })
    hostPort.start()
  }

  const data = event.data as BootstrapMessage | undefined
  if (data?.type === 'bootstrap') {
    bootstrap(data.manifest).catch((err) => {
      console.error('[plugin-host] activation failed:', err)
      process.exit(1)
    })
  }
})

async function shutdown(): Promise<void> {
  try {
    const deactivate = pluginModule?.deactivate ?? pluginModule?.default?.deactivate
    if (typeof deactivate === 'function') await deactivate()
  } catch (err) {
    console.warn('[plugin-host] deactivate threw:', err)
  } finally {
    process.exit(0)
  }
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

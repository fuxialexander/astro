/**
 * Plugin loader + per-plugin utilityProcess supervisor.
 *
 * Discovery: scans `app.getPath('userData')/plugins/<id>/manifest.json`. Each
 * manifest is validated; valid ones land in the registry as `installed`. A
 * call to `enable(id)` forks `electron/plugin-runtime/host.js` as a
 * utilityProcess, hands it a MessageChannelMain port, and routes host-API
 * requests through `dispatchHostApi`.
 *
 * Isolation guarantees:
 *   - Plugin code never runs in the main process or any renderer.
 *   - Host-API access is gated against the manifest's permissions list.
 *   - A crashed plugin sets state='crashed' but leaves the rest of the app
 *     alive — no auto-restart yet (Phase 4B).
 *
 * Note: this is intentionally minimal. There is no marketplace, no signature
 * verification, no sandbox profile beyond utilityProcess + permission gating.
 * Those land in Phase 4B.
 */

import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { app, MessageChannelMain, utilityProcess, type MessagePortMain } from 'electron'
import type { PluginManifest } from './types.js'
import * as registry from './registry.js'
import {
  dispatchHostApi,
  type HostApiRequest,
  type HostApiResponse,
} from './host-api.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function pluginsRoot(): string {
  return path.join(app.getPath('userData'), 'plugins')
}

function resolveHostEntry(): string {
  // In dev: electron/dist/main/plugin/loader.js → ../../plugin-runtime/host.js
  // In packaged: same relative layout under resources/app/electron/dist/.
  return path.resolve(__dirname, '../../plugin-runtime/host.js')
}

function isValidManifest(value: unknown): value is PluginManifest {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return (
    typeof m.id === 'string' &&
    typeof m.name === 'string' &&
    typeof m.version === 'string' &&
    Array.isArray(m.capabilities)
  )
}

/**
 * Scan the plugins directory and add every valid manifest to the registry
 * as `installed`. Idempotent — safe to call on every app boot.
 */
export async function discoverPlugins(): Promise<void> {
  const root = pluginsRoot()
  let dirents: { name: string; isDirectory: () => boolean }[] = []
  try {
    dirents = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return // no plugins dir yet
  }

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue
    const dir = path.join(root, dirent.name)
    const manifestPath = path.join(dir, 'manifest.json')
    try {
      const raw = await fs.readFile(manifestPath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!isValidManifest(parsed)) {
        console.warn(`[plugin-loader] invalid manifest: ${manifestPath}`)
        continue
      }
      registry.upsert({
        manifest: parsed,
        dir,
        enabled: false,
        state: 'installed',
      })
    } catch (err) {
      console.warn(`[plugin-loader] failed to load ${manifestPath}:`, err)
    }
  }
}

/**
 * Fork the plugin-runtime utilityProcess and wire the host-API port.
 */
export async function enablePlugin(id: string): Promise<void> {
  const entry = registry.get(id)
  if (!entry) throw new Error(`plugin not found: ${id}`)
  if (entry.state === 'running') return
  const runtime = entry.manifest.runtime ?? 'sandbox'
  if (runtime !== 'sandbox') {
    throw new Error(`plugin ${id}: unsupported runtime "${runtime}"`)
  }
  if (!entry.manifest.entry) {
    throw new Error(`plugin ${id}: manifest is missing "entry"`)
  }

  const entryPath = path.join(entry.dir, entry.manifest.entry)
  const hostEntry = resolveHostEntry()

  const { port1, port2 } = new MessageChannelMain()

  const proc = utilityProcess.fork(hostEntry, [], {
    serviceName: `astro-plugin-${id}`,
    stdio: 'pipe',
    env: {
      ...process.env,
      ASTRO_PLUGIN_ID: id,
      ASTRO_PLUGIN_DIR: entry.dir,
      ASTRO_PLUGIN_ENTRY: entryPath,
    },
  })

  proc.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[plugin:${id}] ${chunk}`)
  })
  proc.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[plugin:${id}!] ${chunk}`)
  })

  // Hand the child one end of the channel + the manifest as the bootstrap.
  proc.once('spawn', () => {
    // utilityProcess.postMessage transfers MessagePortMain — the @types
    // signature lists `MessagePort[]`, so we cast through unknown.
    proc.postMessage({ type: 'bootstrap', manifest: entry.manifest }, [
      port2,
    ] satisfies MessagePortMain[])
  })

  // Host-API routing: every message on port1 is a HostApiRequest.
  port1.on('message', (event) => {
    const req = event.data as HostApiRequest
    if (!req || typeof req.id !== 'number' || typeof req.op !== 'string') return
    void dispatchHostApi(entry.manifest, req).then((res: HostApiResponse) => {
      try {
        port1.postMessage(res)
      } catch (err) {
        console.warn(`[plugin-loader] postMessage failed for ${id}:`, err)
      }
    })
  })
  port1.start()

  proc.on('exit', (code) => {
    const wasClean = code === 0
    registry.setState(
      id,
      wasClean ? 'installed' : 'crashed',
      wasClean ? undefined : `exited with code ${code}`,
    )
    const e = registry.get(id)
    if (e) {
      e.proc = undefined
      e.enabled = false
    }
    try {
      port1.close()
    } catch {
      // already closed
    }
  })

  entry.proc = proc
  entry.enabled = true
  registry.setState(id, 'running')
}

export async function disablePlugin(id: string): Promise<void> {
  const entry = registry.get(id)
  if (!entry) throw new Error(`plugin not found: ${id}`)
  if (!entry.proc) {
    entry.enabled = false
    registry.setState(id, 'disabled')
    return
  }

  const proc = entry.proc
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()))
  proc.kill()
  await Promise.race([exited, sleep(2000)])
  if (entry.proc) {
    try {
      if (proc.pid != null) process.kill(proc.pid, 'SIGKILL')
    } catch {
      // already dead
    }
  }
  entry.enabled = false
  registry.setState(id, 'disabled')
}

/**
 * Install a plugin from a local directory by copying it under the user's
 * plugins root. The directory must contain `manifest.json`.
 */
export async function installPlugin(sourcePath: string): Promise<string> {
  const manifestPath = path.join(sourcePath, 'manifest.json')
  const raw = await fs.readFile(manifestPath, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (!isValidManifest(parsed)) {
    throw new Error(`invalid manifest at ${manifestPath}`)
  }
  const dest = path.join(pluginsRoot(), parsed.id)
  await fs.mkdir(pluginsRoot(), { recursive: true })
  await fs.cp(sourcePath, dest, { recursive: true, force: true })
  registry.upsert({
    manifest: parsed,
    dir: dest,
    enabled: false,
    state: 'installed',
  })
  return parsed.id
}

export async function uninstallPlugin(id: string): Promise<void> {
  const entry = registry.get(id)
  if (!entry) return
  if (entry.proc) await disablePlugin(id)
  await fs.rm(entry.dir, { recursive: true, force: true })
  registry.remove(id)
}

export function listPlugins() {
  return registry.all().map((e) => ({
    id: e.manifest.id,
    name: e.manifest.name,
    version: e.manifest.version,
    enabled: e.enabled,
    state: e.state,
  }))
}

/**
 * Best-effort shutdown of all running plugins on app quit.
 */
export async function shutdownAllPlugins(): Promise<void> {
  await Promise.all(
    registry
      .all()
      .filter((e) => e.proc != null)
      .map((e) => disablePlugin(e.manifest.id).catch(() => undefined)),
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

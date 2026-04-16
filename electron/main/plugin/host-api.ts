/**
 * Plugin host-API surface.
 *
 * The plugin runtime (electron/plugin-runtime/host.ts) calls into this
 * module via a MessagePort. Each call is a `{ id, op, args }` envelope; we
 * dispatch on `op`, gate against the manifest's declared permissions, and
 * post the result back as `{ id, ok, result | error }`.
 *
 * Phase 4 ships a deliberately tiny surface — just enough for a reference
 * plugin to register a command and persist a value:
 *
 *   - storage.get(key)            -> requires 'storage'
 *   - storage.set(key, value)     -> requires 'storage'
 *   - projects.list()             -> requires 'projects:read'
 *   - ui.registerCommand(spec)    -> requires 'ui:contribute'
 *
 * Phase 4B will widen this to cover plans, tasks, fs, http, and a typed
 * subscription channel for live store updates.
 */

import path from 'node:path'
import { promises as fs } from 'node:fs'
import { app } from 'electron'
import type { PluginManifest, PluginPermission } from './types.js'
import { gate } from './permissions.js'

export interface HostApiRequest {
  id: number
  op: string
  args: unknown
}

export interface HostApiResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: { message: string; name?: string }
}

interface OpContext {
  manifest: PluginManifest
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Op = (ctx: OpContext, args: any) => Promise<unknown> | unknown

const OP_PERMISSIONS: Record<string, PluginPermission> = {
  'storage.get': 'storage',
  'storage.set': 'storage',
  // TODO(Phase 4B): re-enable once 'projects.list' returns real data.
  //   'projects.list': 'projects:read',
  // Omitted today so plugins don't request a permission that grants nothing.
  'ui.registerCommand': 'ui:contribute',
}

/** Per-plugin KV file under userData/plugins/<id>/storage.json. */
function storageFile(pluginId: string): string {
  return path.join(app.getPath('userData'), 'plugins', pluginId, 'storage.json')
}

async function readStorage(pluginId: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(storageFile(pluginId), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

async function writeStorage(
  pluginId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const file = storageFile(pluginId)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8')
}

const ops: Record<string, Op> = {
  'storage.get': async ({ manifest }, args: { key: string }) => {
    const data = await readStorage(manifest.id)
    return { value: data[args.key] }
  },
  'storage.set': async ({ manifest }, args: { key: string; value: unknown }) => {
    const data = await readStorage(manifest.id)
    data[args.key] = args.value
    await writeStorage(manifest.id, data)
    return { ok: true }
  },
  // TODO(Phase 4B): wire 'projects.list' through to the server utilityProcess.
  //   'projects.list': async (_ctx, _args) => ({ projects: await fetchProjects() }),
  // Left unregistered so dispatchHostApi returns an "unknown op" error —
  // consistent with the matching TODO in OP_PERMISSIONS above.

  // Registration is fire-and-forget — the renderer's plugin-store eventually
  // listens for these via a contributions channel. Phase 4B wires that path.
  'ui.registerCommand': () => ({ ok: true }),
}

export async function dispatchHostApi(
  manifest: PluginManifest,
  req: HostApiRequest,
): Promise<HostApiResponse> {
  try {
    const op = ops[req.op]
    if (!op) {
      throw new Error(`unknown host-api op: ${req.op}`)
    }
    const required = OP_PERMISSIONS[req.op]
    if (required) gate(manifest.id, manifest.permissions, required, req.op)
    const result = await op({ manifest }, req.args)
    return { id: req.id, ok: true, result }
  } catch (err) {
    const e = err as Error
    return {
      id: req.id,
      ok: false,
      error: { message: e.message, name: e.name },
    }
  }
}

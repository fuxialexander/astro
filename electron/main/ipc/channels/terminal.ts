/**
 * Terminal channel handlers — backed by node-pty running in the main process.
 *
 * node-pty's IO is non-blocking (it reads/writes file descriptors via libuv),
 * so running it in main is fine for MVP. If the scale of concurrent sessions
 * becomes a problem, we can move it into a worker_thread later without
 * touching the schema.
 *
 * Data flow:
 *   - `terminal:spawn`  → creates an IPty, stores it in a sessions Map,
 *                         wires the `onData`/`onExit` callbacks to publish
 *                         on the stream broker.
 *   - `terminal:write`  → pty.write(data)
 *   - `terminal:resize` → pty.resize(cols, rows)
 *   - `terminal:kill`   → pty.kill()
 *
 * Broker channels:
 *   - `terminal:<sessionId>:data`  — string chunks (utf8)
 *   - `terminal:<sessionId>:exit`  — { code, signal }
 *
 * Native-module rebuild: node-pty ships a prebuilt binary compiled against
 * the *Node* ABI, which Electron's main process can't load. Users run
 * `electron-rebuild -f -w node-pty` after `pnpm install`. If the binary
 * isn't rebuilt yet, `spawn` throws TERMINAL_NOT_REBUILT so the renderer
 * can fall back to its placeholder path.
 */

import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/terminal.js'
import { streamBroker } from '../broker.js'
import { buildSpawnEnv, spawnPtyWithFallback } from './terminal-spawn.js'

// node-pty's IPty shape (minimal subset we touch). We don't import the
// module at the top level — see lazyLoadPty below.
interface IPty {
  pid: number
  onData: (cb: (data: string) => void) => { dispose: () => void }
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => { dispose: () => void }
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: (signal?: string) => void
}

interface PtyModule {
  spawn: (
    file: string,
    args: string[] | string,
    options: {
      name?: string
      cwd?: string
      env?: Record<string, string>
      cols?: number
      rows?: number
    }
  ) => IPty
}

interface Session {
  pty: IPty
  sessionId: string
}

const sessions = new Map<string, Session>()

let ptyModule: PtyModule | null = null
let ptyLoadError: Error | null = null
const require = createRequire(import.meta.url)

/**
 * Lazy-load node-pty. Wrapped in try/catch so a missing or ABI-mismatched
 * native binary doesn't crash the main process at startup; instead we
 * surface TERMINAL_NOT_REBUILT when the renderer first tries to spawn.
 */
function lazyLoadPty(): PtyModule {
  if (ptyModule) return ptyModule
  if (ptyLoadError) throw ptyLoadError
  try {
    const mod = require('node-pty') as PtyModule
    ptyModule = mod
    return mod
  } catch (err) {
    const wrapped = new Error(
      `[terminal] node-pty failed to load — run \`electron-rebuild -f -w node-pty\` to build the native binary against Electron's ABI. Original: ${
        (err as Error).message ?? String(err)
      }`
    )
    ;(wrapped as Error & { code?: string }).code = 'TERMINAL_NOT_REBUILT'
    ptyLoadError = wrapped
    throw wrapped
  }
}

export function registerTerminalChannels(): void {
  defineHandler('terminal:spawn', schema.spawn, (req) => {
    const pty = lazyLoadPty()
    const env = buildSpawnEnv(process.env, req.env)
    const { pty: ipty } = spawnPtyWithFallback(pty.spawn, {
      requestedShell: req.shell,
      envShell: process.env.SHELL,
      requestedCwd: req.cwd,
      env,
      cols: req.cols,
      rows: req.rows,
    })

    const sessionId = randomUUID()
    sessions.set(sessionId, { pty: ipty, sessionId })

    ipty.onData((data) => {
      streamBroker.publish(`terminal:${sessionId}:data`, data)
    })
    ipty.onExit((e) => {
      streamBroker.publish(`terminal:${sessionId}:exit`, {
        code: e.exitCode,
        signal: e.signal ?? null,
      })
      sessions.delete(sessionId)
    })

    return { sessionId, pid: ipty.pid }
  })

  defineHandler('terminal:write', schema.write, (req) => {
    const s = sessions.get(req.sessionId)
    if (!s) {
      // Session already exited — silently drop the write.
      return { ok: true as const }
    }
    s.pty.write(req.data)
    return { ok: true as const }
  })

  defineHandler('terminal:resize', schema.resize, (req) => {
    const s = sessions.get(req.sessionId)
    if (!s) {
      // Session already exited — silently drop the resize.
      return { ok: true as const }
    }
    s.pty.resize(req.cols, req.rows)
    return { ok: true as const }
  })

  defineHandler('terminal:kill', schema.kill, (req) => {
    const s = sessions.get(req.sessionId)
    if (!s) {
      // Idempotent: killing an already-dead session is a no-op.
      return { ok: true as const }
    }
    try {
      s.pty.kill()
    } catch {
      // pty may already be dead; the onExit handler will clean up.
    }
    sessions.delete(req.sessionId)
    return { ok: true as const }
  })
}

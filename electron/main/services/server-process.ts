/**
 * Server utilityProcess wrapper.
 *
 * Forks server/dist/index.js as an Electron utilityProcess. The server is the
 * unchanged Hono + relay + PGlite + dispatch engine — we just host it inside
 * the Electron app instead of the Tauri sidecar.
 *
 * Why utilityProcess (not child_process):
 *   - Crashes are isolated from main; we get a structured 'exit' event.
 *   - Cheap MessagePort transfer (Phase 2 will pipe agent streams over it).
 *   - Bound to the Electron app lifecycle: killed on app.quit() automatically,
 *     so we don't strand PGlite holding the data dir lockfile.
 *   - No window — runs headless, uses the bundled Node, no V8 snapshot cost.
 *
 * The supervisor (services/supervisor.ts) wraps this with restart/backoff.
 */

import { app, utilityProcess, type UtilityProcess } from 'electron'
import path from 'node:path'
import { buildServerEnv, resolveServerBundleDir } from '../env.js'

export interface ServerProcessHandle {
  proc: UtilityProcess
  port: number
  relayPort: number
}

export interface StartServerOptions {
  /** Override the default health-check timeout (ms). */
  healthTimeoutMs?: number
}

const DEFAULT_HEALTH_TIMEOUT_MS = 15_000

/**
 * Spawn the server utilityProcess and wait for /api/health to respond.
 * Throws if the process exits before becoming healthy or if health check
 * times out — fail-fast per the project's error-handling rule.
 */
export async function startServerProcess(
  options: StartServerOptions = {}
): Promise<ServerProcessHandle> {
  const env = buildServerEnv()
  const bundleDir = resolveServerBundleDir()
  const entry = path.join(bundleDir, 'index.js')

  console.log('[server-process] forking', entry)

  const proc = utilityProcess.fork(entry, [], {
    serviceName: 'astro-server',
    env,
    stdio: 'pipe',
    // cwd matters for any server code that resolves relative paths.
    cwd: bundleDir,
  })

  // Pipe child stdio to main process logs. Phase 1: noisy is fine; Phase 2
  // routes through a structured logger.
  proc.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[server] ${chunk}`)
  })
  proc.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[server!] ${chunk}`)
  })

  const port = Number(env.PORT)
  const relayPort = Number(env.RELAY_PORT)

  // Race: process exits early vs health check passes.
  const healthTimeoutMs = options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS
  await waitForHealthy(proc, port, healthTimeoutMs)

  console.log(`[server-process] healthy on :${port} (relay :${relayPort})`)
  return { proc, port, relayPort }
}

/**
 * Poll http://127.0.0.1:<port>/api/health until it responds 200 or the
 * process exits or we time out. Uses fetch with AbortController so a hung
 * server doesn't keep us waiting past the deadline.
 */
async function waitForHealthy(
  proc: UtilityProcess,
  port: number,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let exited = false
  let exitCode: number | null = null

  proc.once('exit', (code) => {
    exited = true
    exitCode = code
  })

  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`server utilityProcess exited (code=${exitCode}) before becoming healthy`)
    }
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 1500)
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: ctrl.signal,
      }).catch(() => null)
      clearTimeout(timer)
      if (res && res.ok) return
    } catch {
      // swallow — retry until deadline
    }
    await sleep(250)
  }

  throw new Error(`server utilityProcess health check timed out after ${timeoutMs}ms`)
}

/**
 * Graceful shutdown: SIGTERM, wait, SIGKILL fallback. Critical for PGlite —
 * leaving a stale process holding the lockfile breaks the next launch.
 */
export async function stopServerProcess(handle: ServerProcessHandle): Promise<void> {
  const { proc } = handle
  if (proc.pid == null) return

  console.log('[server-process] stopping pid', proc.pid)
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()))

  proc.kill() // SIGTERM
  const result = await Promise.race([
    exited.then(() => 'clean' as const),
    sleep(5000).then(() => 'timeout' as const),
  ])

  if (result === 'timeout') {
    console.warn('[server-process] SIGTERM ignored, sending SIGKILL')
    try {
      // Electron's UtilityProcess.kill() doesn't take a signal; use process.kill.
      if (proc.pid != null) process.kill(proc.pid, 'SIGKILL')
    } catch {
      // already dead
    }
    await exited
  }
  console.log('[server-process] stopped')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Belt-and-suspenders: ensure we kill the server when Electron quits even
// if the supervisor forgot.
app.on('will-quit', () => {
  // No-op here — supervisor owns the handle. Kept for future hardening.
})

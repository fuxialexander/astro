/**
 * Service supervisor.
 *
 * Owns the server utilityProcess handle and restarts it on crash with
 * exponential backoff. Single instance — there's only one server.
 *
 * Lifecycle:
 *   await supervisor.start()    // boot once during app.whenReady
 *   supervisor.status()         // 'starting' | 'running' | 'crashed' | 'stopped'
 *   await supervisor.stop()     // before app.quit, to avoid stale PGlite locks
 *
 * Phase 1 keeps this minimal: no UI surface yet, just console logs. Phase 2
 * exposes status over the typed IPC channel `server:status` so the renderer
 * can show "server restarting…" badges.
 */

import { startServerProcess, stopServerProcess, type ServerProcessHandle } from './server-process.js'

export type SupervisorStatus = 'idle' | 'starting' | 'running' | 'crashed' | 'stopped'

const RESTART_BASE_MS = 500
const RESTART_MAX_MS = 30_000
// Crashes within this window of a successful start are treated as flapping.
const FLAP_WINDOW_MS = 10_000

class ServerSupervisor {
  private handle: ServerProcessHandle | null = null
  private status_: SupervisorStatus = 'idle'
  private restartAttempt = 0
  private lastStartedAt = 0
  private stopping = false

  status(): SupervisorStatus {
    return this.status_
  }

  port(): number | null {
    return this.handle?.port ?? null
  }

  relayPort(): number | null {
    return this.handle?.relayPort ?? null
  }

  async start(): Promise<void> {
    if (this.status_ === 'running' || this.status_ === 'starting') return
    this.stopping = false
    await this.spawn()
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.handle) {
      const h = this.handle
      this.handle = null
      this.status_ = 'stopped'
      await stopServerProcess(h)
    }
  }

  private async spawn(): Promise<void> {
    this.status_ = 'starting'
    try {
      this.handle = await startServerProcess()
      this.status_ = 'running'
      this.lastStartedAt = Date.now()
      this.wireExitHandler()
      // Reset backoff on a clean boot. We only consider the start fully
      // successful once we've stayed up past the flap window.
      setTimeout(() => {
        if (this.status_ === 'running') this.restartAttempt = 0
      }, FLAP_WINDOW_MS)
    } catch (err) {
      this.status_ = 'crashed'
      console.error('[supervisor] server start failed:', err)
      if (!this.stopping) this.scheduleRestart()
      else throw err
    }
  }

  private wireExitHandler(): void {
    if (!this.handle) return
    this.handle.proc.once('exit', (code) => {
      const wasRunning = this.status_ === 'running'
      this.handle = null
      if (this.stopping) {
        this.status_ = 'stopped'
        return
      }
      console.warn(`[supervisor] server exited (code=${code}); was running=${wasRunning}`)
      this.status_ = 'crashed'
      this.scheduleRestart()
    })
  }

  private scheduleRestart(): void {
    this.restartAttempt += 1
    const delay = Math.min(
      RESTART_MAX_MS,
      RESTART_BASE_MS * 2 ** (this.restartAttempt - 1)
    )
    console.log(`[supervisor] restart #${this.restartAttempt} in ${delay}ms`)
    setTimeout(() => {
      if (this.stopping) return
      void this.spawn().catch((err) => {
        console.error('[supervisor] restart failed:', err)
      })
    }, delay)
  }
}

export const serverSupervisor = new ServerSupervisor()

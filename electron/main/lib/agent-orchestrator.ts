/**
 * Long-running astro-agent process supervisor.
 *
 * The desktop app spawns `astro-agent start` as a child node process and
 * keeps it alive across the lifetime of the app session. This module is the
 * single owner: it tracks the pid, captures a rolling stdout/stderr buffer,
 * and auto-restarts up to 3 times if the process dies within 30s of spawn.
 *
 * No PTY — we use plain `child_process.spawn` with piped stdio.
 *
 * Idempotent: callers can hammer `start()` and it will return the existing
 * pid if the process is already running.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const LOG_BUFFER_MAX = 200
const EARLY_EXIT_WINDOW_MS = 30_000
const MAX_RESTARTS = 3

interface OrchestratorState {
  child: ChildProcess | null
  pid: number | null
  lastError: string | null
  startedAt: number | null
  restarts: number
  log: string[]
  starting: boolean
}

const state: OrchestratorState = {
  child: null,
  pid: null,
  lastError: null,
  startedAt: null,
  restarts: 0,
  log: [],
  starting: false,
}

function pushLog(line: string): void {
  // Split on newlines, drop empties, keep newest LOG_BUFFER_MAX.
  for (const part of line.split(/\r?\n/)) {
    const trimmed = part.replace(/\s+$/u, '')
    if (!trimmed) continue
    state.log.push(trimmed)
    if (state.log.length > LOG_BUFFER_MAX) {
      state.log.splice(0, state.log.length - LOG_BUFFER_MAX)
    }
  }
}

export function getRecentAgentLog(): string[] {
  return state.log.slice()
}

function resolveAgentEntry(): string | null {
  const home = homedir()
  // Same install pattern as channels/agent.ts (binDir).
  const candidates = [
    join(home, '.astro', 'bin', 'astro-agent.mjs'),
    join(home, '.astro', 'bin', 'astro-agent'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

export interface StartResult {
  ok: boolean
  pid: number | null
  error: string | null
}

export interface LocalStatus {
  running: boolean
  pid: number | null
  lastError: string | null
}

export function getLocalStatus(): LocalStatus {
  return {
    running: state.child !== null && state.pid !== null,
    pid: state.pid,
    lastError: state.lastError,
  }
}

function clearChild(): void {
  state.child = null
  state.pid = null
  state.startedAt = null
}

function spawnOnce(entry: string): { child: ChildProcess; error: string | null } {
  // .mjs files carry shebangs on Unix and can be invoked directly via
  // `node <path>`. Use node explicitly for portability.
  const child = spawn(process.execPath, [entry, 'start'], {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Ensure agent uses Node, not Electron, for any spawned subprocesses.
      ELECTRON_RUN_AS_NODE: '1',
    },
  })

  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => pushLog(chunk))
  child.stderr?.on('data', (chunk: string) => {
    pushLog(chunk)
    // Track most-recent stderr line as last error candidate.
    const lines = chunk.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    if (lines.length > 0) state.lastError = lines[lines.length - 1].slice(0, 500)
  })

  return { child, error: null }
}

function attachLifecycle(child: ChildProcess): void {
  child.on('error', (err) => {
    state.lastError = `spawn error: ${err.message}`
    pushLog(`[agent] spawn error: ${err.message}`)
  })
  child.on('exit', (code, signal) => {
    const ranFor = state.startedAt ? Date.now() - state.startedAt : 0
    pushLog(`[agent] exited code=${code ?? '?'} signal=${signal ?? '-'} after ${ranFor}ms`)
    const wasEarly = ranFor < EARLY_EXIT_WINDOW_MS
    clearChild()

    if (wasEarly && state.restarts < MAX_RESTARTS) {
      state.restarts += 1
      pushLog(`[agent] auto-restart ${state.restarts}/${MAX_RESTARTS}`)
      // Defer slightly so we don't hot-loop.
      setTimeout(() => {
        void start().catch(() => {
          /* error already captured into lastError */
        })
      }, 500)
    } else if (wasEarly) {
      state.lastError = state.lastError ?? `agent exited early (code=${code ?? signal ?? '?'})`
    }
  })
}

export async function start(): Promise<StartResult> {
  if (state.child && state.pid) {
    return { ok: true, pid: state.pid, error: null }
  }
  if (state.starting) {
    // Another start in flight — return current state best-effort.
    return { ok: state.pid !== null, pid: state.pid, error: state.lastError }
  }
  state.starting = true
  try {
    const entry = resolveAgentEntry()
    if (!entry) {
      const err = 'astro-agent not installed (~/.astro/bin/astro-agent.mjs missing). Run setup first.'
      state.lastError = err
      return { ok: false, pid: null, error: err }
    }

    let spawnErr: string | null = null
    let child: ChildProcess
    try {
      const r = spawnOnce(entry)
      child = r.child
      spawnErr = r.error
    } catch (err) {
      const msg = (err as Error).message ?? String(err)
      state.lastError = msg
      return { ok: false, pid: null, error: msg }
    }

    if (!child.pid) {
      const msg = spawnErr ?? 'spawn returned no pid'
      state.lastError = msg
      return { ok: false, pid: null, error: msg }
    }

    state.child = child
    state.pid = child.pid
    state.startedAt = Date.now()
    attachLifecycle(child)

    // Brief wait window: if the process dies within 5s, surface the error.
    const earlyError = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000)
      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        resolve(`agent exited within 5s: code=${code ?? '?'} signal=${signal ?? '-'}`)
      })
      child.once('error', (err) => {
        clearTimeout(timer)
        resolve(`agent spawn error: ${err.message}`)
      })
    })

    if (earlyError) {
      state.lastError = earlyError
      return { ok: false, pid: null, error: earlyError }
    }

    state.lastError = null
    return { ok: true, pid: state.pid, error: null }
  } finally {
    state.starting = false
  }
}

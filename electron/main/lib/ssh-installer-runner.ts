/**
 * Drives `astro-agent ssh-install` per remote host, parses NDJSON progress
 * from stdout, and republishes it on the renderer-facing
 * `onboarding:host-progress` broker channel.
 *
 * For each alias the flow is:
 *   1. Read this user's existing accessToken from ~/.astro/config.json so
 *      we can authenticate a register-on-behalf call.
 *   2. POST /api/device/register with a remote-specific machineId; the
 *      server returns a fresh accessToken/refreshToken/wsToken bound to
 *      that machine.
 *   3. Spawn the bundled `astro-agent ssh-install --host <alias>` and pipe
 *      the token bundle to its stdin as JSON.
 *   4. Read NDJSON from stdout line-by-line, map each event to a host
 *      state, and publish on the broker. The renderer's row-level state
 *      machine consumes these directly.
 *
 * Concurrency is capped — large fan-outs over SSH can saturate the
 * upstream link and confuse some npm registries.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { app } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { streamBroker } from '../ipc/broker.js'
import { registerMachine, type MachineInfoForRegister } from './device-auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const HOST_PROGRESS_CHANNEL = 'onboarding:host-progress'
const MAX_CONCURRENT_INSTALLS = 3

export type HostState =
  | 'testing'
  | 'installing'
  | 'registering'
  | 'starting'
  | 'connected'
  | 'failed'
  | 'needs-manual'

interface HostProgress {
  alias: string
  state: HostState
  message?: string
}

function publishProgress(p: HostProgress): void {
  streamBroker.publish(HOST_PROGRESS_CHANNEL, p)
}

// ─── Binary resolution ─────────────────────────────────────────────────────

function resolveBundledAgent(): string | null {
  if (app.isPackaged) {
    const p = join(process.resourcesPath, 'binaries', 'astro-agent.mjs')
    return existsSync(p) ? p : null
  }
  // dev: electron/dist/main/lib/ssh-installer-runner.js → up to electron/resources/binaries
  const dev = path.resolve(__dirname, '../../../../electron/resources/binaries/astro-agent.mjs')
  return existsSync(dev) ? dev : null
}

function resolveAgentBinary(): string | null {
  // Prefer the user-installed copy (chmoded executable on Unix; .mjs on Windows).
  const home = homedir()
  const installed = [
    join(home, '.astro', 'bin', 'astro-agent'),
    join(home, '.astro', 'bin', 'astro-agent.mjs'),
  ]
  for (const c of installed) {
    if (existsSync(c)) return c
  }
  return resolveBundledAgent()
}

// ─── Local config & token bundle ───────────────────────────────────────────

interface LocalConfig {
  accessToken?: string
  apiUrl?: string
  relayUrl?: string
  machineId?: string
}

function readLocalConfig(): LocalConfig {
  const p = join(homedir(), '.astro', 'config.json')
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as LocalConfig
  } catch {
    return {}
  }
}

interface RemoteTokenBundle {
  accessToken: string
  refreshToken: string
  wsToken: string
  machineId: string
  apiUrl: string
  relayUrl: string
}

function deriveRemoteMachineId(alias: string, localMachineId: string): string {
  // Seed includes the local machineId so two teammates registering the same
  // alias (e.g. shared "my-cluster") produce different remote IDs. Without
  // this, /api/device/register would upsert one over the other and silently
  // disconnect whichever user registered first. `hostname()` alone is not
  // enough — laptops have generic names ("MacBook-Pro") that collide.
  const seed = `${localMachineId}|${hostname()}|remote|${alias}`
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, 32)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
}

async function registerRemoteOnBehalf(alias: string): Promise<RemoteTokenBundle> {
  const local = readLocalConfig()
  if (!local.accessToken) {
    throw new Error('Local agent is not authenticated yet. Complete "Connect this Mac" first.')
  }
  if (!local.machineId) {
    throw new Error('Local machineId missing from ~/.astro/config.json — re-run "Connect this Mac" to repair.')
  }
  const machineId = deriveRemoteMachineId(alias, local.machineId)
  const info: MachineInfoForRegister = {
    machineId,
    hostname: alias,
    name: alias,
    platform: 'remote',
    providers: [],
    resources: { cpus: 0, totalMemBytes: 0 },
  }
  const reg = await registerMachine(local.accessToken, info)
  if (!reg.accessToken || !reg.refreshToken) {
    throw new Error(
      'Server did not return remote-scoped tokens. The /api/device/register endpoint must return accessToken + refreshToken for register-on-behalf to work.',
    )
  }
  // Fail loud if the relay token is missing — without it the remote agent
  // cannot connect to the relay and the user would see a brief "connected"
  // state followed by an inert machine. Surface the failure so the SSH
  // step's row goes to `failed` instead.
  if (!reg.wsToken) {
    throw new Error(
      'Server did not return a wsToken — relay token issuance failed; check server logs for /api/device/register.',
    )
  }
  return {
    accessToken: reg.accessToken,
    refreshToken: reg.refreshToken,
    wsToken: reg.wsToken,
    machineId: reg.machineId,
    apiUrl: reg.apiUrl ?? local.apiUrl ?? '',
    relayUrl: reg.relayUrl ?? local.relayUrl ?? '',
  }
}

// ─── NDJSON event mapping ──────────────────────────────────────────────────

interface NdjsonStep { event: 'step'; name: string; message: string }
interface NdjsonDone { event: 'done'; machineId: string; agentStatus?: unknown }
interface NdjsonError { event: 'error'; code: string; message: string }
type NdjsonEvent = NdjsonStep | NdjsonDone | NdjsonError

function classifyStep(name: string): HostState {
  if (name === 'preflight') return 'testing'
  if (name === 'pack' || name === 'upload' || name === 'install' || name === 'configure' || name === 'install-done') {
    return 'installing'
  }
  if (name === 'stop-existing' || name === 'start' || name === 'verify') return 'starting'
  return 'installing'
}

function isAuthRequiredError(e: NdjsonError): boolean {
  return e.code === 'auth-required'
}

/**
 * Strip token-shaped values from any text we publish on the broker. The child
 * process never logs tokens deliberately, but uncaught exceptions in
 * agent-runner can stringify their context and a token bundle could leak into
 * stderr. Anything we surface to the renderer must be scrubbed first.
 *
 * Patterns covered:
 *   - JSON: `"accessToken":"…"` (quoted key, optional whitespace)
 *   - YAML/env: `accessToken: foo`, `ACCESS_TOKEN=foo`
 *   - Bare token-looking strings near a token keyword on the same line
 */
function scrubTokens(s: string): string {
  if (!s) return s
  return s.replace(
    /(["']?(?:access[_-]?token|refresh[_-]?token|ws[_-]?token|bearer)["']?\s*[:=]\s*["']?)([A-Za-z0-9._\-+/=]+)(["']?)/gi,
    '$1<redacted>$3',
  )
}

// ─── Process registry (cleanup on app quit) ────────────────────────────────

const activeChildren = new Set<ReturnType<typeof spawn>>()
let quitHookRegistered = false

function registerQuitHook(): void {
  if (quitHookRegistered) return
  quitHookRegistered = true
  // Kill any in-flight ssh-install children so we don't leave half-installed
  // remote agents when the user force-quits the desktop app. SIGTERM gives
  // each child a chance to clean up its scp/ssh subprocesses.
  app.on('before-quit', () => {
    for (const c of activeChildren) {
      try {
        c.kill('SIGTERM')
      } catch {
        // already exited
      }
    }
  })
}

// ─── Spawn + parse loop ────────────────────────────────────────────────────

async function runOneHost(alias: string): Promise<void> {
  const trimmed = alias.trim()
  if (!trimmed) {
    publishProgress({ alias, state: 'failed', message: 'empty alias' })
    return
  }

  publishProgress({ alias, state: 'registering' })

  let tokens: RemoteTokenBundle
  try {
    tokens = await registerRemoteOnBehalf(trimmed)
  } catch (err) {
    publishProgress({
      alias,
      state: 'failed',
      message: `register failed: ${(err as Error).message ?? String(err)}`,
    })
    return
  }

  const bin = resolveAgentBinary()
  if (!bin) {
    publishProgress({
      alias,
      state: 'failed',
      message: 'astro-agent binary not found — run the connect step first or rebuild the desktop app.',
    })
    return
  }

  const child = spawn(bin, ['ssh-install', '--host', trimmed], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  activeChildren.add(child)

  child.stdin.write(JSON.stringify(tokens))
  child.stdin.end()

  let saw: 'done' | 'error' | null = null
  let lastErrorMessage: string | null = null
  let stderrTail = ''

  // Buffer-then-split so a partial chunk doesn't break a line.
  let buf = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buf += chunk
    let nl
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let ev: NdjsonEvent
      try {
        ev = JSON.parse(line) as NdjsonEvent
      } catch {
        // Skip anything that isn't a structured event. Stray writes from
        // dependent libraries (e.g. provider-detect noise) shouldn't kill us.
        continue
      }
      if (ev.event === 'step') {
        publishProgress({
          alias,
          state: classifyStep(ev.name),
          message: scrubTokens(ev.message),
        })
      } else if (ev.event === 'done') {
        saw = 'done'
        publishProgress({ alias, state: 'connected' })
      } else if (ev.event === 'error') {
        saw = 'error'
        lastErrorMessage = ev.message
        publishProgress({
          alias,
          state: isAuthRequiredError(ev) ? 'needs-manual' : 'failed',
          message: scrubTokens(ev.message),
        })
      }
    }
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    // Keep a small tail so we can surface it if the process dies without
    // emitting a terminal NDJSON event.
    stderrTail = (stderrTail + chunk).slice(-2000)
  })

  await new Promise<void>((resolve) => {
    child.on('close', (code) => {
      activeChildren.delete(child)
      if (saw === null) {
        // No terminal event reached us — treat as failure with whatever
        // stderr we captured (scrubbed of any token-shaped values that may
        // have leaked into a stack trace or diagnostic dump).
        publishProgress({
          alias,
          state: 'failed',
          message:
            scrubTokens(stderrTail.trim()) ||
            `ssh-install exited ${code ?? '?'} without emitting a result event`,
        })
      } else if (saw === 'error' && lastErrorMessage === null) {
        // Defensive: error event arrived but we lost the message somehow.
        publishProgress({ alias, state: 'failed', message: 'unknown failure' })
      }
      resolve()
    })
    child.on('error', (err) => {
      activeChildren.delete(child)
      publishProgress({ alias, state: 'failed', message: scrubTokens(err.message) })
      resolve()
    })
  })
}

// ─── Concurrency-limited fan-out ───────────────────────────────────────────

export async function installAndRegisterHosts(aliases: string[]): Promise<void> {
  registerQuitHook()
  const queue = aliases.slice()
  const workers: Promise<void>[] = []
  const next = async (): Promise<void> => {
    while (queue.length > 0) {
      const alias = queue.shift()!
      await runOneHost(alias)
    }
  }
  for (let i = 0; i < Math.min(MAX_CONCURRENT_INSTALLS, queue.length); i++) {
    workers.push(next())
  }
  await Promise.all(workers)
}

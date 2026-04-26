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

function deriveRemoteMachineId(alias: string): string {
  // Stable per-(local-machine, remote-alias) so re-registration is idempotent.
  // sha256 keeps it consistent with the local machine-id derivation.
  const seed = `${hostname()}|remote|${alias}`
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, 32)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
}

async function registerRemoteOnBehalf(alias: string): Promise<RemoteTokenBundle> {
  const local = readLocalConfig()
  if (!local.accessToken) {
    throw new Error('Local agent is not authenticated yet. Complete "Connect this Mac" first.')
  }
  const machineId = deriveRemoteMachineId(alias)
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
      'Server did not return remote-scoped tokens. Update the server or use the local accessToken (less safe).',
    )
  }
  return {
    accessToken: reg.accessToken,
    refreshToken: reg.refreshToken,
    wsToken: reg.wsToken ?? '',
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
          message: ev.message,
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
          message: ev.message,
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
      if (saw === null) {
        // No terminal event reached us — treat as failure with whatever
        // stderr we captured.
        publishProgress({
          alias,
          state: 'failed',
          message:
            stderrTail.trim() ||
            `ssh-install exited ${code ?? '?'} without emitting a result event`,
        })
      } else if (saw === 'error' && lastErrorMessage === null) {
        // Defensive: error event arrived but we lost the message somehow.
        publishProgress({ alias, state: 'failed', message: 'unknown failure' })
      }
      resolve()
    })
    child.on('error', (err) => {
      publishProgress({ alias, state: 'failed', message: err.message })
      resolve()
    })
  })
}

// ─── Concurrency-limited fan-out ───────────────────────────────────────────

export async function installAndRegisterHosts(aliases: string[]): Promise<void> {
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

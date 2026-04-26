/**
 * Agent binary setup channels.
 *
 * The Electron app bundles astro-agent.mjs and astro-cli.mjs in
 * resources/binaries/ (via extraResources in forge.config.ts). These channels
 * let the renderer check setup status and trigger first-run installation,
 * which copies those bundles to ~/.astro/bin/ and adds that directory to
 * the user's shell PATH.
 *
 * Platform notes:
 *   macOS / Linux — installs to ~/.astro/bin, updates ~/.zshrc / ~/.bashrc
 *   Windows — installs to %USERPROFILE%\.astro\bin (PATH update via setx)
 */

import { existsSync, mkdirSync, copyFileSync, chmodSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir, hostname, platform } from 'node:os'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { app, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/agent.js'
import * as onboardingSchema from '../schema/onboarding.js'
import { streamBroker } from '../broker.js'
import {
  startDeviceAuth,
  pollDeviceToken,
  registerMachine,
  type MachineInfoForRegister,
} from '../../lib/device-auth.js'
import { detectAllProviders } from '../../lib/provider-detect.js'
import {
  start as startAgent,
  getLocalStatus,
} from '../../lib/agent-orchestrator.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ─── Path resolution ────────────────────────────────────────────────────────

/** Where the bundled .mjs files live inside the app package (or repo in dev). */
function resolveBundlesDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'binaries')
  }
  // dev: electron/dist/main/channels/agent.js → ../../../../../electron/resources/binaries
  return resolve(__dirname, '../../../../electron/resources/binaries')
}

/** Where installed binaries live on the user's machine. */
function binDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'astro', 'bin')
  }
  return join(homedir(), '.astro', 'bin')
}

function installedPath(name: string): string {
  return join(binDir(), process.platform === 'win32' ? `${name}.cmd` : name)
}

function bundlePath(name: string): string {
  const ext = name === 'astro-agent' ? 'astro-agent.mjs' : 'astro-cli.mjs'
  return join(resolveBundlesDir(), ext)
}

// ─── PATH detection ─────────────────────────────────────────────────────────

function isPathConfigured(): boolean {
  const bin = binDir()
  // The user's shell PATH at this point may not include ~/.astro/bin yet,
  // so we check by probing whether the binary resolves via `which`/`where`.
  try {
    if (process.platform === 'win32') {
      execSync('where astro-agent', { stdio: 'pipe' })
    } else {
      execSync('which astro-agent', { stdio: 'pipe', env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` } })
      // Also verify it's truly on the system PATH (not just our injected one)
      execSync('which astro-agent', { stdio: 'pipe' })
    }
    return true
  } catch {
    return false
  }
}

// ─── Shell profile update ────────────────────────────────────────────────────

const PATH_EXPORT = (bin: string) => `\n# Added by Astro desktop app\nexport PATH="$PATH:${bin}"\n`
const PATH_COMMENT_MARKER = '# Added by Astro desktop app'

function shellProfileCandidates(): string[] {
  const home = homedir()
  return [
    join(home, '.zshrc'),
    join(home, '.bashrc'),
    join(home, '.bash_profile'),
    join(home, '.profile'),
  ]
}

function updateShellProfiles(bin: string): string[] {
  const updated: string[] = []
  for (const profile of shellProfileCandidates()) {
    if (!existsSync(profile)) continue
    const content = readFileSync(profile, 'utf8')
    if (content.includes(PATH_COMMENT_MARKER)) continue // already present
    appendFileSync(profile, PATH_EXPORT(bin), 'utf8')
    updated.push(profile)
  }
  return updated
}

function updateWindowsPath(bin: string): string[] {
  try {
    execSync(`setx PATH "%PATH%;${bin}"`, { stdio: 'pipe' })
    return ['Windows Registry (setx)']
  } catch {
    return []
  }
}

// ─── Handlers ───────────────────────────────────────────────────────────────

export function registerAgentChannels(): void {
  defineHandler('agent:binary-paths', schema.binaryPaths, () => {
    const bundlesDir = resolveBundlesDir()
    return {
      bundledAgentPath: join(bundlesDir, 'astro-agent.mjs'),
      bundledCliPath: join(bundlesDir, 'astro-cli.mjs'),
      installedAgentPath: existsSync(installedPath('astro-agent')) ? installedPath('astro-agent') : null,
      installedCliPath: existsSync(installedPath('astro-cli')) ? installedPath('astro-cli') : null,
    }
  })

  defineHandler('agent:setup-status', schema.setupStatus, () => {
    const bin = binDir()
    const agentPath = installedPath('astro-agent')
    const cliPath = installedPath('astro-cli')
    const agentInstalled = existsSync(agentPath)
    const cliInstalled = existsSync(cliPath)
    return {
      installed: agentInstalled && cliInstalled,
      binDir: bin,
      agentPath: agentInstalled ? agentPath : null,
      cliPath: cliInstalled ? cliPath : null,
      pathConfigured: isPathConfigured(),
    }
  })

  defineHandler('agent:setup', schema.setup, () => {
    const bin = binDir()
    mkdirSync(bin, { recursive: true })

    // Copy bundled .mjs files to the bin directory.
    const agentBundle = bundlePath('astro-agent')
    const cliBundle = bundlePath('astro-cli')

    if (!existsSync(agentBundle)) {
      throw new Error(`Bundled astro-agent not found at ${agentBundle}. Run npm run build:binaries first.`)
    }
    if (!existsSync(cliBundle)) {
      throw new Error(`Bundled astro-cli not found at ${cliBundle}. Run npm run build:binaries first.`)
    }

    const agentDest = installedPath('astro-agent')
    const cliDest = installedPath('astro-cli')

    if (process.platform === 'win32') {
      // On Windows, create .cmd wrappers that delegate to node <bundle>.
      const agentMjs = join(bin, 'astro-agent.mjs')
      const cliMjs = join(bin, 'astro-cli.mjs')
      copyFileSync(agentBundle, agentMjs)
      copyFileSync(cliBundle, cliMjs)
      writeFileSync(agentDest, `@echo off\nnode "%~dp0astro-agent.mjs" %*\n`, 'utf8')
      writeFileSync(cliDest, `@echo off\nnode "%~dp0astro-cli.mjs" %*\n`, 'utf8')
    } else {
      // On Unix, the .mjs files already carry #!/usr/bin/env node shebangs.
      copyFileSync(agentBundle, agentDest)
      copyFileSync(cliBundle, cliDest)
      chmodSync(agentDest, 0o755)
      chmodSync(cliDest, 0o755)
    }

    const shellProfilesUpdated =
      process.platform === 'win32' ? updateWindowsPath(bin) : updateShellProfiles(bin)

    return {
      ok: true as const,
      agentPath: agentDest,
      cliPath: cliDest,
      binDir: bin,
      shellProfilesUpdated,
    }
  })

  registerOnboardingAgentChannels()
}

// ─── Device-auth + local-agent helpers ──────────────────────────────────────

const ONBOARDING_BROKER_CHANNEL = 'onboarding:device-auth'

/** Tracks the in-flight device-auth poll loop so we can cancel it. */
let activePollAbort: { cancelled: boolean } | null = null
/** Tracks the userCode of the in-flight device-auth session so the renderer
 * can trigger an explicit one-shot poll ("Verify now") if the timer-based
 * loop appears stuck. */
let activeUserCode: string | null = null

function astroDir(): string {
  return join(homedir(), '.astro')
}

function machineIdPath(): string {
  return join(astroDir(), 'machine-id')
}

function configPath(): string {
  return join(astroDir(), 'config.json')
}

function getOrCreateMachineId(): string {
  try {
    if (existsSync(machineIdPath())) {
      const v = readFileSync(machineIdPath(), 'utf8').trim()
      if (v.length > 0) return v
    }
  } catch {
    // fall through to regenerate
  }
  // Stable seed first; if disk write fails, fall back to a fresh uuid.
  const seed = `${hostname()}|${platform()}`
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, 32)
  // Format hash as UUID-like string (8-4-4-4-12).
  const uuid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
  try {
    mkdirSync(astroDir(), { recursive: true })
    writeFileSync(machineIdPath(), uuid, 'utf8')
  } catch {
    return randomUUID()
  }
  return uuid
}

function getMachineResources(): { cpus: number; totalMemBytes: number } {
  return {
    cpus: os.cpus()?.length ?? 1,
    totalMemBytes: os.totalmem(),
  }
}

interface AstroConfigShape {
  machineId?: string
  accessToken?: string
  refreshToken?: string
  wsToken?: string
  apiUrl?: string
  relayUrl?: string
  setupCompleted?: boolean
  [k: string]: unknown
}

function writeAstroConfig(patch: AstroConfigShape): void {
  mkdirSync(astroDir(), { recursive: true })
  let existing: AstroConfigShape = {}
  if (existsSync(configPath())) {
    try {
      existing = JSON.parse(readFileSync(configPath(), 'utf8')) as AstroConfigShape
    } catch {
      existing = {}
    }
  }
  const merged = { ...existing, ...patch }
  writeFileSync(configPath(), JSON.stringify(merged, null, 2), 'utf8')
  if (process.platform !== 'win32') {
    try {
      chmodSync(configPath(), 0o600)
    } catch {
      // best-effort
    }
  }
}

function publishAuthState(payload: Record<string, unknown>): void {
  // Sticky: the renderer's ConnectThisMacStep can unmount mid-flow (the
  // astro://auth/callback deep-link triggers a re-render of app-layout),
  // which tears down the broker subscription. By the time it remounts,
  // the early-buffer's 5s TTL may have expired. Sticky retains the last
  // value indefinitely so the new mount can recover via streams.getSticky.
  streamBroker.publish(ONBOARDING_BROKER_CHANNEL, payload, { sticky: true })
}

/** Process one poll result + register-on-success. Shared by the background
 * loop and the explicit "verify now" IPC. Returns the kind so the caller
 * can decide whether to continue polling. */
async function processPollResult(
  userCode: string,
  result: Awaited<ReturnType<typeof pollDeviceToken>>,
): Promise<'pending' | 'slow-down' | 'terminal'> {
  if (result.kind === 'pending') return 'pending'
  if (result.kind === 'slow-down') return 'slow-down'
  if (result.kind === 'error') {
    if (result.error === 'access_denied') publishAuthState({ state: 'denied' })
    else if (result.error === 'expired_token') publishAuthState({ state: 'expired' })
    else publishAuthState({ state: 'error', message: result.message })
    return 'terminal'
  }
  // success — register machine
  try {
    const machineId = getOrCreateMachineId()
    const providers = (await detectAllProviders()).filter((p) => p.installed).map((p) => p.id)
    const info: MachineInfoForRegister = {
      machineId,
      hostname: hostname(),
      name: hostname(),
      platform: platform(),
      providers,
      resources: getMachineResources(),
    }
    const reg = await registerMachine(result.accessToken, info)
    writeAstroConfig({
      machineId: reg.machineId,
      accessToken: reg.accessToken ?? result.accessToken,
      refreshToken: reg.refreshToken ?? result.refreshToken,
      wsToken: reg.wsToken ?? result.wsToken,
      apiUrl: reg.apiUrl,
      relayUrl: reg.relayUrl,
      setupCompleted: true,
    })
    publishAuthState({ state: 'authorized', machineId: reg.machineId })
  } catch (err) {
    publishAuthState({
      state: 'error',
      message: `register failed: ${(err as Error).message ?? String(err)}`,
    })
  }
  // Whether register succeeded or failed, the poll itself reached a terminal
  // outcome — stop the background loop. The renderer's state machine handles
  // both outcomes via `authorized` / `error` events.
  void userCode
  return 'terminal'
}

async function runDeviceAuthPollLoop(opts: {
  userCode: string
  intervalSec: number
  expiresIn: number
  abortRef: { cancelled: boolean }
}): Promise<void> {
  const { userCode, abortRef } = opts
  let interval = Math.max(1, opts.intervalSec)
  const deadline = Date.now() + opts.expiresIn * 1000
  publishAuthState({ state: 'pending' })

  while (!abortRef.cancelled) {
    if (Date.now() > deadline) {
      publishAuthState({ state: 'expired' })
      return
    }
    await new Promise((r) => setTimeout(r, interval * 1000))
    if (abortRef.cancelled) return

    let result
    try {
      result = await pollDeviceToken(userCode)
    } catch (err) {
      publishAuthState({
        state: 'network-error',
        message: (err as Error).message ?? String(err),
      })
      continue
    }

    const outcome = await processPollResult(userCode, result)
    if (outcome === 'pending') continue
    if (outcome === 'slow-down') {
      interval = interval + 5
      continue
    }
    return // terminal — authorized, denied, expired, error, or registered
  }
}

function registerOnboardingAgentChannels(): void {
  defineHandler('agent:device-auth-start', onboardingSchema.deviceAuthStart, async () => {
    // Cancel any pre-existing poll loop before starting a new one.
    if (activePollAbort) activePollAbort.cancelled = true
    const abortRef = { cancelled: false }
    activePollAbort = abortRef
    activeUserCode = null
    // Don't let a terminal value from a previous session (e.g. 'authorized')
    // pre-resolve the new flow when the renderer probes via getSticky.
    streamBroker.clearSticky(ONBOARDING_BROKER_CHANNEL)

    const auth = await startDeviceAuth({ hostname: hostname(), platform: platform() })
    activeUserCode = auth.userCode

    // Open the verification URL in the user's default browser.
    try {
      await shell.openExternal(auth.verificationUriComplete)
    } catch {
      // non-fatal — the renderer also shows the URL/code
    }

    // Kick off polling in the background; we return immediately.
    void runDeviceAuthPollLoop({
      userCode: auth.userCode,
      intervalSec: auth.interval ?? 5,
      expiresIn: auth.expiresIn,
      abortRef,
    }).catch((err) => {
      publishAuthState({
        state: 'error',
        message: (err as Error).message ?? String(err),
      })
    })

    return {
      deviceCode: auth.deviceCode,
      userCode: auth.userCode,
      verificationUriComplete: auth.verificationUriComplete,
      expiresIn: auth.expiresIn,
    }
  })

  defineHandler('agent:device-auth-cancel', onboardingSchema.deviceAuthCancel, () => {
    if (activePollAbort) {
      activePollAbort.cancelled = true
      activePollAbort = null
    }
    activeUserCode = null
    streamBroker.clearSticky(ONBOARDING_BROKER_CHANNEL)
    return { ok: true as const }
  })

  // Lightweight check: does ~/.astro/config.json already contain a complete
  // token bundle? Used by the renderer to detect a previously-successful
  // sign-in (e.g., from a prior session, or a race where the broker
  // publish was lost) so we can skip the connect step instead of
  // re-running it.
  defineHandler('agent:auth-state', onboardingSchema.authState, () => {
    if (!existsSync(configPath())) {
      return { authed: false, machineId: null }
    }
    try {
      const raw = readFileSync(configPath(), 'utf8')
      const cfg = JSON.parse(raw) as AstroConfigShape
      const authed = Boolean(
        cfg.accessToken && cfg.refreshToken && cfg.machineId && cfg.setupCompleted,
      )
      return {
        authed,
        machineId: authed ? (cfg.machineId as string) : null,
      }
    } catch {
      return { authed: false, machineId: null }
    }
  })

  // One-shot poll: the renderer calls this when the user clicks
  // "I clicked Approve — verify now". Useful when the background timer-based
  // poll seems stuck (e.g., a sleep wedge or an event delivery race). Idempotent
  // with the background loop — both paths funnel through processPollResult,
  // which publishes the canonical 'authorized' / 'error' state on success.
  defineHandler('agent:device-auth-verify', onboardingSchema.deviceAuthVerify, async () => {
    if (!activeUserCode) {
      return { kind: 'no-session' as const }
    }
    try {
      const result = await pollDeviceToken(activeUserCode)
      const outcome = await processPollResult(activeUserCode, result)
      if (outcome === 'pending') return { kind: 'pending' as const }
      if (outcome === 'slow-down') return { kind: 'slow-down' as const }
      return { kind: 'terminal' as const }
    } catch (err) {
      const message = (err as Error).message ?? String(err)
      publishAuthState({ state: 'network-error', message })
      return { kind: 'network-error' as const, message }
    }
  })

  defineHandler('agent:start-local', onboardingSchema.startLocal, async () => {
    const r = await startAgent()
    return { ok: r.ok, pid: r.pid, error: r.error }
  })

  defineHandler('agent:local-status', onboardingSchema.localStatus, () => {
    const s = getLocalStatus()
    return { running: s.running, pid: s.pid, lastError: s.lastError }
  })
}

/**
 * Programmatic one-shot poll, triggered by the deep-link handler in
 * electron/main/index.ts when the browser navigates to
 * `astro://device-auth/approved` after the user clicks Approve.
 *
 * Funnels through the same processPollResult as the background loop and the
 * Verify-now IPC, so a success here publishes 'authorized' on the broker
 * and the renderer advances immediately.
 */
export async function triggerImmediateDeviceAuthPoll(): Promise<void> {
  if (!activeUserCode) return
  try {
    const result = await pollDeviceToken(activeUserCode)
    await processPollResult(activeUserCode, result)
  } catch (err) {
    const message = (err as Error).message ?? String(err)
    publishAuthState({ state: 'network-error', message })
  }
}

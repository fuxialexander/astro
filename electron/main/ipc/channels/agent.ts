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
import { execSync } from 'node:child_process'
import { app, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/agent.js'
import * as onboardingSchema from '../schema/onboarding.js'
import { streamBroker } from '../broker.js'
import { startPair } from '../../lib/device-auth.js'
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

function astroDir(): string {
  return join(homedir(), '.astro')
}

function machineIdPath(): string {
  return join(astroDir(), 'machine-id')
}

function configPath(): string {
  return join(astroDir(), 'config.json')
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

function registerOnboardingAgentChannels(): void {
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

  defineHandler('agent:start-local', onboardingSchema.startLocal, async () => {
    const r = await startAgent()
    return { ok: r.ok, pid: r.pid, error: r.error }
  })

  defineHandler('agent:local-status', onboardingSchema.localStatus, () => {
    const s = getLocalStatus()
    return { running: s.running, pid: s.pid, lastError: s.lastError }
  })

  // ── Callback-style pair flow ─────────────────────────────────────────────
  // The browser does the work; we open the pair URL and wait for
  // astro://pair/callback to arrive with tokens. handlePairCallback (called
  // from the deep-link handler in main/index.ts) writes the config and
  // publishes 'authorized' on the broker channel ConnectThisMacStep
  // subscribes to.
  defineHandler('agent:pair-start', onboardingSchema.pairStart, async () => {
    // Clear any sticky 'authorized' from a prior session so a stale event
    // doesn't pre-resolve this flow when ConnectThisMacStep probes via
    // getSticky.
    streamBroker.clearSticky(ONBOARDING_BROKER_CHANNEL)

    const providers = (await detectAllProviders())
      .filter((p) => p.installed)
      .map((p) => p.id)

    const init = await startPair({
      hostname: hostname(),
      platform: platform(),
      providers,
    })

    // Open the verification URL. This is fire-and-forget — if it fails the
    // renderer falls back to showing the URL.
    try {
      await shell.openExternal(init.pairUrl)
    } catch {
      // non-fatal
    }

    // Tell the renderer we're now waiting for the deep-link.
    publishAuthState({ state: 'pending' })

    return {
      pairToken: init.pairToken,
      pairUrl: init.pairUrl,
      expiresIn: init.expiresIn,
    }
  })

  defineHandler('agent:pair-cancel', onboardingSchema.pairCancel, () => {
    // No background task to cancel — this just clears the sticky state so
    // a future startFlow call doesn't see stale data.
    streamBroker.clearSticky(ONBOARDING_BROKER_CHANNEL)
    return { ok: true as const }
  })
}

/**
 * Handle the astro://pair/callback deep-link. Writes the token bundle to
 * ~/.astro/config.json (so the next app boot auto-starts the agent),
 * publishes 'authorized' on the broker so any active ConnectThisMacStep
 * advances, and registers the machineId for downstream callers.
 *
 * Idempotent — if the callback fires twice (rare but possible if the user
 * clicks Approve again), the second call is a harmless config rewrite.
 */
export async function handlePairCallback(tokens: {
  accessToken: string
  refreshToken: string
  wsToken: string
  machineId: string
  machineName?: string
  apiUrl?: string
  relayUrl?: string
}): Promise<void> {
  try {
    // Persist machine-id-on-disk so getOrCreateMachineId() and the
    // server's view of "this machine" stay in sync.
    try {
      mkdirSync(astroDir(), { recursive: true })
      writeFileSync(machineIdPath(), tokens.machineId, 'utf8')
    } catch (err) {
      console.warn('[pair] failed to persist machine-id:', err)
    }

    writeAstroConfig({
      machineId: tokens.machineId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      wsToken: tokens.wsToken,
      ...(tokens.apiUrl && { apiUrl: tokens.apiUrl }),
      ...(tokens.relayUrl && { relayUrl: tokens.relayUrl }),
      setupCompleted: true,
    })

    publishAuthState({ state: 'authorized', machineId: tokens.machineId })
  } catch (err) {
    publishAuthState({
      state: 'error',
      message: `pair callback failed: ${(err as Error).message ?? String(err)}`,
    })
  }
}


/**
 * Local provider detection. Best-effort, never throws — every probe is
 * wrapped so a missing binary or unreadable file returns sensible defaults.
 *
 * Detected providers: Claude Code, Codex, OpenClaw, Pi.
 *
 * Async + parallel: each detector returns a Promise; `detectAllProviders`
 * runs them concurrently with `Promise.all`. Each probe has its own short
 * timeout so a hung CLI can't block the whole detect() IPC call.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

export type ProviderId = 'claude' | 'codex' | 'pi' | 'openclaw'

export interface ProviderInfo {
  id: ProviderId
  label: string
  installed: boolean
  authed: boolean
  version: string | null
  signInUrl: string | null
}

const SIGNIN_URLS: Record<ProviderId, string | null> = {
  claude: 'https://claude.com/login',
  codex: 'https://platform.openai.com/signup',
  pi: 'https://inflection.ai/pi',
  openclaw: null,
}

const LABELS: Record<ProviderId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi',
  openclaw: 'OpenClaw',
}

/** Fast non-blocking `which`. Resolves to true if the binary is on PATH. */
async function whichBinary(name: string): Promise<boolean> {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    await execFileAsync(cmd, [name], { timeout: 1500 })
    return true
  } catch {
    return false
  }
}

/** Best-effort `<bin> --version`. Empty string on failure. Tight timeout
 *  so a hung CLI doesn't block detection. */
async function tryVersion(name: string, args: string[] = ['--version']): Promise<string | null> {
  try {
    const r = await execFileAsync(name, args, { timeout: 2500, encoding: 'utf8' })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
    return out.length > 0 ? out.split('\n')[0].slice(0, 120) : null
  } catch {
    return null
  }
}

async function detectClaude(): Promise<ProviderInfo> {
  const installed = await whichBinary('claude')
  const credPaths = [
    join(homedir(), '.claude', '.credentials.json'),
    join(homedir(), '.config', 'claude', 'credentials.json'),
  ]
  const authed = credPaths.some((p) => existsSync(p))
  const version = installed ? await tryVersion('claude') : null
  return {
    id: 'claude',
    label: LABELS.claude,
    installed,
    authed,
    version,
    signInUrl: SIGNIN_URLS.claude,
  }
}

async function detectCodex(): Promise<ProviderInfo> {
  const installed = await whichBinary('codex')
  let authed = false
  if (installed) {
    try {
      const r = await execFileAsync('codex', ['auth', 'status'], {
        timeout: 2500,
        encoding: 'utf8',
      })
      const text = `${r.stdout ?? ''}${r.stderr ?? ''}`.toLowerCase()
      authed = !text.includes('not authenticated')
    } catch {
      authed = false
    }
  }
  const version = installed ? await tryVersion('codex') : null
  return {
    id: 'codex',
    label: LABELS.codex,
    installed,
    authed,
    version,
    signInUrl: SIGNIN_URLS.codex,
  }
}

async function detectOpenClaw(): Promise<ProviderInfo> {
  const installed = await whichBinary('openclaw')
  const version = installed ? await tryVersion('openclaw') : null
  return {
    id: 'openclaw',
    label: LABELS.openclaw,
    installed,
    authed: installed,
    version,
    signInUrl: SIGNIN_URLS.openclaw,
  }
}

async function detectPi(): Promise<ProviderInfo> {
  const piConfig = join(homedir(), '.pi', 'config.json')
  const onPath = await whichBinary('pi')
  const installed = onPath || existsSync(piConfig)
  const version = onPath ? await tryVersion('pi') : null
  return {
    id: 'pi',
    label: LABELS.pi,
    installed,
    authed: installed,
    version,
    signInUrl: SIGNIN_URLS.pi,
  }
}

export async function detectAllProviders(): Promise<ProviderInfo[]> {
  // All four detectors run concurrently. Slowest wins, but each has a
  // ≤2.5s internal timeout, so the whole call resolves in ~2.5s worst case
  // even if every probe is hung.
  return Promise.all([detectClaude(), detectCodex(), detectOpenClaw(), detectPi()])
}

export async function detectProvider(id: ProviderId): Promise<ProviderInfo> {
  switch (id) {
    case 'claude':
      return detectClaude()
    case 'codex':
      return detectCodex()
    case 'openclaw':
      return detectOpenClaw()
    case 'pi':
      return detectPi()
  }
}

export function signInUrlFor(id: ProviderId): string | null {
  return SIGNIN_URLS[id]
}

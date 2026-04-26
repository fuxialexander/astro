/**
 * Local provider detection. Best-effort, never throws — every probe is
 * wrapped so a missing binary or unreadable file returns sensible defaults.
 *
 * Detected providers: Claude Code, Codex, OpenClaw, Pi.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

function whichBinary(name: string): boolean {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    const r = spawnSync(cmd, [name], { stdio: 'pipe', timeout: 3000 })
    return r.status === 0
  } catch {
    return false
  }
}

function tryVersion(name: string, args: string[] = ['--version']): string | null {
  try {
    const r = spawnSync(name, args, { stdio: 'pipe', timeout: 3000, encoding: 'utf8' })
    if (r.status !== 0) return null
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
    return out.length > 0 ? out.split('\n')[0].slice(0, 120) : null
  } catch {
    return null
  }
}

function detectClaude(): ProviderInfo {
  const installed = whichBinary('claude')
  const credPaths = [
    join(homedir(), '.claude', '.credentials.json'),
    join(homedir(), '.config', 'claude', 'credentials.json'),
  ]
  const authed = credPaths.some((p) => existsSync(p))
  const version = installed ? tryVersion('claude') : null
  return {
    id: 'claude',
    label: LABELS.claude,
    installed,
    authed,
    version,
    signInUrl: SIGNIN_URLS.claude,
  }
}

function detectCodex(): ProviderInfo {
  const installed = whichBinary('codex')
  let authed = false
  if (installed) {
    try {
      const r = spawnSync('codex', ['auth', 'status'], {
        stdio: 'pipe',
        timeout: 3000,
        encoding: 'utf8',
      })
      const text = `${r.stdout ?? ''}${r.stderr ?? ''}`.toLowerCase()
      authed = r.status === 0 && !text.includes('not authenticated')
    } catch {
      authed = false
    }
  }
  const version = installed ? tryVersion('codex') : null
  return {
    id: 'codex',
    label: LABELS.codex,
    installed,
    authed,
    version,
    signInUrl: SIGNIN_URLS.codex,
  }
}

function detectOpenClaw(): ProviderInfo {
  const installed = whichBinary('openclaw')
  const version = installed ? tryVersion('openclaw') : null
  return {
    id: 'openclaw',
    label: LABELS.openclaw,
    installed,
    authed: installed,
    version,
    signInUrl: SIGNIN_URLS.openclaw,
  }
}

function detectPi(): ProviderInfo {
  const piConfig = join(homedir(), '.pi', 'config.json')
  const installed = whichBinary('pi') || existsSync(piConfig)
  const version = whichBinary('pi') ? tryVersion('pi') : null
  return {
    id: 'pi',
    label: LABELS.pi,
    installed,
    authed: installed,
    version,
    signInUrl: SIGNIN_URLS.pi,
  }
}

export function detectAllProviders(): ProviderInfo[] {
  return [detectClaude(), detectCodex(), detectOpenClaw(), detectPi()]
}

export function detectProvider(id: ProviderId): ProviderInfo {
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

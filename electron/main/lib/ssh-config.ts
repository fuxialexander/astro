/**
 * Minimal ~/.ssh/config parser. Re-implemented locally (do not import from
 * the packages/agent-runner submodule). Returns one entry per concrete Host
 * alias. Wildcard patterns and well-known git hosts are skipped.
 */

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface SSHHost {
  alias: string
  hostname: string
  user: string | null
  port: number
  identityFile: string | null
}

const SKIP_ALIASES = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'localhost'])

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return join(homedir(), p.slice(p === '~' ? 1 : 2))
  }
  return p
}

export function parseSshConfig(text: string): SSHHost[] {
  const lines = text.split(/\r?\n/)
  const hosts: SSHHost[] = []
  let current: { aliases: string[] } & Partial<SSHHost> | null = null

  const flush = () => {
    if (!current || current.aliases.length === 0) return
    for (const alias of current.aliases) {
      if (alias.includes('*') || alias.includes('?')) continue
      if (SKIP_ALIASES.has(alias.toLowerCase())) continue
      hosts.push({
        alias,
        hostname: current.hostname ?? alias,
        user: current.user ?? null,
        port: current.port ?? 22,
        identityFile: current.identityFile ? expandHome(current.identityFile) : null,
      })
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqMatch = line.match(/^(\S+)\s*[=\s]\s*(.+)$/)
    if (!eqMatch) continue
    const key = eqMatch[1].toLowerCase()
    const value = eqMatch[2].trim()

    if (key === 'host') {
      flush()
      current = { aliases: value.split(/\s+/).filter(Boolean) }
      continue
    }
    if (!current) continue
    switch (key) {
      case 'hostname':
        current.hostname = value
        break
      case 'user':
        current.user = value
        break
      case 'port': {
        const n = Number(value)
        if (Number.isFinite(n)) current.port = n
        break
      }
      case 'identityfile':
        current.identityFile = value.replace(/^"(.*)"$/, '$1')
        break
      default:
        break
    }
  }
  flush()
  return hosts
}

export function readSshConfigFile(path?: string): SSHHost[] {
  const file = path ?? join(homedir(), '.ssh', 'config')
  if (!existsSync(file)) return []
  try {
    return parseSshConfig(readFileSync(file, 'utf8'))
  } catch {
    return []
  }
}

export function detectIdentityKey(): { hasIdentityKey: boolean; defaultIdentityPath: string } {
  const ssh = join(homedir(), '.ssh')
  const candidates = ['id_ed25519', 'id_rsa', 'id_ecdsa']
  const hasIdentityKey = candidates.some((c) => existsSync(join(ssh, c)))
  return { hasIdentityKey, defaultIdentityPath: join(ssh, 'id_ed25519') }
}

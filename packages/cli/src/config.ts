import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface CliConfig {
  serverUrl: string
  defaultMachineId?: string
  authToken?: string
  refreshToken?: string
}

const CONFIG_DIR = join(homedir(), '.astro')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')
const DEFAULT_SERVER_URL = 'https://api.astroanywhere.com'

export function loadConfig(): CliConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const raw = readFileSync(CONFIG_FILE, 'utf-8')
      return { serverUrl: DEFAULT_SERVER_URL, ...JSON.parse(raw) }
    }
  } catch {
    // Ignore parse errors, return defaults
  }
  return { serverUrl: DEFAULT_SERVER_URL }
}

export function saveConfig(updates: Partial<CliConfig>): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  const current = loadConfig()
  const merged = { ...current, ...updates }
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n')
}

export function clearAuth(): void {
  const current = loadConfig()
  delete current.authToken
  delete current.refreshToken
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(current, null, 2) + '\n')
}

export function resetConfig(): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify({ serverUrl: DEFAULT_SERVER_URL }, null, 2) + '\n')
}

export function getServerUrl(cliOverride?: string): string {
  // Resolution order: CLI flag > env var > config file > default
  if (cliOverride) return cliOverride
  if (process.env.ASTRO_SERVER_URL) return process.env.ASTRO_SERVER_URL
  const config = loadConfig()
  return config.serverUrl
}

import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export interface PtySpawnOptions {
  name?: string
  cwd?: string
  env?: Record<string, string>
  cols?: number
  rows?: number
}

export interface ShellLaunch {
  file: string
  args: string[]
}

interface SpawnContext {
  requestedCwd: string
  requestedShell?: string
  envShell?: string
  env: Record<string, string>
  cols?: number
  rows?: number
  platform?: NodeJS.Platform
  processCwd?: string
  homeDir?: string
}

interface SpawnResult<TPty> {
  pty: TPty
  cwd: string
  shell: ShellLaunch
}

type PtySpawn<TPty> = (file: string, args: string[], options: PtySpawnOptions) => TPty

function stripMatchingQuotes(value: string): string {
  if (value.length < 2) return value
  const first = value[0]
  const last = value[value.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1)
  }
  return value
}

export function parseShellCommand(command?: string): ShellLaunch | null {
  const trimmed = command?.trim()
  if (!trimmed) return null

  const parts = trimmed.match(/(?:[^\s"'`]+|"[^"]*"|'[^']*'|`[^`]*`)+/g) ?? []
  if (parts.length === 0) return null
  const [file, ...args] = parts
  if (!file) return null

  return {
    file: stripMatchingQuotes(file),
    args: args.map(stripMatchingQuotes),
  }
}

function isExecutableFile(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function isDirectory(dir: string): boolean {
  try {
    return existsSync(dir) && statSync(dir).isDirectory()
  } catch {
    return false
  }
}

export function resolveSpawnCwd(
  requestedCwd: string,
  opts: { processCwd?: string; homeDir?: string } = {},
): string {
  const candidates = [
    requestedCwd,
    opts.processCwd ?? process.cwd(),
    opts.homeDir ?? homedir(),
    '/',
  ]

  for (const candidate of candidates) {
    const trimmed = candidate?.trim()
    if (!trimmed) continue
    const resolved = path.resolve(trimmed)
    if (isDirectory(resolved)) return resolved
  }

  return path.resolve(opts.processCwd ?? process.cwd())
}

export function buildSpawnEnv(
  baseEnv: NodeJS.ProcessEnv,
  overrides?: Record<string, string>,
): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(baseEnv).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )

  if (!overrides) return env
  return {
    ...env,
    ...overrides,
  }
}

export function getShellLaunchCandidates(
  requestedShell?: string,
  envShell?: string,
  platform: NodeJS.Platform = process.platform,
): ShellLaunch[] {
  const seen = new Set<string>()
  const launches: ShellLaunch[] = []

  const add = (command?: string) => {
    const parsed = parseShellCommand(command)
    if (!parsed?.file) return
    if (path.isAbsolute(parsed.file) && !isExecutableFile(parsed.file)) return
    const key = `${parsed.file}\0${parsed.args.join('\0')}`
    if (seen.has(key)) return
    seen.add(key)
    launches.push(parsed)
  }

  if (platform === 'win32') {
    add(requestedShell)
    add(envShell)
    add(process.env.COMSPEC)
    add('powershell.exe')
    add('cmd.exe')
    return launches
  }

  add(requestedShell)
  add(envShell)
  add('/bin/zsh')
  add('/bin/bash')
  add('/bin/sh')
  add('zsh')
  add('bash')
  add('sh')

  return launches
}

function shouldTryNextShell(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /ENOENT|posix_spawnp failed|No such file|not found/i.test(message)
}

export function spawnPtyWithFallback<TPty>(
  spawn: PtySpawn<TPty>,
  ctx: SpawnContext,
): SpawnResult<TPty> {
  const cwd = resolveSpawnCwd(ctx.requestedCwd, {
    processCwd: ctx.processCwd,
    homeDir: ctx.homeDir,
  })
  const candidates = getShellLaunchCandidates(ctx.requestedShell, ctx.envShell, ctx.platform)
  const tried: string[] = []
  let lastError: unknown = null

  for (const candidate of candidates) {
    tried.push([candidate.file, ...candidate.args].join(' '))
    try {
      const env = {
        ...ctx.env,
        SHELL: candidate.file,
      }
      const pty = spawn(candidate.file, candidate.args, {
        name: 'xterm-color',
        cwd,
        env,
        cols: ctx.cols,
        rows: ctx.rows,
      })
      return { pty, cwd, shell: candidate }
    } catch (error) {
      lastError = error
      if (!shouldTryNextShell(error)) break
    }
  }

  const requestedShell = ctx.requestedShell?.trim() || ctx.envShell?.trim() || '<default>'
  const details = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(
    `[terminal] failed to spawn shell "${requestedShell}" in "${cwd}". Tried: ${tried.join(', ') || '<none>'}. Last error: ${details}`,
  )
}

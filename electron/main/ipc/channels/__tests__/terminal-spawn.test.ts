import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  buildSpawnEnv,
  getShellLaunchCandidates,
  parseShellCommand,
  resolveSpawnCwd,
  spawnPtyWithFallback,
} from '../terminal-spawn'

describe('terminal-spawn helpers', () => {
  it('parses shell commands with arguments', () => {
    expect(parseShellCommand('/bin/zsh -l')).toEqual({
      file: '/bin/zsh',
      args: ['-l'],
    })
    expect(parseShellCommand('"bash" --login')).toEqual({
      file: 'bash',
      args: ['--login'],
    })
  })

  it('falls back to an existing directory when cwd is stale', () => {
    const processDir = mkdtempSync(path.join(tmpdir(), 'astro-terminal-cwd-'))
    try {
      const resolved = resolveSpawnCwd('/definitely/missing/path', {
        processCwd: processDir,
        homeDir: '/also/missing',
      })
      expect(resolved).toBe(processDir)
    } finally {
      rmSync(processDir, { recursive: true, force: true })
    }
  })

  it('drops undefined env entries before passing them to the PTY', () => {
    const env = buildSpawnEnv(
      {
        PATH: '/usr/bin',
        SHELL: undefined,
      },
      { TERM: 'xterm-256color' },
    )

    expect(env).toEqual({
      PATH: '/usr/bin',
      TERM: 'xterm-256color',
    })
  })

  it('skips missing absolute shells and retains a usable fallback', () => {
    const candidates = getShellLaunchCandidates('/definitely/missing/shell', undefined, 'linux')
    expect(candidates.some((candidate) => candidate.file === '/definitely/missing/shell')).toBe(false)
    expect(candidates.some((candidate) => candidate.file === '/bin/sh')).toBe(true)
  })

  it('retries with fallback shells after a spawn lookup failure', () => {
    const calls: Array<{ file: string; cwd?: string; shell?: string }> = []
    const processDir = mkdtempSync(path.join(tmpdir(), 'astro-terminal-spawn-'))

    try {
      const result = spawnPtyWithFallback(
        (file, args, options) => {
          calls.push({ file, cwd: options.cwd, shell: options.env?.SHELL })
          if (file === 'sh') return { file, args, options }
          throw new Error('[ipc] terminal:spawn: handler failed — posix_spawnp failed.')
        },
        {
          requestedShell: 'missing-shell',
          envShell: undefined,
          requestedCwd: '/missing/cwd',
          env: {},
          platform: 'linux',
          processCwd: processDir,
          homeDir: '/also/missing',
        },
      )

      expect(result.cwd).toBe(processDir)
      expect(result.shell.file).toBe('sh')
      expect(calls.at(-1)).toEqual({
        file: 'sh',
        cwd: processDir,
        shell: 'sh',
      })
    } finally {
      rmSync(processDir, { recursive: true, force: true })
    }
  })
})

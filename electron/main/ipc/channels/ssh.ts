/**
 * SSH discovery + key helpers for the onboarding flow.
 *
 * v1 scope:
 *   - Parse ~/.ssh/config and surface concrete hosts
 *   - Test reachability with BatchMode=yes (no password prompts)
 *   - Generate an ed25519 key if missing
 *   - Run ssh-copy-id non-interactively; fall back to manual instructions
 *   - install-and-register: STUBBED. Streams a "coming soon" failure on the
 *     `onboarding:host-progress` broker channel for each alias.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/onboarding.js'
import { readSshConfigFile, detectIdentityKey } from '../../lib/ssh-config.js'
import { installAndRegisterHosts } from '../../lib/ssh-installer-runner.js'

function defaultPubKeyPath(): string {
  return join(homedir(), '.ssh', 'id_ed25519.pub')
}

function defaultPrivKeyPath(): string {
  return join(homedir(), '.ssh', 'id_ed25519')
}

async function runAsync(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; env?: NodeJS.ProcessEnv }
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts.env ?? process.env,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout?.on('data', (d) => (stdout += d.toString('utf8')))
    child.stderr?.on('data', (d) => (stderr += d.toString('utf8')))
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
    }, opts.timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      stderr += `\n${err.message}`
      resolve({ code: null, stdout, stderr, timedOut })
    })
  })
}

export function registerSshChannels(): void {
  defineHandler('ssh:discover-hosts', schema.sshDiscoverHosts, () => {
    const hosts = readSshConfigFile()
    const { hasIdentityKey, defaultIdentityPath } = detectIdentityKey()
    return { hosts, hasIdentityKey, defaultIdentityPath }
  })

  defineHandler('ssh:test-host', schema.sshTestHost, async (req) => {
    try {
      const r = await runAsync(
        'ssh',
        [
          '-o',
          'BatchMode=yes',
          '-o',
          'ConnectTimeout=5',
          '-o',
          'StrictHostKeyChecking=accept-new',
          req.alias,
          'echo',
          'ok',
        ],
        { timeoutMs: 10_000 }
      )
      if (r.timedOut) {
        return { reachable: false, needsAuth: false, error: 'Connection timed out after 10s.' }
      }
      if (r.code === 0) {
        return { reachable: true, needsAuth: false, error: null }
      }
      const err = (r.stderr || '').trim()
      const lower = err.toLowerCase()
      if (lower.includes('permission denied') || lower.includes('publickey')) {
        return {
          reachable: false,
          needsAuth: true,
          error: 'Authentication required — set up key-based login.',
        }
      }
      return {
        reachable: false,
        needsAuth: false,
        error: err.length > 0 ? err.slice(0, 500) : `ssh exited ${r.code ?? '?'}`,
      }
    } catch (err) {
      return {
        reachable: false,
        needsAuth: false,
        error: (err as Error).message ?? String(err),
      }
    }
  })

  defineHandler('ssh:generate-key', schema.sshGenerateKey, () => {
    const sshDir = join(homedir(), '.ssh')
    const priv = defaultPrivKeyPath()
    const pub = defaultPubKeyPath()
    if (existsSync(priv) && existsSync(pub)) {
      return { publicKeyPath: pub, publicKey: readFileSync(pub, 'utf8') }
    }
    mkdirSync(sshDir, { recursive: true })
    if (process.platform !== 'win32') {
      try {
        chmodSync(sshDir, 0o700)
      } catch {
        // best-effort
      }
    }
    const comment = `astro-${process.env.HOSTNAME ?? 'desktop'}`
    const r = spawnSync(
      'ssh-keygen',
      ['-t', 'ed25519', '-N', '', '-f', priv, '-C', comment],
      { stdio: 'pipe', timeout: 15_000, encoding: 'utf8' }
    )
    if (r.status !== 0) {
      throw new Error(
        `ssh-keygen failed (${r.status}): ${(r.stderr ?? '').trim() || 'unknown error'}`
      )
    }
    if (!existsSync(pub)) {
      throw new Error(`ssh-keygen reported success but ${pub} is missing.`)
    }
    return { publicKeyPath: pub, publicKey: readFileSync(pub, 'utf8') }
  })

  defineHandler('ssh:copy-key', schema.sshCopyKey, async (req) => {
    const pub = defaultPubKeyPath()
    if (!existsSync(pub)) {
      return {
        ok: false,
        method: 'manual' as const,
        error: 'No public key found at ~/.ssh/id_ed25519.pub.',
        instructions: 'Run "Generate key" first, then retry.',
      }
    }
    const env = {
      ...process.env,
      SSH_ASKPASS: '/usr/bin/false',
      DISPLAY: process.env.DISPLAY ?? ':0',
    }
    const r = await runAsync('ssh-copy-id', ['-i', pub, req.alias], {
      timeoutMs: 15_000,
      env,
    })
    if (r.code === 0) {
      return {
        ok: true,
        method: 'ssh-copy-id' as const,
        error: null,
        instructions: null,
      }
    }
    const errSummary = (r.stderr || '').trim().split('\n').slice(-3).join(' | ').slice(0, 500)
    return {
      ok: false,
      method: 'manual' as const,
      error: errSummary.length > 0 ? errSummary : `ssh-copy-id exited ${r.code ?? '?'}`,
      instructions: `Run this in your terminal:\n  ssh-copy-id -i ${pub} ${req.alias}\nThen click Retry.`,
    }
  })

  defineHandler('ssh:install-and-register', schema.sshInstallAndRegister, (req) => {
    // Fire-and-forget: the runner publishes per-host progress on the
    // onboarding:host-progress broker channel, which the renderer subscribes
    // to during the SSH step. We return synchronously so the orchestrator
    // can move on; failures surface as per-host events, not as a rejected
    // IPC call.
    void installAndRegisterHosts(req.aliases).catch((err) => {
      console.error('[ssh:install-and-register] runner crashed:', err)
    })
    return { ok: true as const }
  })
}

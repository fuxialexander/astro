/**
 * Provider channels — local detection of Claude Code, Codex, OpenClaw, Pi
 * plus tiny helpers for writing a Claude API key and opening sign-in URLs.
 *
 * All probes live in electron/main/lib/provider-detect.ts; this file is the
 * thin IPC wrapper around them.
 */

import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { shell } from 'electron'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/onboarding.js'
import {
  detectAllProviders,
  detectProvider,
  signInUrlFor,
  type ProviderId,
} from '../../lib/provider-detect.js'

function claudeCredentialsPath(): string {
  return join(homedir(), '.claude', '.credentials.json')
}

export function registerProviderChannels(): void {
  defineHandler('providers:detect', schema.providersDetect, async () => {
    return { providers: await detectAllProviders() }
  })

  defineHandler('providers:verify', schema.providersVerify, async (req) => {
    return detectProvider(req.id as ProviderId)
  })

  defineHandler('providers:write-claude-key', schema.providersWriteClaudeKey, (req) => {
    const apiKey = req.apiKey.trim()
    if (!apiKey.startsWith('sk-ant-')) {
      throw new Error('Invalid Claude API key — must start with "sk-ant-".')
    }
    const dest = claudeCredentialsPath()
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(
      dest,
      JSON.stringify({ apiKey, createdAt: new Date().toISOString() }, null, 2),
      'utf8'
    )
    if (process.platform !== 'win32') {
      try {
        chmodSync(dest, 0o600)
      } catch {
        // best-effort permission hardening
      }
    }
    return { ok: true as const }
  })

  defineHandler('providers:open-signin', schema.providersOpenSignin, async (req) => {
    const url = signInUrlFor(req.id as ProviderId)
    if (url) {
      try {
        await shell.openExternal(url)
      } catch {
        // Non-fatal — caller can show the URL manually.
      }
    }
    return { ok: true as const }
  })
}

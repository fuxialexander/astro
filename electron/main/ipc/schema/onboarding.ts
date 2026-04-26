/**
 * Schemas for the GUI-only onboarding flow:
 *   - Device authorization (relay endpoints)
 *   - Local astro-agent supervisor
 *   - Provider detection (Claude Code, Codex, OpenClaw, Pi)
 *   - SSH host discovery + key install (install pipeline stubbed for v1)
 */

import { z } from 'zod'

// ─── Device auth (extends agent.ts) ─────────────────────────────────────────

export const deviceAuthStart = {
  req: z.object({}),
  res: z.object({
    deviceCode: z.string(),
    userCode: z.string(),
    verificationUriComplete: z.string(),
    expiresIn: z.number(),
  }),
}

export const deviceAuthCancel = {
  req: z.object({}),
  res: z.object({ ok: z.literal(true) }),
}

export const startLocal = {
  req: z.object({}),
  res: z.object({
    ok: z.boolean(),
    pid: z.number().nullable(),
    error: z.string().nullable(),
  }),
}

export const localStatus = {
  req: z.object({}),
  res: z.object({
    running: z.boolean(),
    pid: z.number().nullable(),
    lastError: z.string().nullable(),
  }),
}

// ─── Providers ──────────────────────────────────────────────────────────────

export const providerId = z.enum(['claude', 'codex', 'pi', 'openclaw'])

export const providerInfo = z.object({
  id: providerId,
  label: z.string(),
  installed: z.boolean(),
  authed: z.boolean(),
  version: z.string().nullable(),
  signInUrl: z.string().nullable(),
})

export const providersDetect = {
  req: z.object({}),
  res: z.object({ providers: z.array(providerInfo) }),
}

export const providersVerify = {
  req: z.object({ id: providerId }),
  res: providerInfo,
}

export const providersWriteClaudeKey = {
  req: z.object({ apiKey: z.string() }),
  res: z.object({ ok: z.literal(true) }),
}

export const providersOpenSignin = {
  req: z.object({ id: providerId }),
  res: z.object({ ok: z.literal(true) }),
}

// ─── SSH ────────────────────────────────────────────────────────────────────

export const sshHost = z.object({
  alias: z.string(),
  hostname: z.string(),
  user: z.string().nullable(),
  port: z.number(),
  identityFile: z.string().nullable(),
})

export const sshDiscoverHosts = {
  req: z.object({}),
  res: z.object({
    hosts: z.array(sshHost),
    hasIdentityKey: z.boolean(),
    defaultIdentityPath: z.string(),
  }),
}

export const sshTestHost = {
  req: z.object({ alias: z.string() }),
  res: z.object({
    reachable: z.boolean(),
    needsAuth: z.boolean(),
    error: z.string().nullable(),
  }),
}

export const sshGenerateKey = {
  req: z.object({}),
  res: z.object({
    publicKeyPath: z.string(),
    publicKey: z.string(),
  }),
}

export const sshCopyKey = {
  req: z.object({ alias: z.string() }),
  res: z.object({
    ok: z.boolean(),
    method: z.enum(['ssh-copy-id', 'manual']),
    error: z.string().nullable(),
    instructions: z.string().nullable(),
  }),
}

export const sshInstallAndRegister = {
  req: z.object({ aliases: z.array(z.string()) }),
  res: z.object({ ok: z.literal(true) }),
}

// ─── Channel registry ───────────────────────────────────────────────────────

export const channels = {
  'agent:device-auth-start': deviceAuthStart,
  'agent:device-auth-cancel': deviceAuthCancel,
  'agent:start-local': startLocal,
  'agent:local-status': localStatus,
  'providers:detect': providersDetect,
  'providers:verify': providersVerify,
  'providers:write-claude-key': providersWriteClaudeKey,
  'providers:open-signin': providersOpenSignin,
  'ssh:discover-hosts': sshDiscoverHosts,
  'ssh:test-host': sshTestHost,
  'ssh:generate-key': sshGenerateKey,
  'ssh:copy-key': sshCopyKey,
  'ssh:install-and-register': sshInstallAndRegister,
} as const

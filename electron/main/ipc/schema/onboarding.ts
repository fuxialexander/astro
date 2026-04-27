/**
 * Schemas for the GUI-only onboarding flow:
 *   - Device authorization (relay endpoints)
 *   - Local astro-agent supervisor
 *   - Provider detection (Claude Code, Codex, OpenClaw, Pi)
 *   - SSH host discovery + key install (install pipeline stubbed for v1)
 */

import { z } from 'zod'

// ─── Pair / auth-state (extends agent.ts) ───────────────────────────────────

// Callback-style pair: app opens browser at pairUrl and waits for the
// astro://pair/callback deep-link. The success state is published on the
// shared 'onboarding:device-auth' broker channel as { state: 'authorized' }
// — same shape ConnectThisMacStep already handles. No polling.
export const pairStart = {
  req: z.object({}),
  res: z.object({
    pairToken: z.string(),
    pairUrl: z.string(),
    expiresIn: z.number(),
  }),
}

export const pairCancel = {
  req: z.object({}),
  res: z.object({ ok: z.literal(true) }),
}

export const authState = {
  req: z.object({}),
  res: z.object({
    authed: z.boolean(),
    machineId: z.string().nullable(),
  }),
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
  'agent:pair-start': pairStart,
  'agent:pair-cancel': pairCancel,
  'agent:auth-state': authState,
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

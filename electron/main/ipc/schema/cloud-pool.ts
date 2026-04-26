/**
 * IPC schemas for renderer-driven cloud pool operations.
 *
 * Note: this file is intentionally NOT registered in scripts/gen-ipc-bridge.ts
 * because hyphenated channel prefixes (`cloud-pool:*`) are not supported by
 * the codegen (would emit invalid TS keys). The renderer-side wrapper is
 * hand-typed in src/lib/desktop-bridge.ts; these schemas are still used at
 * runtime by defineHandler for request/response validation.
 */

import { z } from 'zod'

// AWS uses { profile, region }; GCP uses { project, adcPath?, zone? }.
// Combined schema keeps a single shape for the IPC payload.
const cloudConfigSchema = z.object({
  profile: z.string().optional(),
  region: z.string().optional(),
  project: z.string().optional(),
  adcPath: z.string().optional(),
  zone: z.string().optional(),
})

const resourceProfileSchema = z.object({
  cpu: z.number().optional(),
  memoryGb: z.number().optional(),
  gpu: z.number().optional(),
  ttlMinutes: z.number().optional(),
})

const providerSchema = z.enum(['aws', 'gcp'])

export const create = {
  req: z.object({
    provider: providerSchema,
    config: cloudConfigSchema,
    poolId: z.string(),
    teamId: z.string(),
    desiredRunners: z.number().int().nonnegative(),
    resourceProfile: resourceProfileSchema,
    serverUrl: z.string(),
    relayUrl: z.string(),
  }),
  res: z.object({
    ok: z.boolean(),
    instanceIds: z.array(z.string()).optional(),
    region: z.string().optional(),
    instanceType: z.string().optional(),
    amiId: z.string().optional(),
    costMetadata: z.object({
      estimatedHourlyCostUsd: z.number().optional(),
    }).optional(),
    error: z.string().optional(),
  }),
}

export const scale = {
  req: z.object({
    provider: providerSchema,
    config: cloudConfigSchema,
    currentInstanceIds: z.array(z.string()),
    desiredRunners: z.number().int().nonnegative(),
    poolId: z.string(),
    teamId: z.string(),
    resourceProfile: resourceProfileSchema,
    serverUrl: z.string(),
    relayUrl: z.string(),
  }),
  res: z.object({
    ok: z.boolean(),
    instanceIds: z.array(z.string()).optional(),
    added: z.array(z.string()).optional(),
    removed: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
}

export const terminate = {
  req: z.object({
    provider: providerSchema,
    config: cloudConfigSchema,
    instanceIds: z.array(z.string()),
  }),
  res: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
}

export const channels = {
  'cloud-pool:create': create,
  'cloud-pool:scale': scale,
  'cloud-pool:terminate': terminate,
} as const

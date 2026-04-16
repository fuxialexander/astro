/**
 * Server supervisor channel schemas. Lets the renderer query whether the
 * server utilityProcess is healthy and trigger a restart from a settings UI.
 */

import { z } from 'zod'

export const status = {
  req: z.object({}),
  res: z.object({
    state: z.enum(['idle', 'starting', 'running', 'crashed', 'stopped']),
    port: z.number().nullable(),
    relayPort: z.number().nullable(),
  }),
}

export const restart = {
  req: z.object({}),
  res: z.object({ ok: z.literal(true) }),
}

export const channels = {
  'server:status': status,
  'server:restart': restart,
} as const

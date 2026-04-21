import { z } from 'zod'

export const openTerminal = {
  req: z.object({
    /** The shell command to run in the newly-opened terminal window. */
    command: z.string().min(1),
  }),
  res: z.object({ ok: z.literal(true) }),
}

export const openPath = {
  req: z.object({
    /** Absolute filesystem path to open with the OS default application. */
    path: z.string().min(1),
  }),
  res: z.object({ ok: z.literal(true), error: z.string().optional() }),
}

export const channels = {
  'shell:open-terminal': openTerminal,
  'shell:open-path': openPath,
} as const

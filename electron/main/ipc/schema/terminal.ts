/**
 * Terminal channel schemas. Spawn/write/resize/kill go through ipcMain.handle;
 * data and exit events stream over the MessagePort broker on channels:
 *   - `terminal:<sessionId>:data`  (string chunks, utf8)
 *   - `terminal:<sessionId>:exit`  ({ code, signal })
 *
 * Backed by node-pty running directly in the main process. node-pty's IO is
 * non-blocking, so a dedicated worker_thread isn't necessary for MVP. If
 * node-pty is not yet rebuilt for Electron's ABI, `terminal:spawn` returns a
 * structured NOT_REBUILT error so the renderer can show a placeholder.
 */

import { z } from 'zod'

export const sessionId = z.string().min(1)

export const spawn = {
  req: z.object({
    cwd: z.string(),
    shell: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    cols: z.number().int().positive().default(80),
    rows: z.number().int().positive().default(24),
  }),
  res: z.object({ sessionId, pid: z.number() }),
}

export const write = {
  req: z.object({ sessionId, data: z.string() }),
  res: z.object({ ok: z.literal(true) }),
}

export const resize = {
  req: z.object({ sessionId, cols: z.number().int().positive(), rows: z.number().int().positive() }),
  res: z.object({ ok: z.literal(true) }),
}

export const kill = {
  req: z.object({ sessionId }),
  res: z.object({ ok: z.literal(true) }),
}

export const channels = {
  'terminal:spawn': spawn,
  'terminal:write': write,
  'terminal:resize': resize,
  'terminal:kill': kill,
} as const

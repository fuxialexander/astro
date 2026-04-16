/**
 * Typed IPC registry. Every channel is a Zod schema pair { req, res }; the
 * handler is wrapped so that incoming params and outgoing results are
 * validated. Validation failures become structured errors back to the
 * renderer instead of unhandled exceptions.
 *
 * Usage:
 *   import { defineHandler } from './registry.js'
 *   defineHandler('fs:read-file', schema, async (req, e) => ({ content: ... }))
 *
 * The renderer never sees `ipcMain.handle` directly — preload exposes typed
 * proxies generated from the same schemas (see src/lib/desktop-bridge.ts).
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { z, ZodTypeAny } from 'zod'

export interface ChannelSchema<Req extends ZodTypeAny, Res extends ZodTypeAny> {
  req: Req
  res: Res
}

export type Handler<Req extends ZodTypeAny, Res extends ZodTypeAny> = (
  req: z.infer<Req>,
  event: IpcMainInvokeEvent
) => Promise<z.infer<Res>> | z.infer<Res>

const registered = new Set<string>()

export function defineHandler<Req extends ZodTypeAny, Res extends ZodTypeAny>(
  channel: string,
  schema: ChannelSchema<Req, Res>,
  handler: Handler<Req, Res>
): void {
  if (registered.has(channel)) {
    throw new Error(`[ipc] channel already registered: ${channel}`)
  }
  registered.add(channel)

  ipcMain.handle(channel, async (event, raw) => {
    const reqResult = schema.req.safeParse(raw)
    if (!reqResult.success) {
      const err = new Error(
        `[ipc] ${channel}: invalid request — ${reqResult.error.message}`
      )
      ;(err as Error & { code?: string }).code = 'IPC_INVALID_REQUEST'
      throw err
    }
    let result: unknown
    try {
      result = await handler(reqResult.data, event)
    } catch (err) {
      // Surface the underlying error to the renderer with channel context.
      // Per project rule: never silently swallow errors.
      const wrapped = new Error(
        `[ipc] ${channel}: handler failed — ${(err as Error).message ?? err}`
      )
      ;(wrapped as Error & { cause?: unknown }).cause = err
      throw wrapped
    }
    const resResult = schema.res.safeParse(result)
    if (!resResult.success) {
      throw new Error(
        `[ipc] ${channel}: invalid response — ${resResult.error.message}`
      )
    }
    return resResult.data
  })
}

export function listChannels(): string[] {
  return Array.from(registered).sort()
}

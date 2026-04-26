/**
 * Stream control channels.
 *
 * The MessagePort broker delivers events to the renderer in fire-and-forget
 * fashion. For "sticky" channels — where the renderer needs the last value
 * even if it (re-)subscribed after the publish — we expose a one-shot
 * `streams:get-sticky` IPC. The renderer calls it immediately after
 * subscribing so it can recover the canonical state after a remount.
 *
 * See electron/main/ipc/broker.ts for the sticky-publish API.
 */

import { z } from 'zod'
import { defineHandler } from '../registry.js'
import { streamBroker } from '../broker.js'

const getSticky = {
  req: z.object({ channel: z.string() }),
  // payload shape is per-channel; surface it as unknown and let the renderer
  // decide. We don't validate the response because each channel has its own
  // type and we don't want this generic helper to know all of them.
  res: z.object({ payload: z.unknown() }),
}

export function registerStreamChannels(): void {
  defineHandler('streams:get-sticky', getSticky, (req) => {
    return { payload: streamBroker.getSticky(req.channel) }
  })
}

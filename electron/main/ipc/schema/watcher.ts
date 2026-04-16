/**
 * Filesystem watcher channel schemas. Subscriptions are managed via
 * subscribe/unsubscribe; the actual change events stream over the broker
 * channel `watcher:<subscriptionId>` as { type, path }.
 *
 * Backed by chokidar in electron/workers/fs-watcher/worker.ts. The worker
 * debounces events to avoid swamping the renderer under heavy churn.
 */

import { z } from 'zod'

export const subscriptionId = z.string().min(1)

export const watchEventType = z.enum(['add', 'change', 'unlink', 'addDir', 'unlinkDir'])

export const subscribe = {
  req: z.object({
    path: z.string(),
    /** Glob ignore patterns (chokidar `ignored` option). */
    ignored: z.array(z.string()).optional(),
    /** Recurse into subdirectories. */
    recursive: z.boolean().default(true),
  }),
  res: z.object({ subscriptionId }),
}

export const unsubscribe = {
  req: z.object({ subscriptionId }),
  res: z.object({ ok: z.literal(true) }),
}

export const channels = {
  'watcher:subscribe': subscribe,
  'watcher:unsubscribe': unsubscribe,
} as const

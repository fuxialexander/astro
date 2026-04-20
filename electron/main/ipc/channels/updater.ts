import { z } from 'zod'
import { defineHandler } from '../registry.js'
import { installUpdate } from '../../updater.js'

export function registerUpdaterChannels(): void {
  defineHandler(
    'updater:install',
    { req: z.object({}), res: z.object({ ok: z.literal(true) }) },
    () => {
      installUpdate()
      return { ok: true as const }
    },
  )
}

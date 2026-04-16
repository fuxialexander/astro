/**
 * Server supervisor channel handlers. Lets the renderer query supervisor
 * state and trigger a restart from settings.
 */

import { defineHandler } from '../registry.js'
import * as schema from '../schema/server.js'
import { serverSupervisor } from '../../services/supervisor.js'

export function registerServerChannels(): void {
  defineHandler('server:status', schema.status, async () => ({
    state: serverSupervisor.status(),
    port: serverSupervisor.port(),
    relayPort: serverSupervisor.relayPort(),
  }))

  defineHandler('server:restart', schema.restart, async () => {
    await serverSupervisor.stop()
    await serverSupervisor.start()
    return { ok: true as const }
  })
}

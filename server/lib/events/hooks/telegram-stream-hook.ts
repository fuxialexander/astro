/**
 * Telegram Stream Hook
 *
 * Auto-subscribes Telegram-connected users to execution streaming
 * when a task starts. Users must have `autoStream: true` in their
 * connected account settings to receive auto-streams.
 */

import type { EventHook } from '../types.js'
import { telegramStreamManager } from '../../channel/adapters/telegram-stream-manager.js'

export const telegramStreamHook: EventHook = async (event) => {
  if (event.type !== 'task.started') return

  const taskTitle = event.node?.title || event.nodeId
  await telegramStreamManager.autoSubscribeProjectMembers(
    event.executionId,
    event.projectId,
    taskTitle,
  )
}

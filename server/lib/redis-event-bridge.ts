/**
 * Redis Event Bridge
 *
 * Bridges executionEventBus events to Redis pub/sub for cross-instance delivery.
 * This is the centralized listener that covers ALL emission sites — no need to
 * add publishToRedis calls at each individual emit() call site.
 *
 * Events bridged:
 * - node:status_changed (16 sites across dispatch.ts, data.ts, index.ts,
 *   execution-watchdog.ts, github-webhook-handler.ts)
 * - task:init (dispatch.ts)
 * - task:ready (data.ts autoDispatchDownstream)
 *
 * These events originate from server-side code (dispatch lifecycle, data API,
 * watchdog, GitHub webhooks) and are local-only via executionEventBus.
 * Without this bridge, browser clients on other server instances never receive
 * status transition notifications — breaking the DB-authoritative pattern
 * introduced in PR #830.
 */

import { executionEventBus } from './execution-event-bus.js'
import { redisPubSub } from './redis-pubsub.js'
import { executionContextStore } from './execution-context-store.js'

/**
 * Initialize the event bridge. Call once during server startup.
 * Safe to call even if Redis is not connected — publishStreamingEvent no-ops
 * when publisher is null (single-instance mode).
 */
export function initRedisEventBridge(): void {
  // Bridge node:status_changed → Redis
  // This is the SOLE mechanism for frontend plan node status updates (PR #830).
  // All 16 emission sites across dispatch.ts, data.ts, index.ts,
  // execution-watchdog.ts, and github-webhook-handler.ts emit on
  // executionEventBus. This single listener bridges them all to Redis.
  executionEventBus.on('node:status_changed', (msg: {
    nodeId: string
    projectId: string
    status: string
    executionId?: string
  }) => {
    // Look up userId from executionContext if available (for coarse filtering).
    // The receiving end uses isProjectOwnedByUser for authoritative check.
    const userId = msg.executionId
      ? executionContextStore.getUserIdForTask(msg.executionId)
      : undefined

    redisPubSub.publishStreamingEvent({
      eventType: 'node_status_changed',
      taskId: msg.executionId || msg.nodeId,
      userId,
      data: {
        nodeId: msg.nodeId,
        projectId: msg.projectId,
        status: msg.status,
        executionId: msg.executionId,
      },
    }).catch((err) => {
      console.error('[redis-bridge] Failed to publish node_status_changed:', err)
    })
  })

  // Bridge task:init → Redis
  // Emitted when a task begins execution (dispatch.ts). Cross-instance clients
  // need this to bootstrap execution tracking and show the task in active-tasks.
  executionEventBus.on('task:init', (msg: {
    executionId: string
    nodeId: string
    projectId: string
    machineId?: string
    providerId?: string
    providerName?: string
    computeBackend?: string
  }) => {
    const userId = executionContextStore.getUserIdForTask(msg.executionId)

    redisPubSub.publishStreamingEvent({
      eventType: 'task_init',
      taskId: msg.executionId,
      userId,
      data: {
        executionId: msg.executionId,
        nodeId: msg.nodeId,
        projectId: msg.projectId,
        machineId: msg.machineId,
        providerId: msg.providerId,
        providerName: msg.providerName,
        computeBackend: msg.computeBackend,
      },
    }).catch((err) => {
      console.error('[redis-bridge] Failed to publish task_init:', err)
    })
  })

  // Bridge task:ready → Redis
  // Emitted when downstream tasks become ready for dispatch (data.ts
  // autoDispatchDownstream). Cross-instance clients need this for UI notification.
  executionEventBus.on('task:ready', (msg: {
    nodeId: string
    projectId: string
  }) => {
    redisPubSub.publishStreamingEvent({
      eventType: 'task_ready',
      taskId: msg.nodeId,
      data: {
        nodeId: msg.nodeId,
        projectId: msg.projectId,
      },
    }).catch((err) => {
      console.error('[redis-bridge] Failed to publish task_ready:', err)
    })
  })

  console.log('[redis-bridge] Event bridge initialized')
}

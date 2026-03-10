/**
 * Execution Context Store
 *
 * Dual-layer store: in-memory Map for zero-latency local lookups + Redis
 * write-through for cross-instance visibility. When a lookup misses the
 * local Map, it falls back to Redis (e.g., approval POST routed to the
 * wrong instance).
 *
 * Entries have a TTL (4 hours local, 4 hours Redis) and are automatically
 * pruned to prevent leaks from executions that complete without cleanup.
 */

import { redisPubSub } from './redis-pubsub.js'

export interface ExecutionContext {
  executionId: string
  projectId: string
  nodeId: string
  userId: string
  machineId: string
  createdAt: number
}

/** Maximum age of a context entry before automatic cleanup (4 hours) */
const CONTEXT_TTL_MS = 4 * 60 * 60 * 1000

/** How often to run the cleanup sweep (10 minutes) */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000

const store = new Map<string, ExecutionContext>()

/** Prune entries older than CONTEXT_TTL_MS */
function prune(): void {
  const cutoff = Date.now() - CONTEXT_TTL_MS
  for (const [key, ctx] of store) {
    if (ctx.createdAt < cutoff) {
      store.delete(key)
    }
  }
}

// Start periodic cleanup
const cleanupTimer = setInterval(prune, CLEANUP_INTERVAL_MS)
cleanupTimer.unref() // Don't prevent process exit

/**
 * Tracks executionIds with an active dispatch SSE bridge (POST /api/dispatch/task).
 *
 * Purpose: Prevents double-persistence of relay-originated events (text, tool_use,
 * tool_result, file_change, session_init) when both relay-server.ts and dispatch.ts
 * would otherwise write the same event to streaming_events. Also prevents double-
 * delivery via the global SSE (GET /api/events/stream) while a dispatch bridge is live.
 *
 * Persistence authority:
 *   - Browser dispatch (isServerSideDispatch=false): dispatch.ts owns persistence.
 *     relay-server.ts checks this Set and skips persistence when the taskId is present.
 *   - Server-side dispatch (isServerSideDispatch=true): relay-server.ts owns
 *     persistence. dispatch.ts skips relay-originated events. This Set is intentionally
 *     NOT populated for server-side dispatch so events.ts can forward to browser SSE.
 *   - Chat/agent path: agent.ts adds itself to this Set; relay-server skips persistence.
 *   - Note: progress events are NOT persisted by relay-server.ts — dispatch.ts is the
 *     sole persister for progress regardless of pathway. No guard is needed for progress.
 *
 * Lifecycle:
 *   - Added when dispatch SSE starts (dispatch.ts, inside streamSSE callback)
 *   - Removed on stream close/cleanup (dispatch.ts cleanup function)
 *   - Skipped for server-side dispatch (X-Server-Dispatch: 'true')
 *
 * Multi-instance note: This is an IN-MEMORY Set. In multi-instance deployments,
 * only the instance running the dispatch SSE has the entry. relay-server.ts on other
 * instances would not see it and would persist independently. In practice, the relay
 * WebSocket from the agent runner and the dispatch SSE share the same instance (sticky
 * session or explicit relay URL), so single-instance semantics hold. Cross-instance
 * registration in Redis (redisPubSub.registerActiveDispatchStream) is used only for
 * the events.ts delivery-dedup path (not for relay-server.ts persistence guards).
 *
 * When dispatch SSE dies (page refresh, network drop):
 *   1. activeDispatchStreams entry is removed on close
 *   2. Global SSE relay-direct handlers resume delivery (events.ts)
 *   3. Frontend processSSEStreamWithReconnect catches up from streaming_events
 *   4. node:status_changed delivers authoritative status regardless
 */
export const activeDispatchStreams = new Set<string>()

export const executionContextStore = {
  register(ctx: Omit<ExecutionContext, 'createdAt'>): void {
    const entry = { ...ctx, createdAt: Date.now() }
    store.set(ctx.executionId, entry)
    // Write-through to Redis for cross-instance visibility
    redisPubSub.registerExecutionContext(entry).catch((err) => {
      console.error('[exec-context] Failed to write context to Redis:', err)
    })
  },

  get(executionId: string): ExecutionContext | undefined {
    return store.get(executionId)
  },

  /**
   * Async get with Redis fallback. Use this when the caller can await
   * and needs cross-instance visibility (e.g., approval routing).
   */
  async getWithFallback(executionId: string): Promise<ExecutionContext | undefined> {
    const local = store.get(executionId)
    if (local) return local
    // Try Redis fallback for cross-instance scenario
    const remote = await redisPubSub.getExecutionContext(executionId)
    if (remote) {
      // Cache locally for subsequent sync lookups
      store.set(remote.executionId, remote)
      return remote
    }
    return undefined
  },

  remove(executionId: string): void {
    store.delete(executionId)
    redisPubSub.removeExecutionContext(executionId).catch((err) => {
      console.error('[exec-context] Failed to remove context from Redis:', err)
    })
  },

  getUserIdForTask(executionId: string): string | undefined {
    return store.get(executionId)?.userId
  },

  /**
   * Async userId lookup with Redis fallback. Use when cross-instance
   * visibility is needed and the caller can await.
   */
  async getUserIdForTaskWithFallback(executionId: string): Promise<string | undefined> {
    const local = store.get(executionId)?.userId
    if (local) return local
    const remote = await redisPubSub.getExecutionContext(executionId)
    return remote?.userId
  },

  /** Number of tracked executions (for debugging/monitoring) */
  get size(): number {
    return store.size
  },
}

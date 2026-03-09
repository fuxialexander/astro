/**
 * Execution Context Store
 *
 * In-memory map tracking which user/machine owns each active execution.
 * Used by SSE event routes to filter task events per-user (preventing
 * cross-user data leaks) and by dispatch routes to validate ownership.
 *
 * Entries have a TTL (default 4 hours) and are automatically pruned
 * to prevent memory leaks from executions that complete without cleanup
 * (e.g., server restart mid-execution, aborted SSE connections).
 */

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
 * Purpose: Prevents double-delivery of EPHEMERAL events (text, tool_trace, progress,
 * file_change, session_init) when both the dispatch bridge and the global SSE
 * (GET /api/events/stream) are running. Only guards ephemeral events — status
 * transitions use node:status_changed which has NO guard (always delivered).
 *
 * Lifecycle:
 *   - Added when dispatch SSE starts (dispatch.ts, inside streamSSE callback)
 *   - Removed on stream close/cleanup (dispatch.ts cleanup function)
 *   - Skipped for server-side dispatch (X-Server-Dispatch: 'true')
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
    store.set(ctx.executionId, { ...ctx, createdAt: Date.now() })
  },

  get(executionId: string): ExecutionContext | undefined {
    return store.get(executionId)
  },

  remove(executionId: string): void {
    store.delete(executionId)
  },

  getUserIdForTask(executionId: string): string | undefined {
    return store.get(executionId)?.userId
  },

  /** Number of tracked executions (for debugging/monitoring) */
  get size(): number {
    return store.size
  },
}

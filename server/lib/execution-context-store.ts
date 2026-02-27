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
 * Tracks executionIds that have an active dispatch.ts SSE bridge.
 * Used by events.ts to avoid double-sending: when the dispatch bridge
 * is alive it handles streaming events via executionEventBus; when
 * it's dead (after page refresh), events.ts subscribes to relay directly.
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

/**
 * GitHub Sync Logger
 *
 * Logs all sync operations to the github_sync_log table for monitoring
 * and the sync health dashboard.
 */

import { db } from './db/index.js'
import { githubSyncLog } from './db/schema.js'

export type SyncDirection = 'github_to_astro' | 'astro_to_github'
export type SyncAction = 'create' | 'update' | 'close' | 'reopen' | 'comment' | 'label' | 'assign'
export type SyncStatus = 'success' | 'error'

interface LogSyncParams {
  projectId: string
  nodeId?: string | null
  direction: SyncDirection
  action: SyncAction
  status: SyncStatus
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Log a sync operation to the github_sync_log table.
 * Fire-and-forget — errors are caught and logged to console.
 */
export async function logSyncOperation(params: LogSyncParams): Promise<void> {
  try {
    await db.insert(githubSyncLog).values({
      projectId: params.projectId,
      nodeId: params.nodeId ?? null,
      direction: params.direction,
      action: params.action,
      status: params.status,
      errorMessage: params.errorMessage ?? null,
      metadata: params.metadata ?? null,
    })
  } catch (err) {
    // Never let logging failures propagate — the sync itself is more important
    console.warn('[github-sync-logger] Failed to log sync operation:', err instanceof Error ? err.message : String(err))
  }
}

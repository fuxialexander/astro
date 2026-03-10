/**
 * Cleanup Scheduler
 *
 * Periodically cleans up expired tokens, old executions, old chat history, and expired push tokens.
 * Runs daily (24h interval) by default, but can be disabled for testing.
 *
 * Uses Redis leader election when multiple instances are running — only one
 * instance executes cleanup at a time. If the leader dies, its lock expires
 * and another instance takes over automatically.
 */

import { db } from './db/index.js';
import { taskExecutions, taskChatSessions, pushTokens, streamingEvents } from './db/schema.js';
import { lt } from 'drizzle-orm';
import { cleanupExpiredTokens } from './token-manager.js';
import { redisPubSub } from './redis-pubsub.js';

interface CleanupConfig {
  enabled: boolean;
  intervalMs: number;
  retentionDays: {
    executions: number;
    chatHistory: number;
  };
}

const DEFAULT_CONFIG: CleanupConfig = {
  enabled: true,
  intervalMs: 24 * 60 * 60 * 1000, // 24 hours
  retentionDays: {
    executions: 90,
    chatHistory: 180,
  },
};

const LEADER_NAME = 'cleanup-scheduler';
/** Leader lock TTL — must be longer than one cleanup cycle but short enough for failover */
const LEADER_TTL_SECONDS = 3600; // 1 hour

let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let config: CleanupConfig = DEFAULT_CONFIG;

/**
 * Clean up expired refresh tokens
 */
async function cleanupExpiredRefreshTokens(): Promise<number> {
  console.log('[cleanup] Running expired token cleanup...');
  const count = await cleanupExpiredTokens();
  console.log(`[cleanup] Cleaned up ${count} expired refresh tokens`);
  return count;
}

/**
 * Clean up old task executions (older than retention period)
 */
async function cleanupOldExecutions(retentionDays: number = 90): Promise<number> {
  console.log(`[cleanup] Running old execution cleanup (retention: ${retentionDays} days)...`);

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await db
      .delete(taskExecutions)
      .where(lt(taskExecutions.createdAt, cutoffDate));

    const count = result.rowCount ?? 0;
    console.log(`[cleanup] Cleaned up ${count} old task executions`);
    return count;
  } catch (error: unknown) {
    const err = error as { cause?: { code?: string } }
    if (err?.cause?.code === '42P01') {
      console.warn('[cleanup] Skipping - task_executions table not found. Run migrations to enable.');
      return 0;
    }
    throw error;
  }
}

/**
 * Clean up old task chat history (older than retention period)
 */
async function cleanupOldChatHistory(retentionDays: number = 180): Promise<number> {
  console.log(`[cleanup] Running old chat history cleanup (retention: ${retentionDays} days)...`);

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    // Delete sessions older than cutoff date (messages will cascade delete)
    const result = await db
      .delete(taskChatSessions)
      .where(lt(taskChatSessions.createdAt, cutoffDate));

    const count = result.rowCount ?? 0;
    console.log(`[cleanup] Cleaned up ${count} old chat sessions`);
    return count;
  } catch (error: unknown) {
    const err = error as { cause?: { code?: string } }
    if (err?.cause?.code === '42P01') {
      console.warn('[cleanup] Skipping - task_chat_sessions table not found. Run migrations to enable.');
      return 0;
    }
    throw error;
  }
}

/**
 * Clean up expired push tokens (not updated in 90 days - indicates inactive device)
 */
async function cleanupExpiredPushTokens(): Promise<number> {
  console.log('[cleanup] Running expired push token cleanup...');

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90); // 90 days without update = inactive

    const result = await db
      .delete(pushTokens)
      .where(lt(pushTokens.updatedAt, cutoffDate));

    const count = result.rowCount ?? 0;
    console.log(`[cleanup] Cleaned up ${count} expired push tokens`);
    return count;
  } catch (error: unknown) {
    const err = error as { cause?: { code?: string } }
    if (err?.cause?.code === '42P01') {
      console.warn('[cleanup] Skipping - push_tokens table not found. Run migrations to enable push notifications.');
      return 0;
    }
    throw error;
  }
}

/**
 * Clean up old streaming events (older than 7 days)
 */
async function cleanupOldStreamingEvents(retentionDays: number = 7): Promise<number> {
  console.log(`[cleanup] Running old streaming events cleanup (retention: ${retentionDays} days)...`);

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await db
      .delete(streamingEvents)
      .where(lt(streamingEvents.createdAt, cutoffDate));

    const count = result.rowCount ?? 0;
    console.log(`[cleanup] Cleaned up ${count} old streaming events`);
    return count;
  } catch (error: unknown) {
    const err = error as { cause?: { code?: string } }
    if (err?.cause?.code === '42P01') {
      console.warn('[cleanup] Skipping - streaming_events table not found. Run migrations to enable.');
      return 0;
    }
    throw error;
  }
}

/**
 * Run all cleanup tasks
 */
async function runCleanup(): Promise<void> {
  const startTime = Date.now();
  console.log('[cleanup] Starting scheduled cleanup...');

  try {
    const results = await Promise.all([
      cleanupExpiredRefreshTokens(),
      cleanupOldExecutions(config.retentionDays.executions),
      cleanupOldChatHistory(config.retentionDays.chatHistory),
      cleanupExpiredPushTokens(),
      cleanupOldStreamingEvents(),
    ]);

    const totalCleaned = results.reduce((sum, count) => sum + count, 0);
    const duration = Date.now() - startTime;

    console.log(`[cleanup] Cleanup completed in ${duration}ms. Total records cleaned: ${totalCleaned}`);
  } catch (error) {
    console.error('[cleanup] Cleanup failed:', error);
  }
}

/**
 * Run cleanup only if this instance is the leader.
 * Acquires or renews leadership before running.
 */
async function runCleanupIfLeader(): Promise<void> {
  const acquired = await redisPubSub.tryAcquireLeader(LEADER_NAME, LEADER_TTL_SECONDS);
  const renewed = !acquired && await redisPubSub.renewLeadership(LEADER_NAME, LEADER_TTL_SECONDS);

  if (!acquired && !renewed) {
    console.log('[cleanup] Another instance is the cleanup leader — skipping this cycle');
    return;
  }

  await runCleanup();
}

/**
 * Start the cleanup scheduler
 */
export function startCleanupScheduler(customConfig?: Partial<CleanupConfig>): void {
  // Merge custom config with defaults
  config = { ...DEFAULT_CONFIG, ...customConfig };

  if (!config.enabled) {
    console.log('[cleanup] Cleanup scheduler disabled');
    return;
  }

  // Stop existing scheduler if running
  stopCleanupScheduler();

  console.log(`[cleanup] Starting cleanup scheduler (interval: ${config.intervalMs / 1000 / 60 / 60}h)`);

  // Run cleanup immediately on start (with leader check)
  runCleanupIfLeader().catch((err) => {
    console.error('[cleanup] Initial cleanup failed:', err);
  });

  // Schedule periodic cleanup (with leader check each cycle)
  cleanupTimer = setInterval(() => {
    runCleanupIfLeader().catch((err) => {
      console.error('[cleanup] Scheduled cleanup failed:', err);
    });
  }, config.intervalMs);
}

/**
 * Stop the cleanup scheduler
 */
export function stopCleanupScheduler(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    // Release leadership so another instance can take over immediately
    redisPubSub.releaseLeadership(LEADER_NAME).catch(() => {});
    console.log('[cleanup] Cleanup scheduler stopped');
  }
}

/**
 * Get current cleanup config
 */
export function getCleanupConfig(): CleanupConfig {
  return { ...config };
}

/**
 * Manual cleanup trigger (useful for testing)
 */
export async function triggerCleanup(): Promise<void> {
  await runCleanup();
}

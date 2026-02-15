/**
 * Cleanup Scheduler
 *
 * Periodically cleans up expired tokens, old executions, old chat history, and expired push tokens.
 * Runs daily (24h interval) by default, but can be disabled for testing.
 */

import { db } from './db/index.js';
import { taskExecutions, taskChatSessions, pushTokens } from './db/schema.js';
import { lt } from 'drizzle-orm';
import { cleanupExpiredTokens } from './token-manager.js';

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
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await db
    .delete(taskExecutions)
    .where(lt(taskExecutions.createdAt, cutoffDate));

  const count = result.rowCount ?? 0;
  console.log(`[cleanup] Cleaned up ${count} old task executions`);
  return count;
}

/**
 * Clean up old task chat history (older than retention period)
 */
async function cleanupOldChatHistory(retentionDays: number = 180): Promise<number> {
  console.log(`[cleanup] Running old chat history cleanup (retention: ${retentionDays} days)...`);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  // Delete sessions older than cutoff date (messages will cascade delete)
  const result = await db
    .delete(taskChatSessions)
    .where(lt(taskChatSessions.createdAt, cutoffDate));

  const count = result.rowCount ?? 0;
  console.log(`[cleanup] Cleaned up ${count} old chat sessions`);
  return count;
}

/**
 * Clean up expired push tokens (not updated in 90 days - indicates inactive device)
 */
async function cleanupExpiredPushTokens(): Promise<number> {
  console.log('[cleanup] Running expired push token cleanup...');
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90); // 90 days without update = inactive

  const result = await db
    .delete(pushTokens)
    .where(lt(pushTokens.updatedAt, cutoffDate));

  const count = result.rowCount ?? 0;
  console.log(`[cleanup] Cleaned up ${count} expired push tokens`);
  return count;
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
    ]);

    const totalCleaned = results.reduce((sum, count) => sum + count, 0);
    const duration = Date.now() - startTime;

    console.log(`[cleanup] Cleanup completed in ${duration}ms. Total records cleaned: ${totalCleaned}`);
  } catch (error) {
    console.error('[cleanup] Cleanup failed:', error);
  }
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

  // Run cleanup immediately on start
  runCleanup().catch((err) => {
    console.error('[cleanup] Initial cleanup failed:', err);
  });

  // Schedule periodic cleanup
  cleanupTimer = setInterval(() => {
    runCleanup().catch((err) => {
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

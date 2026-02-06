/**
 * Stdout Throttle - Batches high-frequency stdout chunks
 *
 * Buffers stdout data per task and flushes every 100ms,
 * preventing SSE stream overload from rapid output.
 */

export class StdoutThrottle {
  private buffers = new Map<string, string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private flushInterval: number;
  private onFlush: (taskId: string, data: string) => void;

  constructor(onFlush: (taskId: string, data: string) => void, flushInterval = 100) {
    this.onFlush = onFlush;
    this.flushInterval = flushInterval;
  }

  /**
   * Buffer stdout data for a task
   */
  write(taskId: string, data: string): void {
    const existing = this.buffers.get(taskId) || '';
    this.buffers.set(taskId, existing + data);

    // Set up flush timer if not already scheduled
    if (!this.timers.has(taskId)) {
      this.timers.set(
        taskId,
        setTimeout(() => this.flush(taskId), this.flushInterval)
      );
    }
  }

  /**
   * Flush buffered data for a task
   */
  flush(taskId: string): void {
    const data = this.buffers.get(taskId);
    if (data) {
      this.onFlush(taskId, data);
      this.buffers.delete(taskId);
    }

    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
  }

  /**
   * Flush all buffered data and clean up
   */
  flushAll(): void {
    for (const taskId of this.buffers.keys()) {
      this.flush(taskId);
    }
  }

  /**
   * Remove a task's buffer (e.g., when task completes)
   */
  remove(taskId: string): void {
    this.flush(taskId);
    this.buffers.delete(taskId);
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
  }

  /**
   * Shut down and flush all remaining buffers
   */
  shutdown(): void {
    this.flushAll();
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

/**
 * Event Buffer - Ring buffer for SSE reconnection replay
 *
 * Stores recent events with sequential IDs so that when a client
 * reconnects with Last-Event-ID, we can replay missed events.
 *
 * ## Architecture — Intentionally In-Memory, No DB Needed
 *
 * This ring buffer is intentionally kept entirely in-memory. SSE clients
 * establish a persistent HTTP connection to a specific server instance,
 * so the replay buffer only needs to serve reconnections to the same
 * instance. Per-instance buffering is the correct architecture choice:
 *
 * - SSE connections are inherently instance-affine (the client reconnects
 *   to the same backend via sticky sessions or direct connection).
 * - The buffer is small (default 500 events, 5-minute TTL) and ephemeral
 *   by design — it exists solely to bridge brief network interruptions.
 * - Events that matter for long-term consistency (task status changes,
 *   execution results) are persisted to the database by their respective
 *   stores; the SSE stream is a real-time notification layer, not a
 *   durable log.
 *
 * No database migration is needed for this module.
 */

export interface BufferedEvent {
  id: string;
  event: string;
  data: string;
  timestamp: number;
}

export class EventBuffer {
  private buffer: BufferedEvent[] = [];
  private maxSize: number;
  private ttlMs: number;
  private nextId = 1;

  constructor(maxSize = 500, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Add an event to the buffer, returns the assigned event ID
   */
  push(event: string, data: string): string {
    const id = String(this.nextId++);
    this.buffer.push({ id, event, data, timestamp: Date.now() });

    // Evict oldest if over capacity
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }

    return id;
  }

  /**
   * Get events after the given ID (for Last-Event-ID replay)
   */
  getAfter(lastEventId: string): BufferedEvent[] {
    const now = Date.now();
    const numericId = parseInt(lastEventId, 10);
    if (isNaN(numericId)) return [];

    return this.buffer.filter(
      (e) => parseInt(e.id, 10) > numericId && now - e.timestamp < this.ttlMs
    );
  }

  /**
   * Prune expired events
   */
  prune(): void {
    const now = Date.now();
    this.buffer = this.buffer.filter((e) => now - e.timestamp < this.ttlMs);
  }

  get size(): number {
    return this.buffer.length;
  }
}

// Singleton for the SSE event stream
export const eventBuffer = new EventBuffer();

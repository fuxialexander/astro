/**
 * Execution Event Bus
 *
 * Shared singleton EventEmitter for local execution streaming.
 * Local dispatch writes events here; the SSE events route subscribes
 * to forward them to all browser clients via the events bridge.
 *
 * Event types mirror the relay server protocol:
 * - task:stdout, task:result, task:tool_trace, task:file_change, task:progress
 */

import { EventEmitter } from 'events'

class ExecutionEventBus extends EventEmitter {}

// Use globalThis to guarantee singleton across module reloads (tsx watch)
const globalKey = '__nexus_execution_event_bus__'
const g = globalThis as unknown as Record<string, ExecutionEventBus>

if (!g[globalKey]) {
  g[globalKey] = new ExecutionEventBus()
}

export const executionEventBus: ExecutionEventBus = g[globalKey]

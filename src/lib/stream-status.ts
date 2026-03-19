/**
 * Unified stream status derivation.
 *
 * Replaces per-pathway status logic with a single function that computes
 * stream status from the event sequence.
 *
 * Part of the Unified Streaming Pipeline (Phase 2).
 */

import type { TaskActivityEvent } from "@/types"
import type { TaskStream } from "@/stores/realtime-store"

export type StreamStatus = 'idle' | 'streaming' | 'completed' | 'error' | 'awaiting_approval'

/**
 * Derive the current stream status from activity events and optional task stream metadata.
 *
 * Status precedence:
 * 1. error — terminal, from error events or taskStream failure
 * 2. completed — terminal, from result events or taskStream success
 * 3. awaiting_approval — non-terminal, from unmatched approval_request
 * 4. streaming — non-terminal, has events but no terminal condition
 * 5. idle — no events and no active stream
 */
export function deriveStreamStatus(
  activityEvents: TaskActivityEvent[],
  taskStream?: TaskStream,
): StreamStatus {
  // Check taskStream status first (comes from task:result SSE)
  if (taskStream?.status === 'failure' || taskStream?.status === 'error') return 'error'
  if (taskStream?.status === 'success' || taskStream?.status === 'completed') return 'completed'

  if (activityEvents.length === 0) {
    if (taskStream?.status === 'running') return 'streaming'
    return 'idle'
  }

  // Scan from end for terminal events (more efficient for long streams)
  for (let i = activityEvents.length - 1; i >= 0; i--) {
    const e = activityEvents[i]
    if (e.type === 'error') return 'error'
  }

  // Check for pending approvals (unmatched approval_request)
  const approvalRequests = new Set<string>()
  const approvalResponses = new Set<string>()
  for (const e of activityEvents) {
    if (e.type === 'approval_request') approvalRequests.add(e.requestId)
    if (e.type === 'approval_response') approvalResponses.add(e.requestId)
  }
  for (const reqId of approvalRequests) {
    if (!approvalResponses.has(reqId)) return 'awaiting_approval'
  }

  // Has events but no terminal event
  if (taskStream?.status === 'running') return 'streaming'

  // If we have activity events but taskStream shows no running status,
  // this is likely a completed stream viewed after the fact
  return 'completed'
}

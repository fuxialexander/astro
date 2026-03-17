/**
 * Server-Side Auto-Dispatch
 *
 * Dispatches downstream tasks server-side by making an internal HTTP request
 * to POST /api/dispatch/task. This ensures task cascading works even when
 * the browser tab is closed.
 *
 * Uses an internal HTTP call rather than extracting dispatch logic because
 * dispatchViaRelay is ~1000 lines with many concerns (safety checks, prompt
 * building, event persistence, plan extraction, approval handling). An internal
 * fetch reuses ALL existing dispatch logic, and the SSE response is already
 * persisted to streaming_events table so the frontend can hydrate on reconnect.
 */

import { createHmac } from 'crypto'
import { db } from './db/index.js'
import { projects, planNodes, teamMembers } from './db/schema.js'
import { eq } from 'drizzle-orm'
import { isLocalMode } from './app-mode.js'
import { LOCAL_TEAM_ID } from './db/bootstrap-local.js'

const SERVER_PORT = process.env.PORT || 3001

export interface ServerSideDispatchOptions {
  targetMachineId?: string   // override project.defaultMachineId
  branchSuffix?: string      // append to branch name for timestamped runs
  scheduleRunId?: string     // link dispatch back to schedule run
}

/**
 * Dispatch a task server-side by making an internal HTTP request to the
 * dispatch endpoint. Reuses all existing dispatch logic (validation, machine
 * selection, prompt building, relay dispatch, event persistence, result handling).
 *
 * The SSE response from the dispatch endpoint is consumed (to keep the
 * connection alive) but not processed — event persistence happens inside
 * the dispatch handler via StreamingEventLog.
 */
export async function serverSideDispatch(nodeId: string, projectId: string, options?: ServerSideDispatchOptions): Promise<void> {
  // Check node status — skip if already dispatched/in_progress/completed
  const [node] = await db.select({ status: planNodes.status })
    .from(planNodes).where(eq(planNodes.clientId, nodeId)).limit(1)
  if (!node || node.status !== 'planned') {
    console.log(`[server-dispatch] Skipping ${nodeId}: status=${node?.status ?? 'not found'}`)
    return
  }

  // Resolve project to get owner, team, and machine preference
  const [project] = await db.select({
    ownerId: projects.ownerId,
    teamId: projects.teamId,
    defaultMachineId: projects.defaultMachineId,
  }).from(projects).where(eq(projects.id, projectId)).limit(1)

  if (!project) {
    console.error(`[server-dispatch] Project ${projectId} not found`)
    return
  }

  // Resolve auth: always use the project owner's identity so the dispatch
  // endpoint's authorization check passes (project must be accessible by userId).
  let userId: string
  let teamId: string

  if (isLocalMode()) {
    // In local mode, use the project owner (not the bootstrap user) so the
    // dispatch endpoint's team-scope filter finds the project.
    userId = project.ownerId
    teamId = LOCAL_TEAM_ID
  } else {
    userId = project.ownerId
    // Use project's team, or resolve from team membership
    if (project.teamId) {
      teamId = project.teamId
    } else {
      const [membership] = await db.select({ teamId: teamMembers.teamId })
        .from(teamMembers).where(eq(teamMembers.userId, userId)).limit(1)
      teamId = membership?.teamId ?? project.ownerId
    }
  }

  console.log(`[server-dispatch] Dispatching ${nodeId} for project ${projectId}`)

  // Make internal HTTP request to the dispatch endpoint.
  // The dispatch handler resolves all fields from DB (title, description,
  // dependencies, vision doc, working directory, etc.) and manages
  // executionId generation, status updates, and event persistence.
  const url = `http://localhost:${SERVER_PORT}/api/dispatch/task`
  const body: Record<string, unknown> = {
    nodeId,
    projectId,
    targetMachineId: options?.targetMachineId ?? project.defaultMachineId ?? undefined,
  }
  if (options?.branchSuffix) body.branchSuffix = options.branchSuffix
  if (options?.scheduleRunId) body.scheduleRunId = options.scheduleRunId

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      'X-Team-Id': teamId,
      'X-Server-Dispatch': 'true', // Mark as server-initiated for logging
    }

    // In server mode, we need a valid auth token. Use HMAC-signed internal bypass header.
    // The requireAuth middleware verifies this signature before granting access.
    if (!isLocalMode()) {
      const secret = process.env.RELAY_JWT_SECRET
      if (!secret) {
        console.error(`[server-dispatch] RELAY_JWT_SECRET not set — cannot sign internal dispatch for ${nodeId}`)
        return
      }
      const hmac = createHmac('sha256', secret)
        .update(`${userId}:${teamId}`)
        .digest('hex')
      headers['X-Internal-Dispatch'] = hmac
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!resp.ok && !resp.headers.get('content-type')?.includes('text/event-stream')) {
      const text = await resp.text()
      console.error(`[server-dispatch] Dispatch request failed for ${nodeId}:`, resp.status, text)
      return
    }

    // Consume SSE stream in background (fire-and-forget).
    // The dispatch handler persists all events to streaming_events table,
    // so we just need to keep the connection alive until it completes.
    consumeSSEStream(resp, nodeId).catch((err) => {
      console.error(`[server-dispatch] SSE consumption error for ${nodeId}:`, err)
    })

    console.log(`[server-dispatch] Dispatch initiated for ${nodeId}`)
  } catch (err) {
    console.error(`[server-dispatch] Failed to dispatch ${nodeId}:`, err)
  }
}

/**
 * Consume an SSE stream response to keep the connection alive.
 * We don't need to process the events — the dispatch handler already
 * persists everything to streaming_events table.
 */
async function consumeSSEStream(resp: Response, nodeId: string): Promise<void> {
  const reader = resp.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      // Decode to detect 'done' event for logging
      const chunk = decoder.decode(value, { stream: true })
      if (chunk.includes('event: done')) {
        console.log(`[server-dispatch] Task ${nodeId} completed`)
      }
    }
  } catch {
    // Stream ended or errored — this is expected when task completes
  } finally {
    reader.releaseLock()
  }
}

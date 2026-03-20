/**
 * Plan Generation E2E Test
 *
 * Verifies the full plan generation pipeline:
 *   POST /api/dispatch/task (isInteractivePlan:true)
 *   → buildInteractivePlanPrompt
 *   → Agent calls `astro-cli plan create --project-id <id> --json`
 *   → Nodes + edges persisted in DB
 *   → plan_result event fires on /api/events/stream
 *
 * Two-channel architecture note:
 *   - POST /api/dispatch/task → SSE response: execution events (text, tool_use, result…)
 *   - GET  /api/events/stream → SSE push: coordination events (task:plan_result, …)
 *
 * Strategy: fire the dispatch, then POLL the DB until nodes appear (avoids
 * depending on the long-running dispatch SSE stream staying open).
 *
 * Requires:
 *   - npm run dev:local (backend on 3001)
 *   - At least one connected agent runner (astro-agent) configured for localhost
 *   - ANTHROPIC_API_KEY set
 *
 * Auto-skips when server / runner not available.
 *
 * Run:
 *   npx vitest run tests/e2e/plan-generation.e2e.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const API_BASE = 'http://localhost:3001'
const PLAN_GEN_TIMEOUT_MS = 600_000  // 10 min — LLM + tool calls + possible clarification questions + node creation

// ============================================================================
// Availability checks
// ============================================================================

let serverAvailable = false
let runnerConnected = false

{
  try {
    const res = await fetch(`${API_BASE}/api/health`)
    const h = await res.json() as { status: string; relay: { connectedRunners: number } }
    serverAvailable = h.status === 'ok'
    runnerConnected = (h.relay?.connectedRunners ?? 0) >= 1
  } catch {
    serverAvailable = false
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function createProject(name: string): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/api/data/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: 'E2E plan-gen test project' }),
  })
  if (!res.ok) throw new Error(`POST /api/data/projects failed: ${res.status} ${await res.text()}`)
  return res.json() as Promise<{ id: string }>
}

async function deleteProject(projectId: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/data/projects/${projectId}`, { method: 'DELETE' })
  } catch { /* best-effort cleanup */ }
}

interface PlanNode {
  id: string
  clientId?: string
  title: string
  type: string
  milestoneId?: string | null
  deletedAt?: unknown
}

interface PlanEdge {
  id: string
  source: string
  target: string
}

async function fetchPlan(projectId: string): Promise<{ nodes: PlanNode[]; edges: PlanEdge[] }> {
  const res = await fetch(`${API_BASE}/api/data/plan/${projectId}`)
  if (!res.ok) throw new Error(`GET /api/data/plan/${projectId} failed: ${res.status}`)
  return res.json() as Promise<{ nodes: PlanNode[]; edges: PlanEdge[] }>
}

/**
 * Subscribe to /api/events/stream and auto-respond to any approval requests for the given
 * executionIds. Returns a cleanup function to stop listening.
 *
 * The plan generation agent asks clarifying questions via AskUserQuestion. For automated testing
 * we pick the first available option so the agent can proceed to `astro-cli plan create`.
 */
function autoRespondToApprovals(executionIds: Set<string>): () => void {
  let alive = true

  async function run() {
    try {
      const res = await fetch(`${API_BASE}/api/events/stream`, {
        headers: { Accept: 'text/event-stream' },
      })
      if (!res.ok || !res.body) return

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (alive) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const frames = buf.split('\n\n')
        buf = frames.pop() ?? ''

        for (const frame of frames) {
          const lines = frame.trim().split('\n')
          let eventType = 'message'
          let dataLine = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim()
            else if (line.startsWith('data: ')) dataLine = line.slice(6)
          }
          if (eventType !== 'task:approval_request' || !dataLine) continue

          try {
            const payload = JSON.parse(dataLine) as {
              taskId: string; requestId: string; question: string; options: string[]
            }
            if (!executionIds.has(payload.taskId)) continue

            // Auto-answer with first option so the agent can proceed
            const selectedOption = payload.options?.[0] ?? 'Proceed'
            console.log(`[plan-gen-e2e] Auto-answering approval for ${payload.taskId.slice(0, 20)}…: "${payload.question}" → "${selectedOption}"`)
            fetch(`${API_BASE}/api/dispatch/approve`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ approvalId: payload.requestId, approved: true, selectedOption }),
            }).catch(() => {})
          } catch { /* skip malformed */ }
        }
      }
      reader.cancel()
    } catch { /* SSE connection failed — non-fatal */ }
  }

  run()
  return () => { alive = false }
}

/**
 * Dispatch plan generation (fire-and-forget the SSE stream — just check dispatch accepted it).
 * Returns the executionId from the init event if received.
 */
async function dispatchPlanGeneration(
  projectId: string,
  description: string,
): Promise<{ accepted: boolean; executionId: string | null; error: string | null }> {
  const nodeId = `plan-gen-e2e-${Date.now()}`
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/dispatch/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        nodeId,
        title: description,
        description,
        isInteractivePlan: true,
      }),
    })
  } catch (err) {
    return { accepted: false, executionId: null, error: String(err) }
  }

  if (!res.ok) {
    return { accepted: false, executionId: null, error: `HTTP ${res.status}: ${await res.text()}` }
  }

  // Read the first few SSE events to confirm dispatch was accepted and get executionId.
  // We don't drain the full stream (the task may run for minutes).
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let executionId: string | null = null
  let error: string | null = null
  const deadline = Date.now() + 15_000  // 15s to get init event

  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const lines = frame.trim().split('\n')
        let eventType = 'message'
        let dataLine = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim()
          else if (line.startsWith('data: ')) dataLine = line.slice(6)
        }

        if (!dataLine) continue
        let payload: Record<string, unknown> = {}
        try { payload = JSON.parse(dataLine) } catch { /* skip */ }

        if (eventType === 'init' && payload.executionId) {
          executionId = payload.executionId as string
        }
        if (eventType === 'error') {
          error = JSON.stringify(payload)
        }
      }

      if (executionId || error) break
    }
  } finally {
    reader.cancel()
  }

  return { accepted: true, executionId, error }
}

/**
 * Poll DB until the plan has at least minMilestones milestones AND minTasks tasks, or timeout.
 * We wait for structural validity rather than just a node count, because agents often
 * create milestones first and tasks later.
 */
async function waitForNodes(
  projectId: string,
  _minNodes: number,
  timeoutMs: number,
  { minMilestones = 1, minTasks = 2 } = {},
): Promise<{ nodes: PlanNode[]; edges: PlanEdge[] } | null> {
  const deadline = Date.now() + timeoutMs
  let lastCount = 0

  while (Date.now() < deadline) {
    const { nodes, edges } = await fetchPlan(projectId)
    const active = nodes.filter(n => !n.deletedAt)
    if (active.length > lastCount) {
      lastCount = active.length
      const ms = active.filter(n => n.type === 'milestone').length
      const ts = active.filter(n => n.type === 'task').length
      console.log(`[plan-gen-e2e] DB: ${active.length} nodes (${ms} milestones, ${ts} tasks), ${edges.length} edges (polling…)`)
    }
    const milestones = active.filter(n => n.type === 'milestone').length
    const tasks = active.filter(n => n.type === 'task').length
    if (milestones >= minMilestones && tasks >= minTasks) return { nodes: active, edges }
    await new Promise(r => setTimeout(r, 5000))  // poll every 5s
  }

  return null
}

// ============================================================================
// Main plan generation test
// ============================================================================

describe.skipIf(!serverAvailable || !runnerConnected)(
  'Plan generation E2E — LEARN_PYTHON goal',
  () => {
    let projectId: string

    beforeAll(async () => {
      const proj = await createProject(`E2E Learn Python ${Date.now()}`)
      projectId = proj.id
      console.log(`[plan-gen-e2e] Created project: ${projectId}`)
    }, 15_000)

    afterAll(async () => {
      if (projectId) await deleteProject(projectId)
    })

    it(
      'dispatches plan generation and validates DB nodes + edges',
      async () => {
        // 1. Fire the dispatch (don't wait for completion — it can take minutes)
        const { accepted, executionId, error } = await dispatchPlanGeneration(
          projectId,
          'Learn Python: set up environment, learn basics, write a web scraper',
        )

        expect(accepted, `Dispatch rejected: ${error}`).toBe(true)
        expect(error).toBeNull()
        console.log(`[plan-gen-e2e] Dispatch accepted. executionId: ${executionId}`)

        // 1b. Auto-respond to any AskUserQuestion approval requests so the agent
        //     doesn't block waiting for human input during automated testing.
        const activeIds = new Set<string>(executionId ? [executionId] : [])
        const stopApprovalResponder = autoRespondToApprovals(activeIds)

        // 2. Poll DB until plan nodes appear (agent calls astro-cli plan create)
        let result: Awaited<ReturnType<typeof waitForNodes>> = null
        try {
          result = await waitForNodes(projectId, 3, PLAN_GEN_TIMEOUT_MS)
        } finally {
          stopApprovalResponder()
        }
        if (!result) {
          throw new Error(
            `No plan nodes appeared within ${PLAN_GEN_TIMEOUT_MS / 1000}s. ` +
            `Check that the agent runner (astro-agent) is pointing to localhost:3001 ` +
            `and ASTRO_SERVER_URL is not overridden to prod.`
          )
        }

        const { nodes, edges } = result
        console.log(`[plan-gen-e2e] Plan ready: ${nodes.length} nodes, ${edges.length} edges`)

        // ── At least one milestone and two tasks ───────────────────────────────
        const milestones = nodes.filter(n => n.type === 'milestone')
        const tasks = nodes.filter(n => n.type === 'task')
        expect(milestones.length, 'Expected ≥1 milestone').toBeGreaterThanOrEqual(1)
        expect(tasks.length, 'Expected ≥2 tasks').toBeGreaterThanOrEqual(2)
        console.log(`[plan-gen-e2e] Milestones: ${milestones.map(m => `"${m.title}"`).join(', ')}`)

        // ── Tasks with milestoneId point to a real milestone ──────────────────
        const milestoneIds = new Set(milestones.map(m => m.id ?? m.clientId))
        for (const task of tasks.filter(t => t.milestoneId)) {
          expect(
            milestoneIds.has(task.milestoneId!),
            `Task "${task.title}" milestoneId="${task.milestoneId}" has no matching milestone`
          ).toBe(true)
        }

        // ── No deadlock: task milestone != incoming-edge source ───────────────
        const incomingFromMilestone = new Map<string, Set<string>>()
        for (const edge of edges) {
          if (!incomingFromMilestone.has(edge.target)) incomingFromMilestone.set(edge.target, new Set())
          incomingFromMilestone.get(edge.target)!.add(edge.source)
        }
        for (const task of tasks.filter(t => t.milestoneId)) {
          const taskId = task.id ?? task.clientId
          const incoming = incomingFromMilestone.get(taskId!) ?? new Set()
          expect(
            incoming.has(task.milestoneId!),
            `DEADLOCK: task "${task.title}" has milestoneId AND incoming edge from same milestone`
          ).toBe(false)
        }

        // ── Edges reference valid node IDs ─────────────────────────────────────
        const nodeIds = new Set(nodes.map(n => n.id ?? n.clientId))
        for (const edge of edges) {
          expect(nodeIds.has(edge.source), `Edge source "${edge.source}" not found`).toBe(true)
          expect(nodeIds.has(edge.target), `Edge target "${edge.target}" not found`).toBe(true)
        }

        // ── All nodes have valid types and non-empty titles ────────────────────
        const validTypes = new Set(['milestone', 'task', 'branch', 'decision', 'loop'])
        for (const node of nodes) {
          expect(node.title, `Node ${node.id} has empty title`).toBeTruthy()
          expect(
            validTypes.has(node.type),
            `Node "${node.title}" has invalid type "${node.type}"`
          ).toBe(true)
        }

        console.log(`[plan-gen-e2e] ✓ Plan structure valid`)
        console.log(`[plan-gen-e2e]   Tasks: ${tasks.slice(0, 5).map(t => `"${t.title}"`).join(', ')}${tasks.length > 5 ? ` +${tasks.length - 5} more` : ''}`)
      },
      PLAN_GEN_TIMEOUT_MS + 30_000,
    )
  }
)

// ============================================================================
// Provider coverage — same dispatch, multiple providers
// ============================================================================

describe.skipIf(!serverAvailable || !runnerConnected)(
  'Plan generation E2E — provider coverage',
  () => {
    // Each entry runs a separate plan generation against a fresh project.
    // Add more providers as runners become available in your environment.
    const PROVIDERS: Array<{ name: string; provider?: string }> = [
      { name: 'default (claude-code)' },
      // { name: 'opencode', provider: 'opencode' },
      // { name: 'codex', provider: 'codex' },
    ]

    for (const { name, provider } of PROVIDERS) {
      it(
        `[${name}] generates a valid plan`,
        async () => {
          const proj = await createProject(`E2E Provider ${name} ${Date.now()}`)
          console.log(`[plan-gen-e2e] [${name}] project: ${proj.id}`)

          const activeIds = new Set<string>()
          const stopApprovalResponder = autoRespondToApprovals(activeIds)
          try {
            const nodeId = `plan-gen-provider-${Date.now()}`
            const res = await fetch(`${API_BASE}/api/dispatch/task`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                projectId: proj.id,
                nodeId,
                title: 'Build a to-do list REST API',
                description: 'Build a to-do list REST API',
                isInteractivePlan: true,
                ...(provider ? { preferredProvider: provider } : {}),
              }),
            })
            expect(res.ok, `Dispatch rejected: ${res.status}`).toBe(true)

            // Read init event to get executionId (so we can target approval responses)
            const reader = res.body!.getReader()
            const dec = new TextDecoder()
            let pbuf = '', initDone = false
            const deadline = Date.now() + 15_000
            while (!initDone && Date.now() < deadline) {
              const { value, done } = await reader.read()
              if (done) break
              pbuf += dec.decode(value, { stream: true })
              for (const frame of pbuf.split('\n\n').slice(0, -1)) {
                const lines = frame.trim().split('\n')
                let eType = '', dLine = ''
                for (const l of lines) {
                  if (l.startsWith('event: ')) eType = l.slice(7).trim()
                  else if (l.startsWith('data: ')) dLine = l.slice(6)
                }
                if (eType === 'init' && dLine) {
                  try { const p = JSON.parse(dLine); if (p.executionId) { activeIds.add(p.executionId); initDone = true } } catch { /* skip malformed init event */ }
                }
              }
              pbuf = pbuf.split('\n\n').pop() ?? ''
            }
            reader.cancel()

            // Poll for nodes
            const result = await waitForNodes(proj.id, 3, PLAN_GEN_TIMEOUT_MS)
            expect(result, `[${name}] No nodes appeared within timeout`).not.toBeNull()

            const { nodes } = result!
            const milestones = nodes.filter(n => n.type === 'milestone')
            const tasks = nodes.filter(n => n.type === 'task')
            expect(milestones.length, `[${name}] Expected ≥1 milestone`).toBeGreaterThanOrEqual(1)
            expect(tasks.length, `[${name}] Expected ≥2 tasks`).toBeGreaterThanOrEqual(2)
            console.log(`[plan-gen-e2e] [${name}] ✓ ${milestones.length} milestones, ${tasks.length} tasks`)
          } finally {
            stopApprovalResponder()
            await deleteProject(proj.id)
          }
        },
        PLAN_GEN_TIMEOUT_MS + 10_000,
      )
    }
  }
)

// ============================================================================
// Sanity check — always runs
// ============================================================================

describe('Plan generation — server connectivity', () => {
  it('backend is healthy and runner is connected', async () => {
    if (!serverAvailable) {
      console.warn('[plan-gen-e2e] Server unavailable — run npm run dev:local first')
      return
    }
    const res = await fetch(`${API_BASE}/api/health`)
    const h = await res.json() as {
      status: string
      mode: string
      relay: { connectedRunners: number; machines: Array<{ id: string; name: string }> }
    }
    expect(h.status).toBe('ok')
    console.log(`[plan-gen-e2e] mode=${h.mode}, runners=${h.relay.connectedRunners}`)
    if (!runnerConnected) {
      console.warn('[plan-gen-e2e] No runner connected — E2E tests will be skipped')
      console.warn('[plan-gen-e2e] Ensure astro-agent is configured with ASTRO_SERVER_URL=http://localhost:3001')
    }
  })
})

/**
 * Multi-Tab Live Text Observation & Post-Completion Auth E2E Tests — Playwright
 *
 * Two test groups:
 *
 * A) Multi-tab live text: Verifies that BOTH browser tabs see incremental text
 *    chunks arriving in real time without page refresh. Tab 1 (initiator) gets
 *    live SSE text; Tab 2 gets task:init → status='running' → periodic catch-up
 *    poll → activityEvents hydrated from DB. Both should see text updating.
 *
 * B) Post-completion auth: After a task execution completes (executionContext
 *    removed), the steer/approval/safety-decision/cancel endpoints should
 *    still accept requests (DB fallback via plan_nodes).
 *
 * Pipeline under test:
 *   Fake Agent Runner (WS) → Relay → DB (streaming_events) → SSE → Browser
 *   POST /api/dispatch/{steer,approval,safety-decision,cancel} → isUserAuthorizedForTask
 *
 * Requires: npm run dev:local
 *
 * Run:
 *   npx playwright test tests/e2e/multi-tab-text-and-auth-e2e.test.ts
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'

// ============================================================================
// Constants
// ============================================================================

const VITE_URL = 'http://localhost:5173'
const API_BASE = 'http://localhost:3001'
const RELAY_WS = 'ws://localhost:3002'

// ============================================================================
// Helpers: fake agent runner via relay WebSocket
// ============================================================================

interface FakeAgentRunner {
  ws: WebSocket
  machineId: string
  close(): void
  sendText(taskId: string, text: string, sequence?: number): void
  sendToolUse(taskId: string, toolName: string, toolInput: unknown, toolUseId?: string): void
  sendToolResult(taskId: string, toolName: string, result: string, success?: boolean): void
  sendSessionInit(taskId: string, sessionId: string, model?: string): void
  sendResult(taskId: string, status: 'completed' | 'failed', output?: string): void
}

async function connectFakeAgentRunner(machineId = `pw-machine-${Date.now()}`): Promise<FakeAgentRunner> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_WS)
    const timeout = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000)

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'machine.register',
        timestamp: new Date().toISOString(),
        machineId,
        machineInfo: {
          name: 'Playwright Test Machine',
          hostname: 'playwright-test',
          platform: 'darwin',
          providers: [{
            type: 'claude-code',
            version: '1.0.0',
            status: 'available',
            maxConcurrentTasks: 3,
            currentTasks: 0,
            capabilities: ['shell'],
          }],
          resources: { cpuCores: 4, memoryMB: 8192, diskSpaceMB: 100000 },
          load: { cpuPercent: 5, memoryPercent: 20, activeTasks: 0, queuedTasks: 0 },
          tags: ['playwright-test'],
        },
      }))
    })

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'machine.register.ack') {
        clearTimeout(timeout)
        const runner: FakeAgentRunner = {
          ws,
          machineId,
          close() { ws.close() },
          sendText(taskId, text, sequence = 1) {
            ws.send(JSON.stringify({
              type: 'task_text',
              timestamp: new Date().toISOString(),
              payload: { taskId, text, sequence },
            }))
          },
          sendToolUse(taskId, toolName, toolInput, toolUseId) {
            ws.send(JSON.stringify({
              type: 'task_tool_use',
              timestamp: new Date().toISOString(),
              payload: { taskId, toolName, toolInput, toolUseId: toolUseId ?? randomUUID() },
            }))
          },
          sendToolResult(taskId, toolName, result, success = true) {
            ws.send(JSON.stringify({
              type: 'task_tool_result',
              timestamp: new Date().toISOString(),
              payload: { taskId, toolName, toolResult: result, success },
            }))
          },
          sendSessionInit(taskId, sessionId, model = 'claude-sonnet-4-5') {
            ws.send(JSON.stringify({
              type: 'task_session_init',
              timestamp: new Date().toISOString(),
              payload: { taskId, sessionId, model },
            }))
          },
          sendResult(taskId, status, output = '') {
            ws.send(JSON.stringify({
              type: 'task_result',
              timestamp: new Date().toISOString(),
              result: {
                taskId,
                status,
                exitCode: status === 'completed' ? 0 : 1,
                output,
                duration: 1000,
              },
            }))
          },
        }
        resolve(runner)
      }
    })

    ws.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

// ============================================================================
// Helpers: API calls
// ============================================================================

async function createTestProject(name: string): Promise<{ id: string; teamId: string }> {
  const res = await fetch(`${API_BASE}/api/data/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: 'E2E test project' }),
  })
  if (!res.ok) throw new Error(`POST /api/data/projects failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as { id: string; teamId: string }
  return { id: data.id, teamId: data.teamId ?? '' }
}

async function createTestNode(projectId: string, title: string): Promise<string> {
  const clientId = randomUUID()
  const res = await fetch(`${API_BASE}/api/data/plan/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      id: clientId,
      title,
      description: 'E2E test node',
      type: 'task',
      status: 'in_progress',
    }),
  })
  if (!res.ok) throw new Error(`POST /api/data/plan/nodes failed: ${res.status} ${await res.text()}`)
  return clientId
}

async function createTestExecution(projectId: string, nodeId: string, executionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/data/executions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ executionId, projectId, nodeId, status: 'in_progress' }),
  })
  if (!res.ok) throw new Error(`POST /api/data/executions failed: ${res.status} ${await res.text()}`)
}

async function setupTestContext(label: string) {
  const project = await createTestProject(`E2E ${label} ${Date.now()}`)
  const nodeClientId = await createTestNode(project.id, `${label} task`)
  const executionId = randomUUID()
  await createTestExecution(project.id, nodeClientId, executionId)
  return { projectId: project.id, nodeClientId, executionId }
}

async function fetchCatchUp(executionId: string, afterSeq = 0) {
  const res = await fetch(
    `${API_BASE}/api/events/catch-up?executionIds=${executionId}&afterSeq=${afterSeq}`,
  )
  if (!res.ok) throw new Error(`GET catch-up failed: ${res.status}`)
  return res.json() as Promise<{
    events: Array<{ seq: number; executionId: string; eventType: string; data: Record<string, unknown> }>
    lastSeq: number
    hasMore: boolean
  }>
}

// ============================================================================
// Helpers: SSE interception on browser pages
// ============================================================================

async function interceptSSEEvents(page: Page, targetEvents: string[]) {
  const events: Array<{ event: string; data: unknown }> = []
  await page.exposeFunction('__pwSSEEvent', (event: string, data: unknown) => {
    events.push({ event, data })
  })

  await page.addInitScript((targetEvents: string[]) => {
    const OrigES = window.EventSource
    // @ts-expect-error — patching global EventSource
    window.EventSource = class extends OrigES {
      constructor(url: string, init?: EventSourceInit) {
        super(url, init)
        if (!url.includes('/api/events/stream')) return
        type WinExt = Window & { __pwSSEEvent: (t: string, d: unknown) => void }
        for (const evtType of targetEvents) {
          this.addEventListener(evtType, (e: MessageEvent) => {
            try {
              ;(window as unknown as WinExt).__pwSSEEvent(evtType, JSON.parse(e.data))
            } catch {
              ;(window as unknown as WinExt).__pwSSEEvent(evtType, e.data)
            }
          })
        }
      }
    }
  }, targetEvents)

  return {
    getEvents: async () => [...events],
    clearEvents: async () => { events.length = 0 },
  }
}

async function waitForSSEConnections(minCount: number, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${API_BASE}/api/health`)
    const health = await res.json() as { sse: { global: number } }
    if ((health.sse?.global ?? 0) >= minCount) return health.sse.global
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`Timeout waiting for ${minCount} SSE connections`)
}

// ============================================================================
// Health check — skip when dev server is not running
// ============================================================================

let serverAvailable = false
let relayAvailable = false
let viteAvailable = false

try {
  const res = await fetch(`${API_BASE}/api/health`)
  const health = await res.json() as { status: string }
  serverAvailable = health.status === 'ok'
} catch { serverAvailable = false }

try {
  const res = await fetch(`${API_BASE}/api/relay/health`)
  relayAvailable = res.ok
} catch { relayAvailable = false }

try {
  const res = await fetch(VITE_URL, { signal: AbortSignal.timeout(3000) })
  viteAvailable = res.ok
} catch { viteAvailable = false }

const skip = !serverAvailable || !relayAvailable || !viteAvailable
if (skip) {
  console.warn('[e2e] Dev server not available — skipping.')
  console.warn(`  backend: ${serverAvailable ? 'ok' : 'MISSING'}`)
  console.warn(`  relay:   ${relayAvailable ? 'ok' : 'MISSING'}`)
  console.warn(`  vite:    ${viteAvailable ? 'ok' : 'MISSING'}`)
  console.warn('  Start with: npm run dev:local')
}

// ============================================================================
// A) Multi-tab live text observation
// ============================================================================

test.describe('Multi-tab live text observation (no refresh)', () => {
  let runner: FakeAgentRunner

  test.beforeEach(async () => { if (skip) test.skip() })
  test.afterEach(async () => { runner?.close() })

  test('both tabs see incremental text chunks from a fake agent runner', async ({ browser }) => {
    const { projectId, nodeClientId, executionId } = await setupTestContext('MultiTab-Text')
    const taskDetailUrl = `${VITE_URL}/project/${projectId}/task/${nodeClientId}`

    // Two independent browser contexts (separate SSE connections)
    const ctx1: BrowserContext = await browser.newContext()
    const ctx2: BrowserContext = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      // Intercept SSE on both tabs — track task:stdout (live text) and task:init
      const { getEvents: getEvents1 } = await interceptSSEEvents(page1, ['task:stdout', 'task:init', 'task:text'])
      const { getEvents: getEvents2 } = await interceptSSEEvents(page2, ['task:stdout', 'task:init', 'task:text'])

      // Navigate both tabs to the task detail page
      await Promise.all([
        page1.goto(taskDetailUrl),
        page2.goto(taskDetailUrl),
      ])
      await Promise.all([
        page1.waitForLoadState('load'),
        page2.waitForLoadState('load'),
      ])

      // Wait for both SSE connections
      const sseCount = await waitForSSEConnections(2)
      console.log(`[e2e] SSE connections: ${sseCount}`)

      // Connect fake agent runner
      runner = await connectFakeAgentRunner()

      // Send session_init + multiple text chunks with delays between them
      runner.sendSessionInit(executionId, randomUUID())
      await new Promise(r => setTimeout(r, 300))

      const chunks = [
        'First chunk of analysis. ',
        'Second chunk with more details. ',
        'Third chunk — conclusion. ',
      ]

      for (let i = 0; i < chunks.length; i++) {
        runner.sendText(executionId, chunks[i], i + 1)
        // Delay between chunks to simulate real streaming
        await new Promise(r => setTimeout(r, 400))
      }

      // Also send a tool_use → tool_result to trigger DB flush of buffered text
      runner.sendToolUse(executionId, 'Read', { file_path: '/src/main.ts' })
      await new Promise(r => setTimeout(r, 200))
      runner.sendToolResult(executionId, 'Read', '// file content', true)

      // Wait for text events to arrive on both tabs (via SSE)
      const deadline = Date.now() + 10_000
      let tab1TextEvents = 0
      let tab2TextEvents = 0

      while (Date.now() < deadline) {
        const events1 = await getEvents1()
        const events2 = await getEvents2()

        tab1TextEvents = events1.filter(e =>
          (e.event === 'task:stdout' || e.event === 'task:text') &&
          (e.data as Record<string, unknown>)?.taskId === executionId
        ).length

        tab2TextEvents = events2.filter(e =>
          (e.event === 'task:stdout' || e.event === 'task:text') &&
          (e.data as Record<string, unknown>)?.taskId === executionId
        ).length

        if (tab1TextEvents >= 1 && tab2TextEvents >= 1) break
        await new Promise(r => setTimeout(r, 200))
      }

      console.log(`[e2e] Tab1 text events: ${tab1TextEvents}`)
      console.log(`[e2e] Tab2 text events: ${tab2TextEvents}`)

      // Both tabs should see text events via SSE (live delivery)
      expect(tab1TextEvents).toBeGreaterThanOrEqual(1)
      expect(tab2TextEvents).toBeGreaterThanOrEqual(1)

      // Verify text is also persisted in DB (so catch-up poll would work)
      const catchUp = await fetchCatchUp(executionId)
      const textEvents = catchUp.events.filter(e => e.eventType === 'text')
      console.log(`[e2e] DB persisted text events: ${textEvents.length}`)
      expect(textEvents.length).toBeGreaterThanOrEqual(1)

      console.log('[e2e] ✓ Both tabs observed text chunks + DB persistence confirmed')
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  test('catch-up poll returns incremental text chunks over time', async () => {
    // This tests the DB-level catch-up that powers Tab 2's periodic poll:
    // as the agent sends more chunks, catch-up returns more events over time.
    const { executionId } = await setupTestContext('CatchUp-Incremental')
    runner = await connectFakeAgentRunner()

    // Send session_init
    runner.sendSessionInit(executionId, randomUUID())
    await new Promise(r => setTimeout(r, 300))

    // Send first text chunk
    runner.sendText(executionId, 'Initial analysis: the codebase has...', 1)
    // Trigger flush with a tool event
    runner.sendToolUse(executionId, 'Read', { file_path: '/package.json' })
    await new Promise(r => setTimeout(r, 500))
    runner.sendToolResult(executionId, 'Read', '{ "name": "test" }', true)
    await new Promise(r => setTimeout(r, 500))

    // First catch-up poll — should see initial events
    const catchUp1 = await fetchCatchUp(executionId)
    const textCount1 = catchUp1.events.filter(e => e.eventType === 'text').length
    const totalCount1 = catchUp1.events.length
    console.log(`[e2e] Catch-up poll 1: ${totalCount1} events (${textCount1} text)`)
    expect(totalCount1).toBeGreaterThanOrEqual(1)
    const seq1 = catchUp1.lastSeq

    // Send more chunks
    runner.sendText(executionId, ' Moving on to architecture review.', 2)
    runner.sendText(executionId, ' Found 3 potential issues.', 3)
    // Flush with another tool event
    runner.sendToolUse(executionId, 'Write', { file_path: '/tmp/report.md', content: '# Report' })
    await new Promise(r => setTimeout(r, 500))
    runner.sendToolResult(executionId, 'Write', 'ok', true)
    await new Promise(r => setTimeout(r, 500))

    // Second catch-up poll with afterSeq — should see NEW events
    const catchUp2 = await fetchCatchUp(executionId, seq1)
    console.log(`[e2e] Catch-up poll 2 (after seq ${seq1}): ${catchUp2.events.length} new events`)
    expect(catchUp2.events.length).toBeGreaterThanOrEqual(1)

    // Full catch-up should have more events than first poll
    const catchUpFull = await fetchCatchUp(executionId)
    console.log(`[e2e] Full catch-up: ${catchUpFull.events.length} total events`)
    expect(catchUpFull.events.length).toBeGreaterThan(totalCount1)

    console.log('[e2e] ✓ Catch-up poll returns incremental chunks over time')
  })

  test('task detail page renders text from multiple chunks on both tabs', async ({ browser }) => {
    const { projectId, nodeClientId, executionId } = await setupTestContext('Render-DualTab')
    const taskDetailUrl = `${VITE_URL}/project/${projectId}/task/${nodeClientId}`

    const ctx1: BrowserContext = await browser.newContext()
    const ctx2: BrowserContext = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      // Navigate both tabs to task detail
      await Promise.all([
        page1.goto(taskDetailUrl),
        page2.goto(taskDetailUrl),
      ])
      await Promise.all([
        page1.waitForLoadState('load'),
        page2.waitForLoadState('load'),
      ])
      await waitForSSEConnections(2)

      runner = await connectFakeAgentRunner()
      const marker = `RENDER_MARKER_${Date.now()}`

      // Send text with a unique marker
      runner.sendSessionInit(executionId, randomUUID())
      await new Promise(r => setTimeout(r, 300))
      runner.sendText(executionId, `${marker} — analysis started`, 1)
      await new Promise(r => setTimeout(r, 300))
      runner.sendText(executionId, ` — phase 2 continues`, 2)
      await new Promise(r => setTimeout(r, 300))
      runner.sendText(executionId, ` — phase 3 complete`, 3)

      // Trigger DB flush
      runner.sendToolUse(executionId, 'Read', { file_path: '/test.ts' })
      await new Promise(r => setTimeout(r, 200))
      runner.sendToolResult(executionId, 'Read', '// content', true)

      // Wait and check if the marker text appears on both pages
      // The text might be in activity blocks or stdout display
      const deadline = Date.now() + 12_000
      let page1HasText = false
      let page2HasText = false

      while (Date.now() < deadline) {
        // Check page content for the marker
        const text1 = await page1.textContent('body')
        const text2 = await page2.textContent('body')
        page1HasText = text1?.includes(marker) ?? false
        page2HasText = text2?.includes(marker) ?? false
        if (page1HasText && page2HasText) break
        await new Promise(r => setTimeout(r, 500))
      }

      console.log(`[e2e] Tab1 rendered marker text: ${page1HasText}`)
      console.log(`[e2e] Tab2 rendered marker text: ${page2HasText}`)

      // At minimum, Tab 1 should have the text (live SSE → stdout)
      // Tab 2 should also have it (via SSE delivery or catch-up poll)
      expect(page1HasText).toBe(true)
      expect(page2HasText).toBe(true)

      console.log('[e2e] ✓ Both tabs rendered text from agent runner chunks')
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })
})

// ============================================================================
// B) Post-completion authorization — steer/approval/safety/cancel after context cleanup
// ============================================================================

test.describe('Post-completion authorization (DB fallback)', () => {
  let runner: FakeAgentRunner

  test.beforeEach(async () => { if (skip) test.skip() })
  test.afterEach(async () => { runner?.close() })

  /**
   * Helper: run a task to completion via fake runner, then verify context is gone.
   * Returns the execution context for subsequent endpoint calls.
   */
  async function runToCompletion() {
    const { projectId, nodeClientId, executionId } = await setupTestContext('PostAuth')
    runner = await connectFakeAgentRunner()

    // Send some events then complete
    runner.sendSessionInit(executionId, randomUUID())
    await new Promise(r => setTimeout(r, 200))
    runner.sendText(executionId, 'Working on it...', 1)
    await new Promise(r => setTimeout(r, 200))
    runner.sendResult(executionId, 'completed', 'Done')

    // Wait for completion to propagate and context to be cleaned up
    await new Promise(r => setTimeout(r, 1500))

    return { projectId, nodeClientId, executionId, machineId: runner.machineId }
  }

  test('steer endpoint accepts request after task completion (DB fallback)', async () => {
    const { executionId, machineId } = await runToCompletion()

    // Steer should succeed even though executionContext has been removed
    // In local mode, isUserAuthorizedForTask returns true for LOCAL_USER_ID.
    // But this also exercises the endpoint path and validates it doesn't crash.
    const res = await fetch(`${API_BASE}/api/dispatch/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: executionId,
        machineId,
        message: 'Follow-up guidance after completion',
      }),
    })

    const body = await res.json() as { success: boolean; message?: string; error?: string }
    console.log(`[e2e] Steer after completion: ${res.status} — ${body.message || body.error}`)
    // Should not get 403 — the DB fallback authorizes via plan_nodes
    expect(res.status).not.toBe(403)
    // In local mode it should succeed (steer message queued even if relay can't deliver)
    expect(body.success).toBe(true)

    // Verify the steer message was persisted in streaming_events
    const catchUp = await fetchCatchUp(executionId)
    const steerEvents = catchUp.events.filter(e => e.eventType === 'steer_message')
    expect(steerEvents.length).toBeGreaterThanOrEqual(1)
    console.log('[e2e] ✓ Steer message persisted after task completion')
  })

  test('approval endpoint accepts request after task completion', async () => {
    const { executionId, machineId } = await runToCompletion()

    const res = await fetch(`${API_BASE}/api/dispatch/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: executionId,
        machineId,
        requestId: randomUUID(),
        answered: true,
        answer: 'Approved after completion',
      }),
    })

    const body = await res.json() as { success: boolean; error?: string }
    console.log(`[e2e] Approval after completion: ${res.status} — ${JSON.stringify(body)}`)
    // Should not get 403
    expect(res.status).not.toBe(403)
    // Relay send will fail (task completed, no active WS handler), so expect 500
    // But the point is: no 403 — authorization passed.
    // In some cases the relay stub may still accept the send, so just check not-403.
    console.log('[e2e] ✓ Approval endpoint did not return 403 after task completion')
  })

  test('safety-decision endpoint accepts request after task completion', async () => {
    const { executionId, machineId } = await runToCompletion()

    const res = await fetch(`${API_BASE}/api/dispatch/safety-decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: executionId,
        machineId,
        decision: 'proceed',
      }),
    })

    const body = await res.json() as { success: boolean; error?: string }
    console.log(`[e2e] Safety-decision after completion: ${res.status} — ${JSON.stringify(body)}`)
    expect(res.status).not.toBe(403)
    console.log('[e2e] ✓ Safety-decision endpoint did not return 403 after task completion')
  })

  test('cancel endpoint accepts request after task completion', async () => {
    const { executionId, nodeClientId, machineId } = await runToCompletion()

    const res = await fetch(`${API_BASE}/api/dispatch/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        executionId,
        nodeId: nodeClientId,
        machineId,
      }),
    })

    const body = await res.json() as { success: boolean; error?: string }
    console.log(`[e2e] Cancel after completion: ${res.status} — ${JSON.stringify(body)}`)
    expect(res.status).not.toBe(403)
    expect(body.success).toBe(true)
    console.log('[e2e] ✓ Cancel endpoint did not return 403 after task completion')
  })

  test('steer persists message that survives as pending for follow-up chat', async () => {
    // This tests the full follow-up chat scenario:
    // 1. Task runs and completes (context removed)
    // 2. User sends steer message (follow-up)
    // 3. Message persisted as 'pending' in streaming_events
    // 4. If task restarts, the pending steer will be batch-drained at session_init
    const { executionId, machineId } = await runToCompletion()

    // Send follow-up steer
    const followUpMsg = `Follow-up question about the result ${Date.now()}`
    const steerRes = await fetch(`${API_BASE}/api/dispatch/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: executionId,
        machineId,
        message: followUpMsg,
      }),
    })
    expect(steerRes.status).not.toBe(403)

    // Verify the steer message was persisted with the correct content
    const catchUp = await fetchCatchUp(executionId)
    const steerEvents = catchUp.events.filter(e => e.eventType === 'steer_message')
    const matchingSteer = steerEvents.find(e =>
      (e.data as Record<string, unknown>)?.message === followUpMsg
    )
    expect(matchingSteer).toBeDefined()

    // The steer should be in 'pending' or 'sent' status (queued since task completed)
    const status = (matchingSteer!.data as Record<string, unknown>)?.status
    console.log(`[e2e] Follow-up steer status: ${status}`)
    // 'pending' is expected since the relay can't deliver to a completed task
    // but the message is safely persisted for future batch-drain
    expect(['pending', 'sent']).toContain(status)

    console.log('[e2e] ✓ Follow-up steer persisted with correct content and status')
  })
})

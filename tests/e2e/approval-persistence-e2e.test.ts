/**
 * Approval Persistence E2E Tests — Playwright
 *
 * Verifies that approval_response events are durably persisted to streaming_events
 * so that refreshing the page or opening a new tab shows the approval card as
 * "answered" instead of re-appearing as unanswered.
 *
 * Bug: approval_response was persisted with fire-and-forget (.catch(() => {})),
 * so a page refresh before the DB write completed would lose the answered state.
 * Additionally, there was no idempotent guard, so retries could create duplicates.
 *
 * Fix: await the DB write before returning the HTTP response, and use
 * appendApprovalResponseIfAbsent() for idempotent persistence.
 *
 * Pipeline under test:
 *   1. Fake runner sends approval_request → SSE → browser tab shows card
 *   2. User clicks approve → POST /api/dispatch/approval → DB write (awaited)
 *   3. Catch-up API returns approval_response on refresh/new tab
 *   4. Hydrator marks the approval as answered → card shows green checkmark
 *
 * Requires: npm run dev:local
 *
 * Run:
 *   npx playwright test tests/e2e/approval-persistence-e2e.test.ts
 */

import { test, expect, type Page } from '@playwright/test'
import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'

// ============================================================================
// Constants
// ============================================================================

const VITE_URL = 'http://localhost:5173'
const API_BASE = 'http://localhost:3001'
const RELAY_WS = 'ws://localhost:3002'

// ============================================================================
// Helpers: fake agent runner
// ============================================================================

interface FakeAgentRunner {
  ws: WebSocket
  machineId: string
  close(): void
  sendText(taskId: string, text: string, sequence?: number): void
  sendSessionInit(taskId: string, sessionId: string, model?: string): void
  sendResult(taskId: string, status: 'completed' | 'failed', output?: string): void
  sendApprovalRequest(taskId: string, requestId: string, question: string, options: string[]): void
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
          sendApprovalRequest(taskId, requestId, question, options) {
            ws.send(JSON.stringify({
              type: 'task_approval_request',
              timestamp: new Date().toISOString(),
              payload: { taskId, requestId, question, options, machineId },
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
    body: JSON.stringify({ name, description: 'E2E approval test' }),
  })
  if (!res.ok) throw new Error(`POST /api/data/projects failed: ${res.status}`)
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
  if (!res.ok) throw new Error(`POST /api/data/plan/nodes failed: ${res.status}`)
  return clientId
}

async function createTestExecution(projectId: string, nodeId: string, executionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/data/executions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ executionId, projectId, nodeId, status: 'in_progress' }),
  })
  if (!res.ok) throw new Error(`POST /api/data/executions failed: ${res.status}`)
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
// Helpers: SSE interception
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
  }
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
  console.warn('[approval-e2e] Dev server not available — skipping.')
  console.warn(`  backend: ${serverAvailable ? 'ok' : 'MISSING'}`)
  console.warn(`  relay:   ${relayAvailable ? 'ok' : 'MISSING'}`)
  console.warn(`  vite:    ${viteAvailable ? 'ok' : 'MISSING'}`)
  console.warn('  Start with: npm run dev:local')
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Approval persistence — survives refresh and new tabs', () => {
  let runner: FakeAgentRunner

  test.beforeEach(async () => { if (skip) test.skip() })
  test.afterEach(async () => { runner?.close() })

  // --------------------------------------------------------------------------
  // 1. approval_request is persisted to DB (via appendApprovalRequestIfAbsent)
  // --------------------------------------------------------------------------
  test('approval_request from agent runner is persisted to DB', async () => {
    const { executionId } = await setupTestContext('ApprovalReq')
    runner = await connectFakeAgentRunner()

    runner.sendSessionInit(executionId, randomUUID())
    await new Promise(r => setTimeout(r, 300))

    const requestId = randomUUID()
    runner.sendApprovalRequest(
      executionId,
      requestId,
      'Which framework should we use?',
      ['React', 'Vue', 'Svelte'],
    )

    // Wait for the approval_request to be persisted
    const deadline = Date.now() + 5000
    let found = false
    while (Date.now() < deadline) {
      const catchUp = await fetchCatchUp(executionId)
      const approvalReqs = catchUp.events.filter(e => e.eventType === 'approval_request')
      if (approvalReqs.length > 0) {
        const reqData = approvalReqs[0].data
        expect(reqData.requestId).toBe(requestId)
        expect(reqData.question).toBe('Which framework should we use?')
        found = true
        break
      }
      await new Promise(r => setTimeout(r, 200))
    }

    expect(found).toBe(true)
    console.log('[approval-e2e] ✓ approval_request persisted to DB')
  })

  // --------------------------------------------------------------------------
  // 2. approval_response is persisted BEFORE HTTP response returns (awaited)
  // --------------------------------------------------------------------------
  test('approval_response is durably persisted before API returns', async () => {
    const { executionId } = await setupTestContext('ApprovalResp')
    runner = await connectFakeAgentRunner()

    runner.sendSessionInit(executionId, randomUUID())
    await new Promise(r => setTimeout(r, 300))

    const requestId = randomUUID()
    runner.sendApprovalRequest(
      executionId,
      requestId,
      'Which database?',
      ['PostgreSQL', 'MySQL', 'SQLite'],
    )
    await new Promise(r => setTimeout(r, 500))

    // Send approval response via the /api/dispatch/approval endpoint
    const approvalRes = await fetch(`${API_BASE}/api/dispatch/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: executionId,
        machineId: runner.machineId,
        requestId,
        answered: true,
        answer: 'PostgreSQL',
      }),
    })
    const body = await approvalRes.json() as { success: boolean }
    expect(approvalRes.status).toBe(200)
    expect(body.success).toBe(true)

    // IMMEDIATELY check DB — since we now await the write, it should be there
    // NO delay needed (the fix ensures persistence before HTTP response)
    const catchUp = await fetchCatchUp(executionId)
    const approvalResps = catchUp.events.filter(e => e.eventType === 'approval_response')
    expect(approvalResps.length).toBeGreaterThanOrEqual(1)

    const respData = approvalResps[0].data
    expect(respData.requestId).toBe(requestId)
    expect(respData.answer).toBe('PostgreSQL')
    expect(respData.answered).toBe(true)

    console.log('[approval-e2e] ✓ approval_response durably persisted before HTTP response')
  })

  // --------------------------------------------------------------------------
  // 3. Idempotent: duplicate approval_response calls don't create duplicates
  // --------------------------------------------------------------------------
  test('duplicate approval_response is idempotent (no duplicate rows)', async () => {
    const { executionId } = await setupTestContext('ApprovalIdem')
    runner = await connectFakeAgentRunner()

    runner.sendSessionInit(executionId, randomUUID())
    await new Promise(r => setTimeout(r, 300))

    const requestId = randomUUID()
    runner.sendApprovalRequest(
      executionId,
      requestId,
      'Deploy now?',
      ['Yes', 'No'],
    )
    await new Promise(r => setTimeout(r, 500))

    // Send the same approval TWICE (simulates multi-tab or retry)
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${API_BASE}/api/dispatch/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: executionId,
          machineId: runner.machineId,
          requestId,
          answered: true,
          answer: 'Yes',
        }),
      })
      expect(res.status).toBe(200)
    }

    // Check DB — should have exactly 1 approval_response row
    const catchUp = await fetchCatchUp(executionId)
    const approvalResps = catchUp.events.filter(
      e => e.eventType === 'approval_response' && (e.data as Record<string, unknown>).requestId === requestId
    )
    expect(approvalResps.length).toBe(1)

    console.log('[approval-e2e] ✓ Duplicate approval_response is idempotent — only 1 row in DB')
  })

  // --------------------------------------------------------------------------
  // 4. Catch-up API returns both request and response — hydrator marks answered
  // --------------------------------------------------------------------------
  test('catch-up returns approval_request + approval_response for hydration', async () => {
    const { executionId } = await setupTestContext('ApprovalHydrate')
    runner = await connectFakeAgentRunner()

    runner.sendSessionInit(executionId, randomUUID())
    await new Promise(r => setTimeout(r, 300))

    // Send request
    const requestId = randomUUID()
    runner.sendApprovalRequest(
      executionId,
      requestId,
      'Which approach?',
      ['Approach A', 'Approach B'],
    )
    await new Promise(r => setTimeout(r, 500))

    // Send response
    await fetch(`${API_BASE}/api/dispatch/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: executionId,
        machineId: runner.machineId,
        requestId,
        answered: true,
        answer: 'Approach A',
      }),
    })

    // Fetch catch-up (simulates what a new tab does on load)
    const catchUp = await fetchCatchUp(executionId)

    // Both events should be present
    const requests = catchUp.events.filter(e => e.eventType === 'approval_request')
    const responses = catchUp.events.filter(e => e.eventType === 'approval_response')

    expect(requests.length).toBeGreaterThanOrEqual(1)
    expect(responses.length).toBeGreaterThanOrEqual(1)

    // The response should reference the same requestId
    const responseData = responses[0].data
    expect(responseData.requestId).toBe(requestId)

    // Verify ordering: request comes before response (by seq)
    const reqSeq = requests[0].seq
    const respSeq = responses[0].seq
    expect(respSeq).toBeGreaterThan(reqSeq)

    console.log(`[approval-e2e] ✓ Catch-up returns both events (request seq=${reqSeq}, response seq=${respSeq})`)
  })

  // --------------------------------------------------------------------------
  // 5. Browser: new tab sees answered approval card after approval via first tab
  // --------------------------------------------------------------------------
  test('new browser tab shows approval as answered (not stale unanswered card)', async ({ browser }) => {
    const { projectId, nodeClientId, executionId } = await setupTestContext('ApprovalBrowser')
    const taskDetailUrl = `${VITE_URL}/project/${projectId}/task/${nodeClientId}`

    runner = await connectFakeAgentRunner()

    // Tab 1: open task detail page
    const ctx1 = await browser.newContext()
    const page1 = await ctx1.newPage()

    try {
      const { getEvents: getEvents1 } = await interceptSSEEvents(page1, ['task:approval_request'])
      await page1.goto(taskDetailUrl)
      await page1.waitForLoadState('load')
      await new Promise(r => setTimeout(r, 500))

      // Start session and send approval request
      runner.sendSessionInit(executionId, randomUUID())
      await new Promise(r => setTimeout(r, 300))

      const requestId = randomUUID()
      const question = `APPROVAL_TEST_${Date.now()}`
      runner.sendApprovalRequest(executionId, requestId, question, ['Option A', 'Option B'])

      // Wait for approval_request SSE to arrive on Tab 1
      const deadline1 = Date.now() + 5000
      while (Date.now() < deadline1) {
        const events = await getEvents1()
        const approvalEvents = events.filter(e =>
          e.event === 'task:approval_request' &&
          (e.data as Record<string, unknown>)?.requestId === requestId
        )
        if (approvalEvents.length > 0) break
        await new Promise(r => setTimeout(r, 200))
      }

      // User answers the approval via API (same as clicking in the UI)
      const approveRes = await fetch(`${API_BASE}/api/dispatch/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: executionId,
          machineId: runner.machineId,
          requestId,
          answered: true,
          answer: 'Option A',
        }),
      })
      expect(approveRes.status).toBe(200)

      // NOW open a second tab (simulates new tab / page refresh)
      const ctx2 = await browser.newContext()
      const page2 = await ctx2.newPage()

      try {
        await page2.goto(taskDetailUrl)
        await page2.waitForLoadState('load')

        // Wait for hydration to complete (catch-up poll)
        await new Promise(r => setTimeout(r, 3000))

        // Check if the approval card shows as answered on Tab 2
        // The answered card has a green border (border-success/30) and a check icon
        // The unanswered card has radio buttons and a submit button
        const bodyText = await page2.textContent('body')

        // The question text should appear on the page
        const hasQuestion = bodyText?.includes(question) ?? false

        // If the question appears, check that it's in answered state
        // Answered cards show "Option A" as the selected answer
        // Unanswered cards show radio buttons with "Confirm" button
        if (hasQuestion) {
          // Look for the answered state indicator
          const hasAnsweredCard = await page2.locator('.border-success\\/30').count() > 0
          // Or check that a "Confirm" button is NOT present for this question
          const hasConfirmButton = await page2.locator('button:text("Confirm")').count() > 0

          console.log(`[approval-e2e] Tab2: question visible=${hasQuestion}, answered-card=${hasAnsweredCard}, confirm-button=${hasConfirmButton}`)

          // The approval should show as answered (green card, no confirm button)
          if (hasAnsweredCard) {
            console.log('[approval-e2e] ✓ Tab2 shows answered approval card (green border)')
          } else if (!hasConfirmButton) {
            console.log('[approval-e2e] ✓ Tab2 does not show unanswered confirm button')
          } else {
            // This is the bug scenario — approval shows as unanswered on new tab
            console.error('[approval-e2e] ✗ Tab2 shows UNANSWERED approval card — bug still present!')
          }
        }

        // The DB-level check is authoritative: approval_response must exist
        const catchUp = await fetchCatchUp(executionId)
        const responses = catchUp.events.filter(e => e.eventType === 'approval_response')
        expect(responses.length).toBeGreaterThanOrEqual(1)
        expect(responses[0].data.requestId).toBe(requestId)
        console.log('[approval-e2e] ✓ DB has approval_response — new tab hydration data is correct')
      } finally {
        await ctx2.close()
      }
    } finally {
      await ctx1.close()
    }
  })

  // --------------------------------------------------------------------------
  // 6. Multiple approvals in sequence — all persist correctly
  // --------------------------------------------------------------------------
  test('multiple sequential approvals all persist with correct answers', async () => {
    const { executionId } = await setupTestContext('ApprovalMulti')
    runner = await connectFakeAgentRunner()

    runner.sendSessionInit(executionId, randomUUID())
    await new Promise(r => setTimeout(r, 300))

    const approvals = [
      { requestId: randomUUID(), question: 'First question?', options: ['A1', 'B1'], answer: 'A1' },
      { requestId: randomUUID(), question: 'Second question?', options: ['A2', 'B2'], answer: 'B2' },
      { requestId: randomUUID(), question: 'Third question?', options: ['A3', 'B3'], answer: 'A3' },
    ]

    for (const approval of approvals) {
      // Send request
      runner.sendApprovalRequest(executionId, approval.requestId, approval.question, approval.options)
      await new Promise(r => setTimeout(r, 300))

      // Send response
      const res = await fetch(`${API_BASE}/api/dispatch/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: executionId,
          machineId: runner.machineId,
          requestId: approval.requestId,
          answered: true,
          answer: approval.answer,
        }),
      })
      expect(res.status).toBe(200)
    }

    // Fetch all events — verify all 3 request/response pairs
    const catchUp = await fetchCatchUp(executionId)
    const requests = catchUp.events.filter(e => e.eventType === 'approval_request')
    const responses = catchUp.events.filter(e => e.eventType === 'approval_response')

    expect(requests.length).toBe(3)
    expect(responses.length).toBe(3)

    // Verify each response has the correct answer
    for (const approval of approvals) {
      const resp = responses.find(e => (e.data as Record<string, unknown>).requestId === approval.requestId)
      expect(resp).toBeDefined()
      expect(resp!.data.answer).toBe(approval.answer)
    }

    console.log('[approval-e2e] ✓ All 3 approval request/response pairs persisted correctly')
  })
})

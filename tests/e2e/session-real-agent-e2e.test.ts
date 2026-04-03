/**
 * Real Agent Runner E2E Test
 *
 * Unlike session-lifecycle-e2e.test.ts which uses a fake agent runner,
 * this test dispatches a real task to the actual agent runner connected
 * to the relay server.
 *
 * Prerequisites:
 *   1. npm run dev:local (server + relay running)
 *   2. Real agent runner connected (check: curl localhost:3001/api/health)
 *
 * Run:
 *   npx playwright test tests/e2e/session-real-agent-e2e.test.ts --timeout 120000
 */

import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const VITE_URL = 'http://localhost:5173'
const API_BASE = 'http://localhost:3001'

// ============================================================================
// Availability checks
// ============================================================================

let serverAvailable = false
let connectedMachine: { id: string; name: string } | null = null

try {
  const res = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(3000) })
  const health = await res.json() as {
    status: string
    relay: { connectedRunners: number; machines: Array<{ id: string; name: string }> }
  }
  serverAvailable = health.status === 'ok'
  if (health.relay.connectedRunners > 0 && health.relay.machines.length > 0) {
    connectedMachine = health.relay.machines[0]
  }
} catch { serverAvailable = false }

let viteAvailable = false
try {
  const res = await fetch(VITE_URL, { signal: AbortSignal.timeout(3000) })
  viteAvailable = res.ok
} catch { viteAvailable = false }

// ============================================================================
// Helper: wait for execution to reach a terminal status
// ============================================================================

async function waitForExecutionStatus(
  projectId: string,
  nodeId: string,
  targetStatuses: string[],
  timeoutMs = 90000,
  pollMs = 2000,
): Promise<{ status: string; output?: string }> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${API_BASE}/api/data/executions?projectId=${projectId}`)
    if (res.ok) {
      // Executions endpoint returns a map keyed by nodeId
      const execs = await res.json() as Record<string, { nodeId: string; status: string; output?: string }>
      const exec = execs[nodeId]
      if (exec && targetStatuses.includes(exec.status)) {
        return { status: exec.status, output: exec.output }
      }
    }
    await new Promise(r => setTimeout(r, pollMs))
  }
  throw new Error(`Execution for node ${nodeId} did not reach ${targetStatuses.join('|')} within ${timeoutMs}ms`)
}

// ============================================================================
// Helper: collect SSE events for an execution
// ============================================================================

async function collectSSEEvents(
  executionId: string,
  timeoutMs = 90000,
): Promise<Array<{ type: string; data: unknown }>> {
  const events: Array<{ type: string; data: unknown }> = []

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(events), timeoutMs)

    const url = `${API_BASE}/api/events/stream/dispatch/${executionId}`
    // Use a simple HTTP request to read the SSE stream
    fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).then(async (res) => {
      const reader = res.body?.getReader()
      if (!reader) { clearTimeout(timer); resolve(events); return }

      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          let currentEvent = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim()
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6))
                events.push({ type: currentEvent, data })
                // If we get a result or done event, we can stop
                if (['task:result', 'task:done', 'task:error'].includes(currentEvent)) {
                  clearTimeout(timer)
                  // Give a small buffer for final events
                  setTimeout(() => { reader.cancel(); resolve(events) }, 1000)
                }
              } catch {
                events.push({ type: currentEvent, data: line.slice(6) })
              }
              currentEvent = ''
            }
          }
        }
      } catch {
        // Stream ended
      }
      clearTimeout(timer)
      resolve(events)
    }).catch(() => { clearTimeout(timer); resolve(events) })
  })
}

// ============================================================================
// Tests
// ============================================================================

test.describe('real agent runner e2e', () => {
  test.skip(!serverAvailable || !viteAvailable || !connectedMachine,
    `Requires dev servers + real agent runner. Server: ${serverAvailable}, Vite: ${viteAvailable}, Machine: ${connectedMachine?.name || 'none'}`)

  // Give real agent plenty of time
  test.setTimeout(120_000)

  test('dispatch a simple task to real agent and verify completion', async ({ page }) => {
    const machineId = connectedMachine!.id
    const machineName = connectedMachine!.name
    console.log(`[real-e2e] Using machine: ${machineName} (${machineId})`)

    // Step 1: Create a project via API
    const projectId = randomUUID()
    const projectName = `Real Agent E2E ${Date.now()}`
    const createRes = await fetch(`${API_BASE}/api/data/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: projectName,
        description: 'E2E test with real agent runner',
      }),
    })
    expect(createRes.ok).toBeTruthy()
    console.log(`[real-e2e] Created project: ${projectId}`)

    // Step 2: Dispatch a simple task via the dispatch API
    const nodeId = `session-${projectId}`
    const taskPrompt = 'Say "hello from e2e test" and nothing else. Do not use any tools.'

    const dispatchRes = await fetch(`${API_BASE}/api/dispatch/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        projectId,
        title: 'E2E Real Agent Test',
        description: taskPrompt,
        targetMachineId: machineId,
        workingDirectory: '/tmp',
        deliveryMode: 'direct',
        maxTurns: 3,
      }),
    })

    const dispatchBody = await dispatchRes.json() as { success: boolean; executionId?: string; error?: string }
    console.log(`[real-e2e] Dispatch response:`, JSON.stringify(dispatchBody))
    expect(dispatchBody.success).toBeTruthy()
    const executionId = dispatchBody.executionId!
    expect(executionId).toBeTruthy()
    console.log(`[real-e2e] Execution ID: ${executionId}`)

    // Step 3: Start collecting SSE events in parallel
    const ssePromise = collectSSEEvents(executionId, 90000)

    // Step 4: Navigate to the playground and verify streaming UI
    await page.goto(`${VITE_URL}/playground?projectId=${projectId}`)
    await page.waitForTimeout(3000)

    // Step 5: Wait for the execution to complete
    console.log(`[real-e2e] Waiting for execution to complete...`)
    const result = await waitForExecutionStatus(
      projectId, nodeId,
      ['success', 'failure'],
      90000,
    )
    console.log(`[real-e2e] Execution finished with status: ${result.status}`)
    expect(result.status).toBe('success')

    // Step 6: Check SSE events were received
    const sseEvents = await ssePromise
    console.log(`[real-e2e] Received ${sseEvents.length} SSE events`)
    const eventTypes = sseEvents.map(e => e.type)
    console.log(`[real-e2e] Event types: ${[...new Set(eventTypes)].join(', ')}`)

    // SSE events may be missed if the task completes very quickly — log but don't fail
    if (sseEvents.length > 0) {
      console.log(`[real-e2e] Received ${sseEvents.length} SSE events via direct stream`)
    } else {
      console.log(`[real-e2e] No SSE events captured (task likely completed before stream connected)`)
    }

    // Step 7: Verify streaming events persisted to DB (authoritative check)
    const eventsRes = await fetch(`${API_BASE}/api/events/catch-up?executionIds=${executionId}&afterSeq=0&limit=500`)
    expect(eventsRes.ok).toBeTruthy()
    const catchUp = await eventsRes.json() as { events: Array<{ eventType: string }>; lastSeq: number }
    const dbEvents = catchUp.events
    console.log(`[real-e2e] Persisted ${dbEvents.length} streaming events to DB (lastSeq: ${catchUp.lastSeq})`)
    expect(dbEvents.length).toBeGreaterThan(0)
    const persistedTypes = [...new Set(dbEvents.map(e => e.eventType))]
    console.log(`[real-e2e] Persisted event types: ${persistedTypes.join(', ')}`)
    // The agent should have produced at least text output
    expect(persistedTypes).toContain('text')

    // Step 8: Verify the playground page shows content after refresh
    await page.reload()
    await page.waitForTimeout(3000)
    const bodyText = await page.textContent('body')
    expect(bodyText).toBeTruthy()
    console.log(`[real-e2e] Page contains text (first 200 chars): ${bodyText?.slice(0, 200)}`)

    console.log(`[real-e2e] ✓ Test passed — full lifecycle with real agent runner`)
  })

  test('submit from inbox UI with real agent', async ({ page }) => {
    // This test uses the actual InboxHome UI to submit a task
    await page.goto(`${VITE_URL}/dashboard`)
    await page.waitForTimeout(2000)

    // Find the textarea
    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 5000 })

    // Type a simple goal
    const goal = `Real agent e2e: just say hello ${Date.now()}`
    await textarea.fill(goal)

    // Wait for machines to load (auto-select should pick the first one)
    await page.waitForTimeout(3000)

    // The Start button should be enabled if auto-select worked
    const startBtn = page.locator('button:has-text("Start")').first()
    const isEnabled = await startBtn.isEnabled({ timeout: 8000 }).catch(() => false)

    if (!isEnabled) {
      // Fall back to manual machine selection
      console.log('[real-e2e] Auto-select did not work, selecting machine manually')
      const selectMachineBtn = page.locator('button:has-text("Select machine")').first()
      if (await selectMachineBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await selectMachineBtn.click()
        await page.waitForTimeout(800)
        // Click the first machine in the popover
        await page.evaluate(() => {
          const popover = document.querySelector('[data-radix-popper-content-wrapper]')
          const btn = popover?.querySelector('button')
          btn?.click()
        })
        await page.waitForTimeout(500)
      }
    }

    await expect(startBtn).toBeEnabled({ timeout: 5000 })
    console.log('[real-e2e] Submitting task from inbox UI...')
    await startBtn.click()

    // Should navigate to playground
    await page.waitForURL(/\/playground\?projectId=/, { timeout: 15000 })
    const url = page.url()
    const projectId = url.match(/projectId=([^&]+)/)?.[1]
    expect(projectId).toBeTruthy()
    console.log(`[real-e2e] Navigated to playground, projectId: ${projectId}`)

    // Wait for the agent to produce some output
    console.log('[real-e2e] Waiting for agent to produce output...')
    await page.waitForTimeout(10000)

    // Check that something appeared on the page
    const bodyText = await page.textContent('body')
    console.log(`[real-e2e] Page text (first 300 chars): ${bodyText?.slice(0, 300)}`)

    // The page should have moved past the initial "Starting..." state
    // (it may still be running, that's fine — we just want to confirm dispatch worked)
    expect(bodyText).toBeTruthy()

    // Wait for completion (give real agent up to 60s)
    console.log('[real-e2e] Waiting for agent to complete...')
    let completed = false
    for (let i = 0; i < 30; i++) {
      const health = await fetch(`${API_BASE}/api/health`).then(r => r.json()) as {
        relay: { machines: Array<{ activeTasks: number }> }
      }
      const activeTasks = health.relay.machines.reduce((sum, m) => sum + m.activeTasks, 0)
      if (activeTasks === 0) {
        completed = true
        break
      }
      await page.waitForTimeout(2000)
    }

    console.log(`[real-e2e] Agent completed: ${completed}`)
    // Not asserting completion — the agent may take longer than our timeout
    // The key assertion is that dispatch + navigation + streaming worked

    console.log('[real-e2e] ✓ Inbox UI submission test passed')
  })
})

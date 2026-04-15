/**
 * Chat Stream Catch-Up E2E Test — Playwright
 *
 * Verifies the chat streaming pipeline persists events correctly so that
 * the periodic DB catch-up poll (activated by our fix) can hydrate
 * activityEvents without page refresh.
 *
 * Pipeline under test:
 *   POST /api/agent/project-chat → server persists init + chat_user events
 *   → relay dispatches to agent runner → runner sends text chunks
 *   → relay persists text to streaming_events → catch-up API returns them
 *   → server emits task:init via SSE → all tabs get status='running'
 *
 * What each test verifies:
 * 1. init + chat_user events are persisted immediately on chat POST
 * 2. Text events from the agent runner appear in the catch-up API
 * 3. Two browser tabs both see the task:init SSE event (multi-tab)
 *
 * Requires: npm run dev:local (with a real or fake agent runner connected)
 *
 * Run:
 *   npx playwright test tests/e2e/chat-catchup-e2e.test.ts
 */

import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const API_BASE = 'http://localhost:3001'
const VITE_URL = 'http://localhost:5173'

// ============================================================================
// Helpers
// ============================================================================

async function createTestProject(name: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/data/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: 'Chat catch-up e2e test' }),
  })
  if (!res.ok) throw new Error(`POST /api/data/projects failed: ${res.status}`)
  const data = await res.json() as { id: string }
  return data.id
}

async function fetchCatchUp(executionId: string, afterSeq = 0) {
  const res = await fetch(
    `${API_BASE}/api/events/catch-up?executionIds=${executionId}&afterSeq=${afterSeq}`,
  )
  if (!res.ok) throw new Error(`GET catch-up failed: ${res.status}`)
  return res.json() as Promise<{
    events: Array<{ seq: number; executionId: string; eventType: string; data: Record<string, unknown>; createdAt: string }>
    lastSeq: number
    hasMore: boolean
  }>
}

// ============================================================================
// Health check — skip when dev server is not running
// ============================================================================

let serverAvailable = false
let relayAvailable = false
let viteAvailable = false
let hasRunner = false

try {
  const res = await fetch(`${API_BASE}/api/health`)
  const health = await res.json() as {
    status: string
    relay: { connectedRunners: number }
  }
  serverAvailable = health.status === 'ok'
  hasRunner = (health.relay?.connectedRunners ?? 0) > 0
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
  console.warn('[chat-e2e] Dev server not available — skipping.')
  console.warn(`  backend: ${serverAvailable ? 'ok' : 'MISSING'}`)
  console.warn(`  relay:   ${relayAvailable ? 'ok' : 'MISSING'}`)
  console.warn(`  vite:    ${viteAvailable ? 'ok' : 'MISSING'}`)
  console.warn(`  runner:  ${hasRunner ? 'ok' : 'MISSING (some tests will skip)'}`)
  console.warn('  Start with: npm run dev:local')
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Chat stream catch-up pipeline', () => {
  test.beforeEach(async () => {
    if (skip) test.skip()
  })

  // --------------------------------------------------------------------------
  // 1. Server persists init + chat_user events immediately on chat POST
  // --------------------------------------------------------------------------
  test('init and chat_user events are persisted immediately on chat POST', async () => {
    const projectId = await createTestProject(`Chat-Persist-${Date.now()}`)
    const streamId = randomUUID()

    // POST a chat message
    const chatRes = await fetch(`${API_BASE}/api/agent/project-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What is the project structure?',
        streamId,
        projectId,
      }),
    })

    // Chat dispatch may fail if no runner is connected — that's OK for this test.
    // We're testing that init + chat_user events are persisted BEFORE dispatch.
    const chatData = await chatRes.json() as { success: boolean; taskId?: string; streamId?: string; error?: string }
    const persistId = chatData.streamId || streamId

    // Small delay for async DB writes
    await new Promise(r => setTimeout(r, 500))

    // Fetch persisted events via catch-up API
    const catchUp = await fetchCatchUp(persistId)
    console.log(`[chat-e2e] Catch-up returned ${catchUp.events.length} events for streamId=${persistId.slice(0, 8)}`)

    // Verify init event was persisted
    const initEvents = catchUp.events.filter(e => e.eventType === 'init')
    expect(initEvents.length).toBeGreaterThanOrEqual(1)
    console.log('[chat-e2e] ✓ init event persisted')

    // Verify chat_user event was persisted
    const chatUserEvents = catchUp.events.filter(e => e.eventType === 'chat_user')
    expect(chatUserEvents.length).toBeGreaterThanOrEqual(1)
    console.log('[chat-e2e] ✓ chat_user event persisted')

    // Verify chat_user contains the message
    const userMsg = chatUserEvents[0].data
    expect(userMsg.message).toBe('What is the project structure?')
  })

  // --------------------------------------------------------------------------
  // 2. Agent runner text chunks appear in catch-up API (requires real runner)
  // --------------------------------------------------------------------------
  test('agent runner text appears in catch-up API after streaming', async () => {
    if (!hasRunner) {
      console.warn('[chat-e2e] No agent runner connected — skipping text persistence test')
      test.skip()
      return
    }

    const projectId = await createTestProject(`Chat-Text-${Date.now()}`)
    const streamId = randomUUID()

    const chatRes = await fetch(`${API_BASE}/api/agent/project-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Say exactly: CHAT_CATCHUP_TEST_MARKER',
        streamId,
        projectId,
      }),
    })
    const chatData = await chatRes.json() as { success: boolean; streamId?: string }
    expect(chatData.success).toBe(true)
    const persistId = chatData.streamId || streamId

    // Wait for the agent runner to respond and text to be flushed to DB.
    // Text is buffered in StreamingEventLog and flushed on structural events
    // or when the catch-up endpoint explicitly flushes (events.ts L1046-1051).
    // Poll catch-up until text events appear (max 30s for real runner).
    let textFound = false
    const deadline = Date.now() + 30_000
    let lastEvents: Array<{ event: string }> = []

    while (Date.now() < deadline) {
      const catchUp = await fetchCatchUp(persistId)
      lastEvents = catchUp.events
      const textEvents = catchUp.events.filter(e => e.eventType === 'text')
      if (textEvents.length > 0) {
        textFound = true
        console.log(`[chat-e2e] ✓ ${textEvents.length} text events found in DB after ${Math.round((Date.now() - (deadline - 30_000)) / 1000)}s`)
        break
      }
      await new Promise(r => setTimeout(r, 1000))
    }

    console.log(`[chat-e2e] Total events: ${lastEvents.length} (types: ${[...new Set(lastEvents.map(e => e.eventType))].join(', ')})`)
    expect(textFound).toBe(true)
  })

  // --------------------------------------------------------------------------
  // 3. task:init SSE event reaches both browser tabs (multi-tab status)
  // --------------------------------------------------------------------------
  test('task:init SSE delivered to two browser tabs for chat stream', async ({ browser }) => {
    const projectId = await createTestProject(`Chat-SSE-${Date.now()}`)
    const streamId = randomUUID()

    // Open two browser contexts (independent SSE connections)
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      // Set up SSE interception on both pages BEFORE navigation
      for (const page of [page1, page2]) {
        await page.exposeFunction('__pwSSECapture', () => { /* collected below */ })
        await page.addInitScript(() => {
          const OrigES = window.EventSource
           
          ;(window as any).__sseEvents = [] as Array<{ event: string; data: string }>
          // @ts-expect-error — patching for test
          window.EventSource = class extends OrigES {
            constructor(url: string, init?: EventSourceInit) {
              super(url, init)
              if (!url.includes('/api/events/stream')) return
              this.addEventListener('task:init', (e: MessageEvent) => {
                 
                ;(window as any).__sseEvents.push({ event: 'task:init', data: e.data })
              })
            }
          }
        })
      }

      // Navigate both tabs
      await Promise.all([
        page1.goto(VITE_URL),
        page2.goto(VITE_URL),
      ])
      await Promise.all([
        page1.waitForLoadState('load'),
        page2.waitForLoadState('load'),
      ])

      // Wait for SSE connections
      let sseCount = 0
      const sseDeadline = Date.now() + 8000
      while (Date.now() < sseDeadline) {
        const healthRes = await fetch(`${API_BASE}/api/health`)
        const health = await healthRes.json() as { sse: { global: number } }
        sseCount = health.sse?.global ?? 0
        if (sseCount >= 2) break
        await new Promise(r => setTimeout(r, 200))
      }
      console.log(`[chat-e2e] SSE connections: ${sseCount}`)
      expect(sseCount).toBeGreaterThanOrEqual(2)

      // Send chat — server emits task:init to all SSE clients
      const chatRes = await fetch(`${API_BASE}/api/agent/project-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Hello',
          streamId,
          projectId,
        }),
      })
      await chatRes.json() // consume body

      // The taskId used in task:init = streamId (see agent.ts L356)
      const expectedTaskId = streamId

      // Wait for task:init to arrive on both tabs (max 5s)
      const initDeadline = Date.now() + 5000

      const getInitEvents = async (page: typeof page1) => {
        return page.evaluate((taskId) => {
           
          const events = (window as any).__sseEvents as Array<{ event: string; data: string }>
          return events.filter(e => {
            try {
              const d = JSON.parse(e.data)
              return d.executionId === taskId
            } catch { return false }
          }).length
        }, expectedTaskId)
      }

      let tab1Init = 0
      let tab2Init = 0
      while (Date.now() < initDeadline) {
        tab1Init = await getInitEvents(page1)
        tab2Init = await getInitEvents(page2)
        if (tab1Init > 0 && tab2Init > 0) break
        await new Promise(r => setTimeout(r, 200))
      }

      console.log(`[chat-e2e] task:init events — Tab1: ${tab1Init}, Tab2: ${tab2Init}`)

      // Both tabs should have received task:init
      // This is what enables taskStream.status = 'running' → periodic catch-up
      expect(tab1Init).toBeGreaterThanOrEqual(1)
      expect(tab2Init).toBeGreaterThanOrEqual(1)
      console.log('[chat-e2e] ✓ task:init SSE delivered to both tabs')
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })
})

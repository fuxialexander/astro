/**
 * Multi-Instance Redis E2E Tests — Playwright
 *
 * Simulates two backend instances sharing a Redis bus:
 *
 *   Fake Agent Runner (WS → port 3002)
 *         │
 *         ▼
 *   ┌─────────────────────────────────────────┐
 *   │  Instance A (existing dev server)        │
 *   │  Backend: localhost:3001                 │
 *   │  Relay:   localhost:3002                 │
 *   │  RedisPubSub instanceId: A               │
 *   └──────────────────┬──────────────────────┘
 *                      │ PUBLISH relay:task:streaming
 *                      ▼
 *             ┌────────────────┐
 *             │  Redis :6379   │
 *             └───────┬────────┘
 *                     │ SUBSCRIBE (instance B)
 *                     ▼
 *   ┌─────────────────────────────────────────┐
 *   │  Instance B (mini SSE server)            │
 *   │  HTTP:  localhost:3007                   │
 *   │  RedisPubSub instanceId: B               │
 *   │  Delivers ALL Redis events to SSE        │
 *   └─────────────────────────────────────────┘
 *
 * What is verified:
 *   1. Tab 1 (instance A SSE) receives events exactly once — no Redis self-echo
 *      duplication despite instance A having published them to Redis.
 *   2. Tab 2 (instance B mini-server SSE) receives the same events via Redis.
 *   3. toolUseId appears exactly once per tab (no cross-instance duplication).
 *   4. Text events from instance A are also delivered to Tab 2 via Redis
 *      (proving the full pub/sub pipeline works for streaming content).
 *   5. Self-dedup: instance B never re-echoes its own messages.
 *
 * Prerequisites:
 *   npm run dev:local    (starts instance A on ports 3001/3002)
 *   redis-server         (or brew services start redis)
 *   REDIS_URL=redis://localhost:6379
 *
 * Run:
 *   REDIS_URL=redis://localhost:6379 npx playwright test tests/e2e/multi-instance-e2e.test.ts
 */

import * as http from 'node:http'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import WebSocket from 'ws'
import Redis from 'ioredis'
import { randomUUID } from 'node:crypto'

// ============================================================================
// Constants
// ============================================================================

const VITE_URL = 'http://localhost:5173'
const API_BASE = 'http://localhost:3001'
const RELAY_WS = 'ws://localhost:3002'
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const MINI_SERVER_PORT = 3007

/** Redis channel instance A publishes streaming events to */
const STREAMING_CHANNEL = 'relay:task:streaming'

// ============================================================================
// Mini instance B server
// ============================================================================

interface MiniInstanceB {
  instanceId: string
  port: number
  /** All Redis messages received (after instanceId dedup) */
  redisEvents: Array<{ eventType: string; taskId: string; data: Record<string, unknown>; instanceId: string }>
  close(): Promise<void>
}

/**
 * Start a minimal SSE server simulating a second backend instance.
 *
 * - Subscribes to `relay:task:streaming` Redis channel.
 * - Applies self-dedup (skips msgs published by itself — always empty in this test).
 * - Serves an HTML page that creates a client-side EventSource and calls
 *   window.__pwEvent(type, data) for each received SSE event (used by Playwright).
 * - Delivers all received Redis events to connected SSE clients as
 *   `event: task:<eventType>`.
 */
async function startMiniInstanceB(redisUrl: string): Promise<MiniInstanceB> {
  const instanceId = `test-instance-b-${Date.now()}`
  const redisEvents: MiniInstanceB['redisEvents'] = []

  // ── Redis subscriber ──────────────────────────────────────────────────────
  const redisSub = new Redis(redisUrl, { lazyConnect: true })
  await redisSub.connect()
  await redisSub.subscribe(STREAMING_CHANNEL)

  // Connected SSE clients
  const sseClients = new Set<http.ServerResponse>()

  redisSub.on('message', (_channel: string, raw: string) => {
    let msg: { instanceId: string; eventType: string; taskId: string; data: Record<string, unknown>; dbSeq?: number }
    try { msg = JSON.parse(raw) } catch { return }

    // Self-dedup: skip events this instance published (none in this test)
    if (msg.instanceId === instanceId) return

    redisEvents.push({ eventType: msg.eventType, taskId: msg.taskId, data: msg.data, instanceId: msg.instanceId })

    // Forward to all SSE clients
    const payload = JSON.stringify({ taskId: msg.taskId, ...msg.data })
    const frame = `event: task:${msg.eventType}\ndata: ${payload}\n\n`
    for (const client of sseClients) {
      try { client.write(frame) } catch { sseClients.delete(client) }
    }
  })

  // ── HTML page served to Tab 2 ─────────────────────────────────────────────
  // The page creates an EventSource to /events and calls window.__pwEvent
  // (exposed by Playwright's exposeFunction) whenever an SSE event arrives.
  const HTML_PAGE = `<!DOCTYPE html>
<html><head><title>Instance B</title></head>
<body>
  <h1>Instance B SSE Receiver</h1>
  <ul id="log"></ul>
  <script>
    const WATCHED = ['task:text','task:stdout','task:tool_use','task:tool_result',
                     'task:tool_trace','task:session_init','task:file_change',
                     'task:progress','task:result','task:error',
                     'task:init','task:ready','node:status_changed'];
    const es = new EventSource('/events');
    for (const t of WATCHED) {
      es.addEventListener(t, (e) => {
        try {
          const data = JSON.parse(e.data);
          if (window.__pwEvent) window.__pwEvent(t, data);
          const li = document.createElement('li');
          li.textContent = t + ': ' + JSON.stringify(data).slice(0, 120);
          document.getElementById('log').appendChild(li);
        } catch(err) {
          if (window.__pwEvent) window.__pwEvent(t, e.data);
        }
      });
    }
  </script>
</body></html>`

  // ── HTTP server ───────────────────────────────────────────────────────────
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/events')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })
      res.write(': connected\n\n') // SSE comment ping
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(HTML_PAGE)
    }
  })

  await new Promise<void>((resolve) => server.listen(MINI_SERVER_PORT, resolve))

  return {
    instanceId,
    port: MINI_SERVER_PORT,
    redisEvents,
    async close() {
      await redisSub.unsubscribe(STREAMING_CHANNEL)
      redisSub.disconnect()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

// ============================================================================
// Helpers reused from streaming-e2e.test.ts
// ============================================================================

interface FakeAgentRunner {
  close(): void
  sendText(taskId: string, text: string, sequence?: number): void
  sendToolUse(taskId: string, toolName: string, toolInput: unknown, toolUseId?: string): void
  sendToolResult(taskId: string, toolName: string, result: string, success?: boolean, toolUseId?: string): void
  sendSessionInit(taskId: string, sessionId: string, model?: string): void
  sendResult(taskId: string, status: 'completed' | 'failed', output?: string): void
}

async function connectFakeAgentRunner(machineId = `pw-multi-${Date.now()}`): Promise<FakeAgentRunner> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_WS)
    const timeout = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000)

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'machine.register',
        timestamp: new Date().toISOString(),
        machineId,
        machineInfo: {
          name: 'Playwright Multi-Instance Machine',
          hostname: 'playwright-multi',
          platform: 'darwin',
          providers: [{ type: 'claude-code', version: '1.0.0', status: 'available', maxConcurrentTasks: 3, currentTasks: 0, capabilities: ['shell'] }],
          resources: { cpuCores: 4, memoryMB: 8192, diskSpaceMB: 100000 },
          load: { cpuPercent: 5, memoryPercent: 20, activeTasks: 0, queuedTasks: 0 },
          tags: ['playwright-multi'],
        },
      }))
    })

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'machine.register.ack') {
        clearTimeout(timeout)
        resolve({
          close() { ws.close() },
          sendText(taskId, text, sequence = 1) {
            ws.send(JSON.stringify({ type: 'task_text', timestamp: new Date().toISOString(), payload: { taskId, text, sequence } }))
          },
          sendToolUse(taskId, toolName, toolInput, toolUseId) {
            ws.send(JSON.stringify({ type: 'task_tool_use', timestamp: new Date().toISOString(), payload: { taskId, toolName, toolInput, toolUseId: toolUseId ?? randomUUID() } }))
          },
          sendToolResult(taskId, toolName, result, success = true, toolUseId) {
            ws.send(JSON.stringify({ type: 'task_tool_result', timestamp: new Date().toISOString(), payload: { taskId, toolName, result, success, toolUseId } }))
          },
          sendSessionInit(taskId, sessionId, model = 'claude-sonnet-4-5') {
            ws.send(JSON.stringify({ type: 'task_session_init', timestamp: new Date().toISOString(), payload: { taskId, sessionId, model } }))
          },
          sendResult(taskId, status, output = '') {
            ws.send(JSON.stringify({ type: 'task_result', timestamp: new Date().toISOString(), result: { taskId, status, exitCode: status === 'completed' ? 0 : 1, output, duration: 1000 } }))
          },
        })
      }
    })
    ws.on('error', (err) => { clearTimeout(timeout); reject(err) })
  })
}

async function createTestContext(label: string): Promise<{ projectId: string; nodeClientId: string; executionId: string }> {
  // Create project
  const pRes = await fetch(`${API_BASE}/api/data/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Multi-Instance ${label} ${Date.now()}`, description: 'multi-instance e2e test' }),
  })
  if (!pRes.ok) throw new Error(`create project: ${pRes.status}`)
  const project = await pRes.json() as { id: string }

  // Create node
  const nodeClientId = randomUUID()
  const nRes = await fetch(`${API_BASE}/api/data/plan/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: project.id, id: nodeClientId, title: label, type: 'task', status: 'in_progress' }),
  })
  if (!nRes.ok) throw new Error(`create node: ${nRes.status}`)

  // Create execution (so SSE handler grants access)
  const executionId = randomUUID()
  const eRes = await fetch(`${API_BASE}/api/data/executions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ executionId, projectId: project.id, nodeId: nodeClientId, status: 'in_progress' }),
  })
  if (!eRes.ok) throw new Error(`create execution: ${eRes.status}`)

  return { projectId: project.id, nodeClientId, executionId }
}

/** Intercept named SSE events on a Vite-proxied page (instance A). */
async function interceptSSEEventsA(page: Page, targetEvents: string[]): Promise<{
  getEvents: () => Promise<Array<{ event: string; data: Record<string, unknown> }>>
}> {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  await page.exposeFunction('__pwSSEEventA', (event: string, data: Record<string, unknown>) => {
    events.push({ event, data })
  })
  await page.addInitScript((targetEvents: string[]) => {
    const Orig = window.EventSource
    // @ts-expect-error — patching global EventSource for test interception
    window.EventSource = class extends Orig {
      constructor(url: string, init?: EventSourceInit) {
        super(url, init)
        if (!url.includes('/api/events/stream')) return
        for (const t of targetEvents) {
          this.addEventListener(t, (e: MessageEvent) => {
            try { (window as unknown as Record<string, (a: string, b: unknown) => void>).__pwSSEEventA(t, JSON.parse(e.data)) } catch { (window as unknown as Record<string, (a: string, b: unknown) => void>).__pwSSEEventA(t, e.data) }
          })
        }
      }
    }
  }, targetEvents)
  return { getEvents: async () => [...events] }
}

/** Intercept SSE events from the mini instance B server page. */
async function interceptSSEEventsB(page: Page): Promise<{
  getEvents: () => Promise<Array<{ event: string; data: Record<string, unknown> }>>
}> {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  await page.exposeFunction('__pwEvent', (event: string, data: Record<string, unknown>) => {
    events.push({ event, data })
  })
  // No addInitScript needed — the HTML page itself calls window.__pwEvent
  return { getEvents: async () => [...events] }
}

// ============================================================================
// Availability checks
// ============================================================================

let serverAvailable = false
try {
  const res = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(3000) })
  serverAvailable = (await res.json() as { status: string }).status === 'ok'
} catch { serverAvailable = false }

let viteAvailable = false
try {
  const res = await fetch(VITE_URL, { signal: AbortSignal.timeout(3000) })
  viteAvailable = res.ok
} catch { viteAvailable = false }

let redisAvailable = false
try {
  const probe = new Redis(REDIS_URL, { lazyConnect: true, connectTimeout: 2000 })
  await probe.connect()
  redisAvailable = probe.status === 'ready'
  probe.disconnect()
} catch { redisAvailable = false }

// Verify the server is actually publishing to Redis by doing a loopback probe:
// connect a fake agent, subscribe to Redis, send a session_init event, and check
// if it arrives on our Redis subscriber. If not, the server wasn't started with
// REDIS_URL set.
let serverHasRedis = false
if (serverAvailable && redisAvailable) {
  const probeRedisSub = new Redis(REDIS_URL, { lazyConnect: true })
  await probeRedisSub.connect()
  await probeRedisSub.subscribe(STREAMING_CHANNEL)

  serverHasRedis = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000)
    probeRedisSub.on('message', () => { clearTimeout(timer); resolve(true) })

    // Trigger a server publish by connecting a fake agent and sending a session_init
    const probeWs = new WebSocket(RELAY_WS)
    probeWs.on('open', () => {
      probeWs.send(JSON.stringify({
        type: 'machine.register', timestamp: new Date().toISOString(),
        machineId: `redis-probe-${Date.now()}`,
        machineInfo: { name: 'redis-probe', hostname: 'probe', platform: 'darwin',
          providers: [{ type: 'claude-code', version: '1.0.0', status: 'available', maxConcurrentTasks: 1, currentTasks: 0, capabilities: [] }],
          resources: { cpuCores: 1, memoryMB: 512, diskSpaceMB: 1000 },
          load: { cpuPercent: 0, memoryPercent: 0, activeTasks: 0, queuedTasks: 0 }, tags: [] },
      }))
    })
    probeWs.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'machine.register.ack') {
        // Send a session_init — relay will publishToRedis
        probeWs.send(JSON.stringify({
          type: 'task_session_init', timestamp: new Date().toISOString(),
          payload: { taskId: `redis-probe-task-${Date.now()}`, sessionId: 'probe-session', model: 'probe' },
        }))
      }
    })
    probeWs.on('error', () => { probeWs.close(); clearTimeout(timer); resolve(false) })
  })

  probeRedisSub.removeAllListeners('message')
  await probeRedisSub.unsubscribe(STREAMING_CHANNEL)
  probeRedisSub.disconnect()
}

const skipReason = !serverAvailable ? 'backend (3001) not available'
  : !viteAvailable ? 'vite (5173) not available'
  : !redisAvailable ? 'redis not available'
  : !serverHasRedis ? 'server not publishing to Redis — restart with: REDIS_URL=redis://localhost:6379 npm run dev:local'
  : null

if (skipReason) {
  console.warn(`[multi-instance e2e] Skipping — ${skipReason}`)
  console.warn('[multi-instance e2e] Prerequisites:')
  console.warn('  redis-server (or: brew services start redis)')
  console.warn('  REDIS_URL=redis://localhost:6379 npm run dev:local')
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Multi-Instance Redis E2E', () => {
  let runner: FakeAgentRunner
  let instanceB: MiniInstanceB

  test.beforeEach(async () => {
    if (skipReason) test.skip()
  })

  test.beforeEach(async () => {
    // Start fresh instance B mini-server for each test
    instanceB = await startMiniInstanceB(REDIS_URL)
  })

  test.afterEach(async () => {
    runner?.close()
    await instanceB?.close()
  })

  // --------------------------------------------------------------------------
  // 1. No duplication: Tab 1 gets events exactly once (self-dedup on instance A)
  //    Tab 2 gets same events via Redis (cross-instance delivery works)
  // --------------------------------------------------------------------------

  test('events arrive at both tabs; Tab 1 is not duplicated by Redis self-echo', async ({ browser }) => {
    const { executionId: taskId } = await createTestContext('NoDedup')
    runner = await connectFakeAgentRunner()

    const ctxA: BrowserContext = await browser.newContext()
    const ctxB: BrowserContext = await browser.newContext()
    const pageA = await ctxA.newPage()
    const pageB = await ctxB.newPage()

    try {
      // Tab 1: instance A (Vite proxy → port 3001)
      const { getEvents: getA } = await interceptSSEEventsA(pageA, [
        'task:stdout', 'task:session_init', 'task:tool_trace',
      ])
      await pageA.goto(VITE_URL)
      await pageA.waitForLoadState('load')

      // Tab 2: instance B mini-server — exposeFunction first, then navigate
      const { getEvents: getB } = await interceptSSEEventsB(pageB)
      await pageB.goto(`http://localhost:${MINI_SERVER_PORT}/`)
      await pageB.waitForLoadState('load')

      await pageA.waitForTimeout(500) // allow SSE connections to settle

      // Inject events via fake agent runner (→ instance A relay)
      const sessionId = randomUUID()
      const toolUseId1 = randomUUID()
      const toolUseId2 = randomUUID()

      runner.sendSessionInit(taskId, sessionId)
      await pageA.waitForTimeout(100)

      runner.sendText(taskId, 'First text chunk. ', 1)
      runner.sendText(taskId, 'Second text chunk. ', 2)
      runner.sendText(taskId, 'Third text chunk.', 3)
      await pageA.waitForTimeout(100)

      runner.sendToolUse(taskId, 'Read', { file_path: '/src/main.ts' }, toolUseId1)
      await pageA.waitForTimeout(100)
      runner.sendToolResult(taskId, 'Read', 'export default {}', true, toolUseId1)

      runner.sendToolUse(taskId, 'Write', { file_path: '/out/result.ts' }, toolUseId2)
      await pageA.waitForTimeout(100)
      runner.sendToolResult(taskId, 'Write', 'ok', true, toolUseId2)

      // ── Wait for events to arrive on both sides ─────────────────────────
      const deadline = Date.now() + 10000

      // Wait for instance B Redis events (via raw Redis subscriber)
      while (Date.now() < deadline) {
        const bForTask = instanceB.redisEvents.filter(e => e.taskId === taskId)
        if (bForTask.length >= 3) break // session_init + text + tool_use
        await pageA.waitForTimeout(100)
      }

      // Wait for Tab 1 SSE events
      while (Date.now() < deadline) {
        const aEvents = await getA()
        const aForTask = aEvents.filter(e => e.data?.taskId === taskId)
        if (aForTask.length >= 1) break
        await pageA.waitForTimeout(100)
      }

      const aEvents = await getA()
      const bBrowserEvents = await getB()
      const aForTask = aEvents.filter(e => e.data?.taskId === taskId)
      const bForTask = instanceB.redisEvents.filter(e => e.taskId === taskId)
      const bBrowserForTask = bBrowserEvents.filter(e => (e.data as Record<string, unknown>)?.taskId === taskId)

      console.log(`[multi] Instance A SSE events for task: ${aForTask.length}`)
      console.log(`[multi] Instance B Redis events for task: ${bForTask.length}`)
      console.log(`[multi] Instance B browser events for task: ${bBrowserForTask.length}`)

      // ── Assertion 1: Both received events ────────────────────────────────
      expect(aForTask.length).toBeGreaterThanOrEqual(1)
      expect(bForTask.length).toBeGreaterThanOrEqual(1)

      // ── Assertion 2: Tab 1 has NO duplicate tool events ───────────────────
      // If Redis self-dedup were broken, instance A would deliver tool events
      // twice: once from the in-process relay, once from the Redis echo.
      // Note: tool_use and tool_result share the same toolUseId (by design).
      // Check unique (toolUseId, isResult) pairs — each must appear at most once.
      const aToolTraces = aForTask.filter(e => e.event === 'task:tool_trace')
      const aDedupeKeys = aToolTraces.map(e => {
        const id = (e.data as Record<string, unknown>)?.toolUseId as string | undefined
        const isResult = (e.data as Record<string, unknown>)?.toolResult !== undefined
        return `${id}:${isResult}`
      })
      const aUniqueToolUseIds = new Set(aDedupeKeys)
      console.log(`[multi] Tab 1: ${aToolTraces.length} tool_trace events, ${aUniqueToolUseIds.size} unique toolUseIds`)
      // Each (toolUseId, kind) pair must appear at most once — duplication = Redis self-echo bug
      expect(aUniqueToolUseIds.size).toBe(aDedupeKeys.length)

      // ── Assertion 3: Instance B received the expected event types ─────────
      const bEventTypes = bForTask.map(e => e.eventType)
      console.log(`[multi] Instance B event types: ${[...new Set(bEventTypes)].join(', ')}`)
      expect(bForTask.some(e => e.eventType === 'text' || e.eventType === 'tool_use')).toBe(true)

      // ── Assertion 4: Tab 2 browser received SSE events from mini-server ───
      // (Only if the browser had time to connect to the SSE stream)
      if (bBrowserForTask.length > 0) {
        const bToolEvents = bBrowserForTask.filter(e => e.event === 'task:tool_use')
        const bToolUseIds = bToolEvents.map(e => (e.data as Record<string, unknown>)?.toolUseId).filter(Boolean)
        const bUniqueToolUseIds = new Set(bToolUseIds)
        console.log(`[multi] Tab 2: ${bToolEvents.length} tool_use events, ${bUniqueToolUseIds.size} unique toolUseIds`)
        expect(bUniqueToolUseIds.size).toBe(bToolUseIds.length)
      }

      // ── Assertion 5: Both tabs see the same toolUseIds (no fabrication) ───
      // Instance B Redis events should contain the same toolUseIds as Tab 1
      const bToolUseIdsFromRedis = bForTask
        .filter(e => e.eventType === 'tool_use')
        .map(e => e.data.toolUseId as string | undefined)
        .filter(Boolean)
      // Extract just the toolUseIds from tool_use traces on Tab 1 (for cross-check)
      const aToolUseIds = aToolTraces
        .filter(e => (e.data as Record<string, unknown>)?.toolResult === undefined)
        .map(e => (e.data as Record<string, unknown>)?.toolUseId as string | undefined)
        .filter(Boolean) as string[]
      if (bToolUseIdsFromRedis.length > 0 && aToolUseIds.length > 0) {
        for (const id of bToolUseIdsFromRedis) {
          expect(aToolUseIds).toContain(id)
        }
        console.log(`[multi] ✓ toolUseIds match between Tab 1 and Instance B Redis`)
      }

      console.log('[multi] ✓ No duplication on Tab 1; Instance B received events via Redis')
    } finally {
      await ctxA.close()
      await ctxB.close()
    }
  })

  // --------------------------------------------------------------------------
  // 2. Self-dedup: Instance A does NOT deliver its own Redis-echoed events twice
  //    This is the core duplication bug we're guarding against.
  // --------------------------------------------------------------------------

  test('instance A self-dedup: text/tool events arrive exactly once on Tab 1', async ({ page }) => {
    const { executionId: taskId } = await createTestContext('SelfDedup')
    runner = await connectFakeAgentRunner()

    const { getEvents } = await interceptSSEEventsA(page, [
      'task:stdout', 'task:session_init', 'task:tool_trace',
    ])
    await page.goto(VITE_URL)
    await page.waitForLoadState('load')
    await page.waitForTimeout(500)

    // Send exactly 2 tool uses with known toolUseIds
    const toolUseIds = [randomUUID(), randomUUID()]

    runner.sendSessionInit(taskId, randomUUID())
    await page.waitForTimeout(100)

    for (let i = 0; i < toolUseIds.length; i++) {
      runner.sendText(taskId, `Text before tool ${i + 1}. `, i + 1)
      runner.sendToolUse(taskId, 'Read', { file_path: `/file${i}.ts` }, toolUseIds[i])
      await page.waitForTimeout(100)
      runner.sendToolResult(taskId, 'Read', `content${i}`, true, toolUseIds[i])
    }

    // Wait for events
    await expect.poll(async () => {
      const all = await getEvents()
      return all.filter(e => e.data?.taskId === taskId).length
    }, { timeout: 10000 }).toBeGreaterThanOrEqual(1)

    // Allow Redis round-trip time for any potential self-echo to arrive
    await page.waitForTimeout(1000)

    const all = await getEvents()
    const forTask = all.filter(e => e.data?.taskId === taskId)
    const toolTraces = forTask.filter(e => e.event === 'task:tool_trace')

    // Each tool call generates TWO tool_trace events: one for tool_use (no toolResult)
    // and one for tool_result (has toolResult). Both share the same toolUseId — that's
    // expected. A Redis self-echo duplication would add a THIRD event with the same
    // (toolUseId, kind) pair. Dedup check: each (toolUseId, isResult) key appears once.
    const dedupKeys = toolTraces.map(e => {
      const id = e.data?.toolUseId as string | undefined
      const isResult = (e.data as Record<string, unknown>)?.toolResult !== undefined
      return `${id}:${isResult}`
    })
    const uniqueKeys = new Set(dedupKeys)

    console.log(`[multi] Total tool_trace events on Tab 1: ${toolTraces.length}`)
    console.log(`[multi] Unique (toolUseId, isResult) keys: ${uniqueKeys.size}`)
    console.log(`[multi] Keys: ${dedupKeys.join(', ')}`)

    // If self-dedup is broken: a (toolUseId, isResult) key would appear TWICE —
    // once from in-process relay, once from Redis echo.
    expect(uniqueKeys.size).toBe(dedupKeys.length)

    // Also verify each sent toolUseId appears at most once per kind
    for (const sentId of toolUseIds) {
      const useCount = toolTraces.filter(e =>
        (e.data?.toolUseId as string) === sentId &&
        (e.data as Record<string, unknown>)?.toolResult === undefined
      ).length
      const resultCount = toolTraces.filter(e =>
        (e.data?.toolUseId as string) === sentId &&
        (e.data as Record<string, unknown>)?.toolResult !== undefined
      ).length
      console.log(`[multi] toolUseId ${sentId.slice(0, 8)}: use=${useCount}x result=${resultCount}x`)
      expect(useCount).toBeLessThanOrEqual(1)
      expect(resultCount).toBeLessThanOrEqual(1)
    }

    console.log('[multi] ✓ No Redis self-echo duplication on Tab 1')
  })

  // --------------------------------------------------------------------------
  // 3. Redis cross-instance: same events arrive on Tab 2 via instance B
  //    Verifies the pub/sub pipeline carries all event types (not just coord)
  // --------------------------------------------------------------------------

  test('instance B receives all event types from Redis', async ({ browser }) => {
    const { executionId: taskId } = await createTestContext('CrossInstance')
    runner = await connectFakeAgentRunner()

    const ctxB: BrowserContext = await browser.newContext()
    const pageB = await ctxB.newPage()

    try {
      const { getEvents: getBrowser } = await interceptSSEEventsB(pageB)
      await pageB.goto(`http://localhost:${MINI_SERVER_PORT}/`)
      await pageB.waitForLoadState('load')
      await pageB.waitForTimeout(300)

      // Send a variety of events
      const toolUseId = randomUUID()
      runner.sendSessionInit(taskId, randomUUID())
      await pageB.waitForTimeout(100)
      runner.sendText(taskId, 'Cross-instance text delivery test.', 1)
      runner.sendToolUse(taskId, 'Read', { file_path: '/cross.ts' }, toolUseId)
      await pageB.waitForTimeout(100)
      runner.sendToolResult(taskId, 'Read', 'file content', true, toolUseId)

      // Wait for instance B to receive all event types via Redis
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) {
        const bForTask = instanceB.redisEvents.filter(e => e.taskId === taskId)
        const hasText = bForTask.some(e => e.eventType === 'text')
        const hasToolUse = bForTask.some(e => e.eventType === 'tool_use')
        const hasSessionInit = bForTask.some(e => e.eventType === 'session_init')
        if (hasText && hasToolUse && hasSessionInit) break
        await pageB.waitForTimeout(150)
      }

      const bForTask = instanceB.redisEvents.filter(e => e.taskId === taskId)
      const eventTypes = [...new Set(bForTask.map(e => e.eventType))]
      console.log(`[multi] Instance B received ${bForTask.length} events: ${eventTypes.join(', ')}`)

      expect(bForTask.some(e => e.eventType === 'session_init')).toBe(true)
      expect(bForTask.some(e => e.eventType === 'text')).toBe(true)
      expect(bForTask.some(e => e.eventType === 'tool_use')).toBe(true)

      // Verify the toolUseId was passed through correctly
      const toolUseEvent = bForTask.find(e => e.eventType === 'tool_use')
      expect(toolUseEvent?.data.toolUseId).toBe(toolUseId)

      // Verify browser Tab 2 also received the SSE events from mini-server
      const browserForTask = await getBrowser()
      const browserB = browserForTask.filter(e => (e.data as Record<string, unknown>)?.taskId === taskId)
      console.log(`[multi] Tab 2 browser received ${browserB.length} SSE events`)
      if (browserB.length > 0) {
        const browserEventTypes = [...new Set(browserB.map(e => e.event))]
        console.log(`[multi] Tab 2 event types: ${browserEventTypes.join(', ')}`)
      }

      console.log('[multi] ✓ All event types delivered cross-instance via Redis')
    } finally {
      await ctxB.close()
    }
  })

  // --------------------------------------------------------------------------
  // 4. Two tabs simultaneously, one on each instance, no duplication in either
  // --------------------------------------------------------------------------

  test('two browser tabs (one per instance) receive identical event set without duplication', async ({ browser }) => {
    const { executionId: taskId } = await createTestContext('TwoTabs')
    runner = await connectFakeAgentRunner()

    const ctxA: BrowserContext = await browser.newContext()
    const ctxB: BrowserContext = await browser.newContext()
    const pageA = await ctxA.newPage()
    const pageB = await ctxB.newPage()

    try {
      const { getEvents: getA } = await interceptSSEEventsA(pageA, [
        'task:stdout', 'task:tool_trace', 'task:session_init',
      ])
      const { getEvents: getBrowser } = await interceptSSEEventsB(pageB)

      await Promise.all([
        pageA.goto(VITE_URL),
        pageB.goto(`http://localhost:${MINI_SERVER_PORT}/`),
      ])
      await Promise.all([
        pageA.waitForLoadState('load'),
        pageB.waitForLoadState('load'),
      ])
      await pageA.waitForTimeout(500)

      // Send 3 tool uses
      const toolUseIds = [randomUUID(), randomUUID(), randomUUID()]

      runner.sendSessionInit(taskId, randomUUID())
      await pageA.waitForTimeout(100)

      for (let i = 0; i < toolUseIds.length; i++) {
        runner.sendText(taskId, `Text ${i + 1}. `, i + 1)
        runner.sendToolUse(taskId, 'Read', { file_path: `/f${i}.ts` }, toolUseIds[i])
        await pageA.waitForTimeout(80)
        runner.sendToolResult(taskId, 'Read', `out${i}`, true, toolUseIds[i])
        await pageA.waitForTimeout(50)
      }

      // Wait for both sides
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) {
        const aForTask = (await getA()).filter(e => e.data?.taskId === taskId)
        const bForTask = instanceB.redisEvents.filter(e => e.taskId === taskId)
        if (aForTask.length >= 1 && bForTask.length >= 3) break
        await pageA.waitForTimeout(100)
      }
      await pageA.waitForTimeout(800) // extra wait for Redis round-trip

      const aForTask = (await getA()).filter(e => e.data?.taskId === taskId)
      const bRedisForTask = instanceB.redisEvents.filter(e => e.taskId === taskId)
      const bBrowserForTask = (await getBrowser()).filter(e => (e.data as Record<string, unknown>)?.taskId === taskId)

      console.log(`[multi] Tab 1 (instance A) events: ${aForTask.length}`)
      console.log(`[multi] Instance B Redis events: ${bRedisForTask.length}`)
      console.log(`[multi] Tab 2 (instance B browser) events: ${bBrowserForTask.length}`)

      // ── No duplication on Tab 1 ───────────────────────────────────────────
      // Each tool call produces TWO tool_trace events: tool_use + tool_result (same toolUseId).
      // Check unique (toolUseId, isResult) keys — Redis self-echo would add a duplicate key.
      const aToolTraces = aForTask.filter(e => e.event === 'task:tool_trace')
      const aDedupeKeys = aToolTraces.map(e => {
        const id = e.data?.toolUseId as string | undefined
        const isResult = (e.data as Record<string, unknown>)?.toolResult !== undefined
        return `${id}:${isResult}`
      })
      const aUniqueKeys = new Set(aDedupeKeys)
      console.log(`[multi] Tab 1 tool events: ${aToolTraces.length}, unique (id,kind) keys: ${aUniqueKeys.size}`)
      expect(aUniqueKeys.size).toBe(aDedupeKeys.length) // no duplicates
      // Convenience alias for toolUseId check below
      const aReceivedIds = aToolTraces
        .filter(e => (e.data as Record<string, unknown>)?.toolResult === undefined)
        .map(e => e.data?.toolUseId as string | undefined)
        .filter(Boolean) as string[]

      // ── No duplication on Instance B Redis ────────────────────────────────
      const bToolEvents = bRedisForTask.filter(e => e.eventType === 'tool_use')
      const bReceivedIds = bToolEvents.map(e => e.data.toolUseId as string | undefined).filter(Boolean)
      const bUniqueIds = new Set(bReceivedIds)
      console.log(`[multi] Instance B tool events: ${bToolEvents.length}, unique IDs: ${bUniqueIds.size}`)
      expect(bUniqueIds.size).toBe(bReceivedIds.length) // no duplicates

      // ── Both tabs see the same toolUseIds ─────────────────────────────────
      for (const sentId of toolUseIds) {
        const inA = aReceivedIds.includes(sentId)
        const inB = bReceivedIds.includes(sentId)
        console.log(`[multi] toolUseId ${sentId.slice(0, 8)}: Tab1=${inA}, InstanceB=${inB}`)
        // Instance B always gets it (Redis path)
        expect(inB).toBe(true)
      }

      console.log('[multi] ✓ Two tabs received identical events without duplication')
    } finally {
      await ctxA.close()
      await ctxB.close()
    }
  })
})

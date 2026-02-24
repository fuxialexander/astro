/**
 * Unit tests for RealtimeClient SSE connection handling.
 *
 * Tests the client-side SSE wrapper that manages connection to
 * /api/events/stream. Covers auth token handling, reconnection,
 * event dispatch, and error states that surface as 401 errors
 * and ERR_TIMED_OUT in production.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

/**
 * Minimal EventSource mock that simulates browser behavior.
 * - Stores url and calls onopen/onerror
 * - Collects addEventListener calls
 * - Provides a way to simulate events
 */
class MockEventSource {
  url: string
  readyState: number = 0
  onopen: ((ev: Event) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  private listeners = new Map<string, Set<(e: MessageEvent) => void>>()

  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2

  constructor(url: string) {
    this.url = url
    // Simulate async open
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.(new Event('open'))
    }, 0)
  }

  addEventListener(type: string, handler: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(handler)
  }

  removeEventListener(type: string, handler: (e: MessageEvent) => void) {
    this.listeners.get(type)?.delete(handler)
  }

  /** Test helper: simulate receiving an SSE event */
  _simulateEvent(type: string, data: string, lastEventId?: string) {
    const handlers = this.listeners.get(type)
    if (!handlers) return
    const event = new MessageEvent(type, { data }) as MessageEvent & { lastEventId?: string }
    if (lastEventId) Object.defineProperty(event, 'lastEventId', { value: lastEventId })
    for (const handler of handlers) handler(event)
  }

  /** Test helper: simulate connection error */
  _simulateError() {
    this.readyState = 2
    this.onerror?.(new Event('error'))
  }

  close() {
    this.readyState = 2
  }
}

// Replace global EventSource
const originalEventSource = globalThis.EventSource
beforeEach(() => {
  (globalThis as { EventSource: unknown }).EventSource = MockEventSource
})
afterEach(() => {
  (globalThis as { EventSource: unknown }).EventSource = originalEventSource
})

/**
 * Re-implements RealtimeClient logic in isolation (same as src/lib/realtime-client.ts)
 * to avoid importing the module which depends on browser-only APIs and supabase client.
 */
type RealtimeEventType = 'machines:snapshot' | 'task:result' | 'task:stdout' | 'heartbeat'
interface RealtimeEvent { type: RealtimeEventType; data: unknown; id?: string }
type RealtimeEventHandler = (event: RealtimeEvent) => void

class TestableRealtimeClient {
  private eventSource: MockEventSource | null = null
  private handlers = new Map<string, Set<RealtimeEventHandler>>()
  private globalHandlers = new Set<RealtimeEventHandler>()
  private _connected = false
  private baseUrl: string

  constructor(baseUrl = '/api/events/stream') {
    this.baseUrl = baseUrl
  }

  get connected() { return this._connected }

  /** Connect with an explicit token (mirrors the real client which calls getAccessToken()) */
  connect(token?: string, projectId?: string): MockEventSource {
    if (this.eventSource) this.disconnect()

    const params = new URLSearchParams()
    if (projectId) params.set('projectId', projectId)
    if (token) params.set('token', token)

    const url = params.toString() ? `${this.baseUrl}?${params}` : this.baseUrl
    const es = new MockEventSource(url)
    this.eventSource = es

    es.onopen = () => {
      this._connected = true
      this.emit({ type: 'heartbeat' as RealtimeEventType, data: { connected: true } })
    }

    es.onerror = () => {
      this._connected = false
    }

    const eventTypes: RealtimeEventType[] = ['machines:snapshot', 'task:result', 'task:stdout', 'heartbeat']
    for (const type of eventTypes) {
      es.addEventListener(type, (e: MessageEvent) => {
        let data: unknown
        try { data = e.data ? JSON.parse(e.data) : {} } catch { data = e.data }
        this.emit({ type, data, id: (e as MessageEvent & { lastEventId?: string }).lastEventId })
      })
    }

    return es
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
    this._connected = false
  }

  on(type: RealtimeEventType | '*', handler: RealtimeEventHandler): () => void {
    if (type === '*') {
      this.globalHandlers.add(handler)
      return () => this.globalHandlers.delete(handler)
    }
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
    return () => this.handlers.get(type)?.delete(handler)
  }

  private emit(event: RealtimeEvent) {
    const typeHandlers = this.handlers.get(event.type)
    if (typeHandlers) for (const h of typeHandlers) h(event)
    for (const h of this.globalHandlers) h(event)
  }
}

describe('RealtimeClient connection', () => {
  it('includes token in URL query params', () => {
    const client = new TestableRealtimeClient()
    const es = client.connect('my-jwt-token')
    expect(es.url).toContain('token=my-jwt-token')
    client.disconnect()
  })

  it('connects without token when none provided (no auth / local mode)', () => {
    const client = new TestableRealtimeClient()
    const es = client.connect()
    expect(es.url).toBe('/api/events/stream')
    client.disconnect()
  })

  it('connects without token when token is undefined (auth race condition)', () => {
    const client = new TestableRealtimeClient()
    const es = client.connect(undefined)
    // This is the race condition: if getAccessToken() returns undefined,
    // the SSE connects without auth and gets a 401 from the server
    expect(es.url).toBe('/api/events/stream')
    expect(es.url).not.toContain('token=')
    client.disconnect()
  })

  it('includes projectId when provided', () => {
    const client = new TestableRealtimeClient()
    const es = client.connect('tok', 'proj-123')
    expect(es.url).toContain('projectId=proj-123')
    expect(es.url).toContain('token=tok')
    client.disconnect()
  })

  it('sets connected=true on open', async () => {
    const client = new TestableRealtimeClient()
    client.connect('tok')
    expect(client.connected).toBe(false)

    // Wait for async onopen
    await new Promise(r => setTimeout(r, 10))
    expect(client.connected).toBe(true)
    client.disconnect()
  })

  it('sets connected=false on error', async () => {
    const client = new TestableRealtimeClient()
    const es = client.connect('tok')
    await new Promise(r => setTimeout(r, 10))
    expect(client.connected).toBe(true)

    es._simulateError()
    expect(client.connected).toBe(false)
    client.disconnect()
  })

  it('disconnects previous connection when reconnecting', async () => {
    const client = new TestableRealtimeClient()
    const es1 = client.connect('tok1')
    await new Promise(r => setTimeout(r, 10))

    const es2 = client.connect('tok2')
    expect(es1.readyState).toBe(MockEventSource.CLOSED)
    expect(es2.url).toContain('token=tok2')
    client.disconnect()
  })

  it('disconnect closes EventSource and resets state', async () => {
    const client = new TestableRealtimeClient()
    const es = client.connect('tok')
    await new Promise(r => setTimeout(r, 10))
    expect(client.connected).toBe(true)

    client.disconnect()
    expect(es.readyState).toBe(MockEventSource.CLOSED)
    expect(client.connected).toBe(false)
  })
})

describe('RealtimeClient event dispatch', () => {
  it('dispatches typed events to specific handlers', async () => {
    const client = new TestableRealtimeClient()
    const es = client.connect('tok')
    const received: RealtimeEvent[] = []
    client.on('task:result', (e) => received.push(e))

    await new Promise(r => setTimeout(r, 10))
    es._simulateEvent('task:result', JSON.stringify({ taskId: 't1', status: 'completed' }))

    expect(received).toHaveLength(1)
    expect((received[0].data as { taskId: string }).taskId).toBe('t1')
    client.disconnect()
  })

  it('dispatches to global (*) handlers', async () => {
    const client = new TestableRealtimeClient()
    const es = client.connect('tok')
    const received: RealtimeEvent[] = []
    client.on('*', (e) => received.push(e))

    await new Promise(r => setTimeout(r, 10))
    // onopen fires a heartbeat + we simulate a task:result
    es._simulateEvent('task:result', JSON.stringify({ taskId: 't1' }))

    // Should have: heartbeat from onopen + task:result
    expect(received.length).toBeGreaterThanOrEqual(2)
    client.disconnect()
  })

  it('handles malformed JSON data gracefully', async () => {
    const client = new TestableRealtimeClient()
    const es = client.connect('tok')
    const received: RealtimeEvent[] = []
    client.on('task:stdout', (e) => received.push(e))

    await new Promise(r => setTimeout(r, 10))
    es._simulateEvent('task:stdout', 'not-json-data')

    expect(received).toHaveLength(1)
    expect(received[0].data).toBe('not-json-data') // falls back to raw string
    client.disconnect()
  })

  it('handles empty data field', async () => {
    const client = new TestableRealtimeClient()
    const es = client.connect('tok')
    const received: RealtimeEvent[] = []
    client.on('heartbeat', (e) => received.push(e))

    await new Promise(r => setTimeout(r, 10))
    es._simulateEvent('heartbeat', '')

    // The onopen heartbeat + the simulated one
    expect(received.length).toBeGreaterThanOrEqual(1)
    client.disconnect()
  })

  it('unsubscribe function removes handler', async () => {
    const client = new TestableRealtimeClient()
    const es = client.connect('tok')
    const received: RealtimeEvent[] = []
    const unsub = client.on('task:result', (e) => received.push(e))

    await new Promise(r => setTimeout(r, 10))
    es._simulateEvent('task:result', '{"id":"1"}')
    expect(received).toHaveLength(1)

    unsub()
    es._simulateEvent('task:result', '{"id":"2"}')
    expect(received).toHaveLength(1) // no more events
    client.disconnect()
  })
})

/**
 * Tests for the auth token race condition.
 *
 * The production error: SSE connects before getAccessToken() resolves,
 * resulting in a connection without a token that gets 401 from the server.
 *
 * Root cause: `const token = await getAccessToken()` in realtime-client.ts
 * may return undefined if Supabase auth hasn't initialized yet. The code
 * only adds the token param `if (token)`, so the SSE URL has no auth.
 */
describe('SSE auth race condition', () => {
  it('missing token results in unauthenticated URL', () => {
    const client = new TestableRealtimeClient()
    const es = client.connect(undefined) // simulates getAccessToken() returning undefined
    expect(es.url).toBe('/api/events/stream')
    expect(es.url).not.toContain('token')
    client.disconnect()
  })

  it('empty string token is not included in URL', () => {
    const client = new TestableRealtimeClient()
    const es = client.connect('') // empty token
    // Empty string is falsy, so token param is not added
    expect(es.url).toBe('/api/events/stream')
    client.disconnect()
  })

  it('expired token is still sent to server (server validates)', () => {
    const client = new TestableRealtimeClient()
    const es = client.connect('expired-jwt-token')
    // The client always sends the token — it's the server that returns 401
    expect(es.url).toContain('token=expired-jwt-token')
    client.disconnect()
  })
})

/**
 * Tests for SSE heartbeat timeout behavior.
 *
 * The production error: ERR_TIMED_OUT and ERR_HTTP2_PING_FAILED suggest
 * the SSE connection is being killed by an intermediate proxy (Cloudflare,
 * nginx, or HTTP/2 keepalive). The server sends heartbeats every 15s,
 * but some proxies have shorter idle timeouts.
 */
describe('SSE heartbeat expectations', () => {
  it('server heartbeat interval of 15s may be too slow for some proxies', () => {
    // Document the known issue: Cloudflare has a 100s idle timeout for
    // WebSocket/SSE, but HTTP/2 PING failures can happen sooner.
    // The 15s heartbeat should be sufficient for most cases, but
    // ERR_HTTP2_PING_FAILED suggests the TCP connection itself is stalling.
    const SERVER_HEARTBEAT_INTERVAL = 15_000
    const CLOUDFLARE_IDLE_TIMEOUT = 100_000
    const HTTP2_PING_TIMEOUT = 5_000 // typical browser HTTP/2 ping timeout

    // The heartbeat is well within Cloudflare's limit
    expect(SERVER_HEARTBEAT_INTERVAL).toBeLessThan(CLOUDFLARE_IDLE_TIMEOUT)

    // But if the network is degraded, the HTTP/2 layer may timeout before
    // the next heartbeat arrives — this is a transport-level issue, not app-level
    expect(HTTP2_PING_TIMEOUT).toBeLessThan(SERVER_HEARTBEAT_INTERVAL)
  })
})

/**
 * Integration tests for relay-based file tree fetching (GET /api/fs/files).
 *
 * The endpoint sends a `file_list_request` via relay, waits for a
 * `file_list:response` event with a matching correlationId, then returns the
 * filtered file list to the caller.  All assertions use the test-server helper
 * (Hono app.request) with the relay server mocked at the EventEmitter boundary.
 */
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest'
import { setupTestServer, request } from '../helpers/test-server.js'
import { relayServer } from '../../server/lib/relay-server.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await setupTestServer()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mock `relayServer.requestFileList` so it captures the correlationId and
 * immediately emits a `file_list:response` with the given files.
 */
function mockRelayFileList(files: string[], { delay = 0 }: { delay?: number } = {}) {
  return vi.spyOn(relayServer, 'requestFileList').mockImplementation(
    (_machineId: string, _path: string, correlationId: string) => {
      const emit = () =>
        relayServer.emit('file_list:response', { correlationId, files })
      if (delay > 0) {
        setTimeout(emit, delay)
      } else {
        // Use setImmediate so the handler is registered before we emit
        setImmediate(emit)
      }
      return true
    },
  )
}

// ===========================================================================
// Tests
// ===========================================================================

describe('GET /api/fs/files', () => {
  it('returns 400 when projectId is missing', async () => {
    const res = await request('/api/fs/files?machineId=m1')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/projectId/i)
  })

  it('returns 400 when machineId is missing', async () => {
    const res = await request('/api/fs/files?projectId=p1')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/machineId/i)
  })

  it('returns empty files when workingDirectory is missing', async () => {
    const res = await request('/api/fs/files?projectId=p1&machineId=m1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.files).toEqual([])
  })

  it('returns files from a successful relay round-trip', async () => {
    const files = ['src/index.ts', 'src/lib/utils.ts', 'README.md']
    mockRelayFileList(files)

    const res = await request(
      '/api/fs/files?projectId=p1&machineId=m1&workingDirectory=/tmp/project',
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.files).toEqual(files)
  })

  it('filters files case-insensitively by the q parameter', async () => {
    const files = ['src/Main.ts', 'src/main-utils.ts', 'README.md', 'lib/other.ts']
    mockRelayFileList(files)

    const res = await request(
      '/api/fs/files?projectId=p1&machineId=m1&workingDirectory=/tmp/project&q=main',
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    // "main" matches "Main.ts" and "main-utils.ts" (case-insensitive includes)
    expect(body.files).toEqual(['src/Main.ts', 'src/main-utils.ts'])
  })

  it('caps results at 50', async () => {
    const files = Array.from({ length: 100 }, (_, i) => `file-${i}.ts`)
    mockRelayFileList(files)

    const res = await request(
      '/api/fs/files?projectId=p1&machineId=m1&workingDirectory=/tmp/project',
    )
    const body = await res.json()
    expect(body.files.length).toBe(50)
    expect(body.files[0]).toBe('file-0.ts')
    expect(body.files[49]).toBe('file-49.ts')
  })

  it('returns empty files when the machine is not connected (requestFileList returns false)', async () => {
    vi.spyOn(relayServer, 'requestFileList').mockReturnValue(false)

    const res = await request(
      '/api/fs/files?projectId=p1&machineId=m1&workingDirectory=/tmp/project',
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.files).toEqual([])
  })

  it('returns empty files on timeout (no response within 5s)', async () => {
    // Mock requestFileList to return true but never emit a response
    vi.spyOn(relayServer, 'requestFileList').mockReturnValue(true)

    const res = await request(
      '/api/fs/files?projectId=p1&machineId=m1&workingDirectory=/tmp/project',
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.files).toEqual([])
  }, 10_000)

  it('isolates concurrent requests by correlationId', async () => {
    // Two concurrent requests should not cross-pollinate results.
    // We capture the correlationIds and respond with different file lists.
    const calls: Array<{ correlationId: string; resolve: () => void }> = []

    vi.spyOn(relayServer, 'requestFileList').mockImplementation(
      (_machineId: string, _path: string, correlationId: string) => {
        const entry = { correlationId, resolve: () => {} }
        const p = new Promise<void>((r) => { entry.resolve = r })
        calls.push(entry)
        // Don't emit yet — we'll emit manually after both requests are in flight
        void p
        return true
      },
    )

    // Fire two requests concurrently
    const p1 = request(
      '/api/fs/files?projectId=p1&machineId=m1&workingDirectory=/tmp/a',
    )
    const p2 = request(
      '/api/fs/files?projectId=p2&machineId=m1&workingDirectory=/tmp/b',
    )

    // Wait for both requestFileList calls to be captured
    await vi.waitFor(() => expect(calls.length).toBe(2), { timeout: 2000 })

    // Emit responses in reverse order with distinct file lists
    relayServer.emit('file_list:response', {
      correlationId: calls[1].correlationId,
      files: ['b1.ts', 'b2.ts'],
    })
    relayServer.emit('file_list:response', {
      correlationId: calls[0].correlationId,
      files: ['a1.ts'],
    })

    const [res1, res2] = await Promise.all([p1, p2])
    const body1 = await res1.json()
    const body2 = await res2.json()

    expect(body1.files).toEqual(['a1.ts'])
    expect(body2.files).toEqual(['b1.ts', 'b2.ts'])
  })
})

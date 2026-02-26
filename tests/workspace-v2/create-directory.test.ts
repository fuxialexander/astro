/**
 * Integration tests for relay-based directory creation (POST /api/fs/directories).
 *
 * The endpoint sends a `create_directory_request` via relay, waits for a
 * `create_directory:response` event with a matching correlationId, then returns
 * the result.  All assertions use the test-server helper (Hono app.request)
 * with the relay server mocked at the EventEmitter boundary.
 */
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest'
import { setupTestServer, postJson } from '../helpers/test-server.js'
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
 * Mock `relayServer.requestCreateDirectory` so it captures the correlationId
 * and immediately emits a `create_directory:response` with the given result.
 */
function mockRelayCreateDirectory(
  result: { success: boolean; path?: string; error?: string },
  { delay = 0 }: { delay?: number } = {},
) {
  return vi.spyOn(relayServer, 'requestCreateDirectory').mockImplementation(
    (_machineId: string, _parentPath: string, _name: string, correlationId: string) => {
      const emit = () =>
        relayServer.emit('create_directory:response', { correlationId, ...result })
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

describe('POST /api/fs/directories', () => {
  // ── Validation ──────────────────────────────────────────────────────

  it('returns 400 when machineId is missing', async () => {
    const res = await postJson('/api/fs/directories', { path: '/home/user', name: 'new-folder' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/machineId/i)
  })

  it('returns 400 when path is missing', async () => {
    const res = await postJson('/api/fs/directories', { machineId: 'm1', name: 'new-folder' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/path/i)
  })

  it('returns 400 when name is missing', async () => {
    const res = await postJson('/api/fs/directories', { machineId: 'm1', path: '/home/user' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/name/i)
  })

  it('returns 400 when name is empty string', async () => {
    const res = await postJson('/api/fs/directories', { machineId: 'm1', path: '/home/user', name: '   ' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/name/i)
  })

  it('returns 400 when name is "."', async () => {
    const res = await postJson('/api/fs/directories', { machineId: 'm1', path: '/home/user', name: '.' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid/i)
  })

  it('returns 400 when name is ".."', async () => {
    const res = await postJson('/api/fs/directories', { machineId: 'm1', path: '/home/user', name: '..' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid/i)
  })

  it('returns 400 when name contains forward slash', async () => {
    const res = await postJson('/api/fs/directories', { machineId: 'm1', path: '/home/user', name: 'foo/bar' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/separator/i)
  })

  it('returns 400 when name contains backslash', async () => {
    const res = await postJson('/api/fs/directories', { machineId: 'm1', path: '/home/user', name: 'foo\\bar' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/separator/i)
  })

  it('returns 400 when name contains null byte', async () => {
    const res = await postJson('/api/fs/directories', { machineId: 'm1', path: '/home/user', name: 'foo\0bar' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/separator/i)
  })

  // ── Successful creation ─────────────────────────────────────────────

  it('creates a directory via relay and returns success', async () => {
    mockRelayCreateDirectory({ success: true, path: '/home/user/new-folder' })

    const res = await postJson('/api/fs/directories', {
      machineId: 'm1',
      path: '/home/user',
      name: 'new-folder',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.path).toBe('/home/user/new-folder')
  })

  it('passes correct arguments to relay', async () => {
    const spy = mockRelayCreateDirectory({ success: true, path: '/tmp/test/my-dir' })

    await postJson('/api/fs/directories', {
      machineId: 'machine-abc',
      path: '/tmp/test',
      name: 'my-dir',
    })

    expect(spy).toHaveBeenCalledWith(
      'machine-abc',
      '/tmp/test',
      'my-dir',
      expect.any(String), // correlationId
    )
  })

  it('trims whitespace from folder name', async () => {
    const spy = mockRelayCreateDirectory({ success: true, path: '/home/user/trimmed' })

    await postJson('/api/fs/directories', {
      machineId: 'm1',
      path: '/home/user',
      name: '  trimmed  ',
    })

    // The trimmed name should be passed to the relay
    expect(spy).toHaveBeenCalledWith('m1', '/home/user', 'trimmed', expect.any(String))
  })

  // ── Error scenarios ─────────────────────────────────────────────────

  it('returns error when relay reports failure', async () => {
    mockRelayCreateDirectory({ success: false, error: 'Permission denied' })

    const res = await postJson('/api/fs/directories', {
      machineId: 'm1',
      path: '/home/user',
      name: 'restricted',
    })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('Permission denied')
  })

  it('returns error when machine is not connected', async () => {
    vi.spyOn(relayServer, 'requestCreateDirectory').mockReturnValue(false)

    const res = await postJson('/api/fs/directories', {
      machineId: 'm1',
      path: '/home/user',
      name: 'test',
    })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/not connected/i)
  })

  it('returns error on timeout (no response within 10s)', async () => {
    // Mock requestCreateDirectory to return true but never emit a response
    vi.spyOn(relayServer, 'requestCreateDirectory').mockReturnValue(true)

    const res = await postJson('/api/fs/directories', {
      machineId: 'm1',
      path: '/home/user',
      name: 'test',
    })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/timed out/i)
  }, 15_000)

  // ── Concurrent request isolation ────────────────────────────────────

  it('isolates concurrent requests by correlationId', async () => {
    const calls: Array<{ correlationId: string }> = []

    vi.spyOn(relayServer, 'requestCreateDirectory').mockImplementation(
      (_machineId: string, _parentPath: string, _name: string, correlationId: string) => {
        calls.push({ correlationId })
        return true
      },
    )

    // Fire two requests concurrently
    const p1 = postJson('/api/fs/directories', { machineId: 'm1', path: '/a', name: 'dir1' })
    const p2 = postJson('/api/fs/directories', { machineId: 'm1', path: '/b', name: 'dir2' })

    // Wait for both requestCreateDirectory calls to be captured
    await vi.waitFor(() => expect(calls.length).toBe(2), { timeout: 2000 })

    // Emit responses in reverse order
    relayServer.emit('create_directory:response', {
      correlationId: calls[1].correlationId,
      success: true,
      path: '/b/dir2',
    })
    relayServer.emit('create_directory:response', {
      correlationId: calls[0].correlationId,
      success: true,
      path: '/a/dir1',
    })

    const [res1, res2] = await Promise.all([p1, p2])
    const body1 = await res1.json()
    const body2 = await res2.json()

    expect(body1.success).toBe(true)
    expect(body1.path).toBe('/a/dir1')
    expect(body2.success).toBe(true)
    expect(body2.path).toBe('/b/dir2')
  })
})

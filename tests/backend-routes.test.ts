/**
 * Tests for backend routes (server/routes/health.ts)
 *
 * Covers:
 * - GET /api/backends — returns backends from machine registry
 * - GET /api/backends/:id — returns single backend with context string
 * - POST /api/backends/detect — returns current backends (no-op detect)
 * - Handles machines with no execution strategies
 * - Handles empty machine registry
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Mock machineRegistry before importing routes
const mockMachines = vi.fn<() => Array<{
  machineId: string
  name: string
  executionStrategies?: Array<{
    id: string
    name: string
    available: boolean
    version?: string
    metadata?: Record<string, unknown>
  }>
  userId?: string
  providers: Array<{ type: string }>
  load: { activeTasks: number }
}>>()

vi.mock('../server/lib/machine-registry.js', () => ({
  machineRegistry: {
    getAll: () => mockMachines(),
    get: (id: string) => mockMachines().find((m) => m.machineId === id) ?? null,
  },
}))

vi.mock('../server/lib/app-mode.js', () => ({
  isServerMode: () => false,
}))

vi.mock('../server/middleware/auth.js', () => ({
  requireAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))

vi.mock('../server/lib/db/bootstrap-local.js', () => ({
  LOCAL_USER_ID: 'local',
}))

// Import the route factory AFTER mocks
const { healthRoute } = await import('../server/routes/health.js')

function createApp() {
  const app = new Hono()
  app.route('/api', healthRoute)
  return app
}

describe('GET /api/backends', () => {
  beforeEach(() => {
    mockMachines.mockReset()
  })

  it('returns backends from machine registry', async () => {
    mockMachines.mockReturnValue([{
      machineId: 'machine-1',
      name: 'My Laptop',
      providers: [],
      load: { activeTasks: 0 },
      executionStrategies: [
        { id: 'direct', name: 'Direct', available: true },
        { id: 'docker', name: 'Docker', available: true, version: '24.0.0', metadata: { cpus: 8, memoryGb: 16 } },
        { id: 'slurm', name: 'SLURM', available: true, version: '22.05.8', metadata: { clusterName: 'hpc1' } },
      ],
    }])

    const app = createApp()
    const res = await app.request('/api/backends')
    expect(res.status).toBe(200)

    const data = await res.json() as { backends: Array<{ id: string; name: string; machineId: string }>; detectedAt: string }
    // 'direct' should be filtered out
    expect(data.backends).toHaveLength(2)
    expect(data.backends[0]!.id).toBe('docker')
    expect(data.backends[0]!.machineId).toBe('machine-1')
    expect(data.backends[1]!.id).toBe('slurm')
    expect(data.detectedAt).toBeDefined()
  })

  it('returns empty array when no machines connected', async () => {
    mockMachines.mockReturnValue([])

    const app = createApp()
    const res = await app.request('/api/backends')
    expect(res.status).toBe(200)

    const data = await res.json() as { backends: unknown[] }
    expect(data.backends).toHaveLength(0)
  })

  it('handles machines with no execution strategies', async () => {
    mockMachines.mockReturnValue([{
      machineId: 'machine-1',
      name: 'Bare Machine',
      providers: [],
      load: { activeTasks: 0 },
      // no executionStrategies
    }])

    const app = createApp()
    const res = await app.request('/api/backends')
    expect(res.status).toBe(200)

    const data = await res.json() as { backends: unknown[] }
    expect(data.backends).toHaveLength(0)
  })

  it('includes SSH hosts from machine registry', async () => {
    mockMachines.mockReturnValue([{
      machineId: 'machine-1',
      name: 'My Laptop',
      providers: [],
      load: { activeTasks: 0 },
      executionStrategies: [
        { id: 'direct', name: 'Direct', available: true },
        { id: 'ssh:hpc-login', name: 'hpc-login', available: true, metadata: { alias: 'hpc-login', hostname: 'hpc.edu' } },
        { id: 'ssh:gpu-node', name: 'gpu-node', available: false, metadata: { alias: 'gpu-node', hostname: '10.0.0.5', reachable: false } },
      ],
    }])

    const app = createApp()
    const res = await app.request('/api/backends')
    const data = await res.json() as { backends: Array<{ id: string; name: string; available: boolean }> }

    // 'direct' filtered out, both SSH hosts included
    expect(data.backends).toHaveLength(2)
    expect(data.backends[0]!.id).toBe('ssh:hpc-login')
    expect(data.backends[0]!.available).toBe(true)
    expect(data.backends[1]!.id).toBe('ssh:gpu-node')
    expect(data.backends[1]!.available).toBe(false)
  })
})

describe('GET /api/backends/:id', () => {
  beforeEach(() => {
    mockMachines.mockReset()
  })

  it('returns backend with context string', async () => {
    mockMachines.mockReturnValue([{
      machineId: 'machine-1',
      name: 'My Laptop',
      providers: [],
      load: { activeTasks: 0 },
      executionStrategies: [
        { id: 'slurm', name: 'SLURM', available: true, version: '22.05.8', metadata: { clusterName: 'hpc1', partitions: [{ name: 'gpu', nodes: 10 }] } },
      ],
    }])

    const app = createApp()
    const res = await app.request('/api/backends/slurm')
    expect(res.status).toBe(200)

    const data = await res.json() as { backend: { id: string }; contextString: string }
    expect(data.backend.id).toBe('slurm')
    expect(data.contextString).toContain('HPC cluster')
    expect(data.contextString).toContain('hpc1')
  })

  it('returns 404 for missing backend', async () => {
    mockMachines.mockReturnValue([{
      machineId: 'machine-1',
      name: 'My Laptop',
      providers: [],
      load: { activeTasks: 0 },
      executionStrategies: [
        { id: 'direct', name: 'Direct', available: true },
      ],
    }])

    const app = createApp()
    const res = await app.request('/api/backends/slurm')
    expect(res.status).toBe(404)
  })

  it('returns context string for SSH backend', async () => {
    mockMachines.mockReturnValue([{
      machineId: 'machine-1',
      name: 'My Laptop',
      providers: [],
      load: { activeTasks: 0 },
      executionStrategies: [
        { id: 'ssh:hpc-login', name: 'hpc-login', available: true, metadata: { alias: 'hpc-login', hostname: 'hpc.edu', user: 'admin' } },
      ],
    }])

    const app = createApp()
    const res = await app.request('/api/backends/ssh:hpc-login')
    expect(res.status).toBe(200)

    const data = await res.json() as { contextString: string }
    expect(data.contextString).toContain('SSH host')
    expect(data.contextString).toContain('hpc-login')
    expect(data.contextString).toContain('admin@hpc.edu')
  })

  it('does NOT show unreachable warning for ProxyJump hosts (reachable=null)', async () => {
    mockMachines.mockReturnValue([{
      machineId: 'machine-1',
      name: 'My Laptop',
      providers: [],
      load: { activeTasks: 0 },
      executionStrategies: [
        { id: 'ssh:proxy-host', name: 'proxy-host', available: true, metadata: { alias: 'proxy-host', hostname: 'internal.host', user: 'admin', reachable: null } },
      ],
    }])

    const app = createApp()
    const res = await app.request('/api/backends/ssh:proxy-host')
    expect(res.status).toBe(200)

    const data = await res.json() as { contextString: string }
    expect(data.contextString).toContain('SSH host')
    expect(data.contextString).not.toContain('Unreachable')
  })

  it('shows unreachable warning for hosts with reachable=false', async () => {
    mockMachines.mockReturnValue([{
      machineId: 'machine-1',
      name: 'My Laptop',
      providers: [],
      load: { activeTasks: 0 },
      executionStrategies: [
        { id: 'ssh:down-host', name: 'down-host', available: false, metadata: { alias: 'down-host', hostname: '10.0.0.99', reachable: false } },
      ],
    }])

    const app = createApp()
    const res = await app.request('/api/backends/ssh:down-host')
    expect(res.status).toBe(200)

    const data = await res.json() as { contextString: string }
    expect(data.contextString).toContain('Unreachable at last check')
  })

  it('returns context string for Docker backend', async () => {
    mockMachines.mockReturnValue([{
      machineId: 'machine-1',
      name: 'My Laptop',
      providers: [],
      load: { activeTasks: 0 },
      executionStrategies: [
        { id: 'docker', name: 'Docker', available: true, version: '24.0.0', metadata: { cpus: 8, memoryGb: 16 } },
      ],
    }])

    const app = createApp()
    const res = await app.request('/api/backends/docker')
    expect(res.status).toBe(200)

    const data = await res.json() as { contextString: string }
    expect(data.contextString).toContain('Docker v24.0.0')
    expect(data.contextString).toContain('8 CPUs')
    expect(data.contextString).toContain('16GB')
  })
})

describe('POST /api/backends/detect', () => {
  it('returns current backends (no-op)', async () => {
    mockMachines.mockReturnValue([{
      machineId: 'machine-1',
      name: 'My Laptop',
      providers: [],
      load: { activeTasks: 0 },
      executionStrategies: [
        { id: 'docker', name: 'Docker', available: true, version: '24.0.0' },
      ],
    }])

    const app = createApp()
    const res = await app.request('/api/backends/detect', { method: 'POST' })
    expect(res.status).toBe(200)

    const data = await res.json() as { backends: Array<{ id: string }> }
    expect(data.backends).toHaveLength(1)
    expect(data.backends[0]!.id).toBe('docker')
  })
})

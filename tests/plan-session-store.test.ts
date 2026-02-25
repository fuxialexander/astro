/**
 * Plan Session Store Tests
 *
 * Tests the plan session methods on the execution store:
 * - startPlanSession: creates project, execution entry, dispatches via fetch
 * - cancelPlanSession: aborts controller, marks execution cancelled
 * - steerPlanSession: sends guidance to running plan session
 *
 * Mocks fetch, Zustand external stores, and SSE parsing to isolate
 * the plan session logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock supabase-client (getAccessToken)
vi.mock('@/lib/supabase-client', () => ({
  getAccessToken: vi.fn().mockResolvedValue('test-token'),
  shouldUseSupabase: vi.fn().mockReturnValue(false),
}))

// Mock app-mode
vi.mock('@/lib/app-mode', () => ({
  isLocalMode: vi.fn().mockReturnValue(true),
  isServerMode: vi.fn().mockReturnValue(false),
}))

// Mock api-url
vi.mock('@/lib/api-url', () => ({
  apiUrl: vi.fn((path: string) => `http://localhost:3001${path}`),
}))

// Mock data-client
vi.mock('@/lib/data-client', () => ({
  dataClient: {
    load: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}))

// Mock html-utils
vi.mock('@/lib/html-utils', () => ({
  stripHtml: vi.fn((s: string) => s || ''),
  extractBlobUrls: vi.fn(() => []),
}))

// Mock plan-extraction
vi.mock('@/lib/plan-extraction', () => ({
  extractPlanJsonFromText: vi.fn().mockReturnValue(null),
}))

// Mock @astro/core/dispatch
vi.mock('@astro/core/dispatch', () => ({
  resolveWorkingDirectory: vi.fn().mockReturnValue({ ok: true, dir: '/tmp/test' }),
  buildDependencyOutputs: vi.fn().mockReturnValue([]),
}))

// Mock sse-parser - parseSSEStream resolves immediately by default
const mockParseSSEStream = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/sse-parser', () => ({
  parseSSEStream: (...args: unknown[]) => mockParseSSEStream(...args),
}))

// Mock project store
const mockAddProject = vi.fn()
vi.mock('@/stores/project-store', () => ({
  useProjectStore: {
    getState: () => ({
      addProject: mockAddProject,
      updateProject: vi.fn(),
      projects: [],
    }),
  },
}))

// Mock plan store
vi.mock('@/stores/plan-store', () => ({
  usePlanStore: {
    getState: () => ({
      nodes: [],
      edges: [],
      setProjectPlan: vi.fn(),
      reorganizeProject: vi.fn(),
      updateNode: vi.fn(),
    }),
  },
  isLive: vi.fn().mockReturnValue(false),
}))

// Mock usage store
vi.mock('@/stores/usage-store', () => ({
  useUsageStore: {
    getState: () => ({
      addUsage: vi.fn(),
    }),
  },
}))

// Mock agent store
const mockStartInteractiveSession = vi.fn()
const mockUpdateInteractiveSession = vi.fn()
vi.mock('@/stores/agent-store', () => ({
  useAgentStore: {
    getState: () => ({
      startInteractiveSession: mockStartInteractiveSession,
      updateInteractiveSession: mockUpdateInteractiveSession,
      sessions: new Map(),
    }),
  },
}))

// Mock task-chat-store
vi.mock('@/stores/task-chat-store', () => ({
  useTaskChatStore: {
    getState: () => ({
      addMessage: vi.fn(),
    }),
  },
}))

// Mock crypto.randomUUID at module level (before store import)
const MOCK_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
vi.stubGlobal('crypto', {
  randomUUID: vi.fn().mockReturnValue(MOCK_UUID),
})

// Global fetch mock
const globalFetchMock = vi.fn()
vi.stubGlobal('fetch', globalFetchMock)

// Now import the store under test
import { useExecutionStore } from '@/stores/execution-store'

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockResponse(ok: boolean, body?: unknown): Response {
  const readable = new ReadableStream({
    start(controller) {
      controller.close()
    },
  })
  return {
    ok,
    status: ok ? 200 : 500,
    body: readable,
    json: vi.fn().mockResolvedValue(body || {}),
    headers: new Headers(),
  } as unknown as Response
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Plan Session Store', () => {
  beforeEach(() => {
    // Reset store state
    useExecutionStore.setState({ executions: new Map() })

    // Reset mocks (clear call history, keep implementations)
    mockAddProject.mockClear()
    mockStartInteractiveSession.mockClear()
    mockUpdateInteractiveSession.mockClear()
    mockParseSSEStream.mockClear()
    mockParseSSEStream.mockResolvedValue(undefined)
    globalFetchMock.mockClear()
  })

  // ======================================================================
  // startPlanSession
  // ======================================================================
  describe('startPlanSession', () => {
    it('creates execution entry with nodeId pattern plan-{projectId}', async () => {
      globalFetchMock.mockResolvedValue(createMockResponse(true))

      const result = await useExecutionStore.getState().startPlanSession(
        'Build a web app',
        'My Project',
      )

      expect(result.projectId).toBe(MOCK_UUID)
      expect(result.nodeId).toBe(`plan-${MOCK_UUID}`)

      const execution = useExecutionStore.getState().executions.get(`plan-${MOCK_UUID}`)
      expect(execution).toBeDefined()
      expect(execution!.nodeId).toBe(`plan-${MOCK_UUID}`)
      expect(execution!.projectId).toBe(MOCK_UUID)
    })

    it('creates a project via project store', async () => {
      globalFetchMock.mockResolvedValue(createMockResponse(true))

      await useExecutionStore.getState().startPlanSession(
        'Build a web app',
        'My Project',
      )

      expect(mockAddProject).toHaveBeenCalledTimes(1)
      const projectArg = mockAddProject.mock.calls[0][0]
      expect(projectArg.id).toBe(MOCK_UUID)
      expect(projectArg.name).toBe('My Project')
      expect(projectArg.description).toBe('Build a web app')
    })

    it('uses "New Project" as default name when projectName is empty', async () => {
      globalFetchMock.mockResolvedValue(createMockResponse(true))

      await useExecutionStore.getState().startPlanSession(
        'Some description',
        '',
      )

      const projectArg = mockAddProject.mock.calls[0][0]
      expect(projectArg.name).toBe('New Project')
    })

    it('passes options to project and fetch', async () => {
      globalFetchMock.mockResolvedValue(createMockResponse(true))

      await useExecutionStore.getState().startPlanSession(
        'Research analysis',
        'Science Project',
        {
          visionDoc: 'Vision content here',
          workingDirectory: '/home/user/project',
          targetMachineId: 'machine-1',
          model: 'claude-opus-4-6',
          repository: 'https://github.com/user/repo',
        },
      )

      // Check project was created with options
      const projectArg = mockAddProject.mock.calls[0][0]
      expect(projectArg.visionDoc).toBe('Vision content here')
      expect(projectArg.workingDirectory).toBe('/home/user/project')
      expect(projectArg.repository).toBe('https://github.com/user/repo')
      expect(projectArg.defaultMachineId).toBe('machine-1')

      // SSE dispatch is fire-and-forget — wait for the async fetch chain
      await vi.waitFor(() => { expect(globalFetchMock).toHaveBeenCalled() })
      const fetchBody = JSON.parse(globalFetchMock.mock.calls[0][1].body)
      expect(fetchBody.visionDoc).toBe('Vision content here')
      expect(fetchBody.targetMachineId).toBe('machine-1')
      expect(fetchBody.model).toBe('claude-opus-4-6')
      expect(fetchBody.workingDirectory).toBe('/home/user/project')
      expect(fetchBody.isInteractivePlan).toBe(true)
      expect(fetchBody.maxTurns).toBe(200)
    })

    it('dispatches POST to /api/dispatch/task with auth headers', async () => {
      globalFetchMock.mockResolvedValue(createMockResponse(true))

      await useExecutionStore.getState().startPlanSession(
        'Build something',
        'Test Project',
      )

      // SSE dispatch is fire-and-forget — wait for the async fetch chain
      await vi.waitFor(() => { expect(globalFetchMock).toHaveBeenCalledTimes(1) })
      expect(globalFetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/dispatch/task')
      expect(globalFetchMock.mock.calls[0][1].method).toBe('POST')
      expect(globalFetchMock.mock.calls[0][1].headers['Content-Type']).toBe('application/json')
      expect(globalFetchMock.mock.calls[0][1].headers['Authorization']).toBe('Bearer test-token')
    })

    it('sets execution to failure on non-ok response', async () => {
      globalFetchMock.mockResolvedValue(
        createMockResponse(false, { error: 'Internal error' }),
      )

      await useExecutionStore.getState().startPlanSession(
        'Will fail',
        'Fail Project',
      )

      // SSE dispatch is fire-and-forget — wait for async error handling
      await vi.waitFor(() => {
        const execution = useExecutionStore.getState().executions.get(`plan-${MOCK_UUID}`)
        expect(execution).toBeDefined()
        expect(execution!.status).toBe('failure')
      })
      const execution = useExecutionStore.getState().executions.get(`plan-${MOCK_UUID}`)!
      expect(execution.error).toContain('500')
      expect(execution.completedAt).toBeInstanceOf(Date)
    })

    it('sets execution status to cancelled on abort', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError')
      globalFetchMock.mockRejectedValue(abortError)

      await useExecutionStore.getState().startPlanSession(
        'Will be aborted',
        'Abort Project',
      )

      // SSE dispatch is fire-and-forget — wait for async abort handling
      await vi.waitFor(() => {
        const execution = useExecutionStore.getState().executions.get(`plan-${MOCK_UUID}`)
        expect(execution).toBeDefined()
        expect(execution!.status).toBe('cancelled')
      })
      const execution = useExecutionStore.getState().executions.get(`plan-${MOCK_UUID}`)!
      expect(execution.completedAt).toBeInstanceOf(Date)
    })

    it('initial execution entry has correct default fields', async () => {
      globalFetchMock.mockResolvedValue(createMockResponse(true))

      await useExecutionStore.getState().startPlanSession(
        'Default fields test',
        'Defaults',
      )

      const execution = useExecutionStore.getState().executions.get(`plan-${MOCK_UUID}`)
      expect(execution).toBeDefined()
      expect(execution!.executionId).toBe('')
      expect(execution!.streamText).toBe('')
      expect(execution!.toolTraces).toEqual([])
      expect(execution!.fileChanges).toEqual([])
      expect(execution!.activityEvents).toEqual([])
      expect(execution!.startedAt).toBeInstanceOf(Date)
    })

    it('includes title with project name in fetch body', async () => {
      globalFetchMock.mockResolvedValue(createMockResponse(true))

      await useExecutionStore.getState().startPlanSession(
        'Build a complex web application with authentication',
        'Auth App',
      )

      // SSE dispatch is fire-and-forget — wait for async fetch
      await vi.waitFor(() => { expect(globalFetchMock).toHaveBeenCalled() })
      const fetchBody = JSON.parse(globalFetchMock.mock.calls[0][1].body)
      expect(fetchBody.title).toBe('Interactive planning: Auth App')
      expect(fetchBody.description).toBe('Build a complex web application with authentication')
      expect(fetchBody.verification).toBe('human')
      expect(fetchBody.dependencies).toEqual([])
    })

    it('truncates description in title when no project name given', async () => {
      globalFetchMock.mockResolvedValue(createMockResponse(true))
      const longDesc = 'A'.repeat(100)

      await useExecutionStore.getState().startPlanSession(longDesc, '')

      // SSE dispatch is fire-and-forget — wait for async fetch
      await vi.waitFor(() => { expect(globalFetchMock).toHaveBeenCalled() })
      const fetchBody = JSON.parse(globalFetchMock.mock.calls[0][1].body)
      expect(fetchBody.title).toBe(`Interactive planning: ${'A'.repeat(50)}`)
    })
  })

  // ======================================================================
  // cancelPlanSession
  // ======================================================================
  describe('cancelPlanSession', () => {
    it('marks execution as cancelled', async () => {
      const nodeId = `plan-test-project-id`
      const executions = new Map()
      executions.set(nodeId, {
        nodeId,
        projectId: 'test-project-id',
        executionId: 'exec-123',
        status: 'running' as const,
        streamText: 'some output',
        toolTraces: [],
        fileChanges: [],
        activityEvents: [],
        startedAt: new Date(),
      })
      useExecutionStore.setState({ executions })

      await useExecutionStore.getState().cancelPlanSession('test-project-id')

      const execution = useExecutionStore.getState().executions.get(nodeId)
      expect(execution).toBeDefined()
      expect(execution!.status).toBe('cancelled')
      expect(execution!.completedAt).toBeInstanceOf(Date)
    })

    it('handles cancel when no execution exists (graceful no-op)', async () => {
      await expect(
        useExecutionStore.getState().cancelPlanSession('nonexistent-project')
      ).resolves.not.toThrow()
    })
  })

  // ======================================================================
  // steerPlanSession
  // ======================================================================
  describe('steerPlanSession', () => {
    it('calls the correct API endpoint with right payload', async () => {
      const nodeId = `plan-steer-project`
      const executions = new Map()
      executions.set(nodeId, {
        nodeId,
        projectId: 'steer-project',
        executionId: 'exec-789',
        machineId: 'machine-abc',
        status: 'running' as const,
        streamText: '',
        toolTraces: [],
        fileChanges: [],
        activityEvents: [],
        startedAt: new Date(),
      })
      useExecutionStore.setState({ executions })

      globalFetchMock.mockResolvedValue(
        createMockResponse(true, { success: true }),
      )

      const result = await useExecutionStore.getState().steerPlanSession(
        'steer-project',
        'Focus on the backend first',
      )

      expect(result).toBe(true)
      expect(globalFetchMock).toHaveBeenCalledTimes(1)
      expect(globalFetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/dispatch/steer')

      const body = JSON.parse(globalFetchMock.mock.calls[0][1].body)
      expect(body.taskId).toBe('exec-789')
      expect(body.machineId).toBe('machine-abc')
      expect(body.message).toBe('Focus on the backend first')
      expect(body.action).toBe('guidance')
    })

    it('returns false when no executionId exists', async () => {
      const nodeId = `plan-no-exec`
      const executions = new Map()
      executions.set(nodeId, {
        nodeId,
        projectId: 'no-exec',
        executionId: '',
        machineId: 'machine-1',
        status: 'running' as const,
        streamText: '',
        toolTraces: [],
        fileChanges: [],
        activityEvents: [],
        startedAt: new Date(),
      })
      useExecutionStore.setState({ executions })

      const result = await useExecutionStore.getState().steerPlanSession(
        'no-exec',
        'some guidance',
      )

      expect(result).toBe(false)
    })

    it('returns false when no machineId exists', async () => {
      const nodeId = `plan-no-machine`
      const executions = new Map()
      executions.set(nodeId, {
        nodeId,
        projectId: 'no-machine',
        executionId: 'exec-123',
        status: 'running' as const,
        streamText: '',
        toolTraces: [],
        fileChanges: [],
        activityEvents: [],
        startedAt: new Date(),
      })
      useExecutionStore.setState({ executions })

      const result = await useExecutionStore.getState().steerPlanSession(
        'no-machine',
        'some guidance',
      )

      expect(result).toBe(false)
    })

    it('returns false when execution does not exist at all', async () => {
      const result = await useExecutionStore.getState().steerPlanSession(
        'nonexistent',
        'guidance',
      )

      expect(result).toBe(false)
    })

    it('returns false on API error', async () => {
      const nodeId = `plan-api-error`
      const executions = new Map()
      executions.set(nodeId, {
        nodeId,
        projectId: 'api-error',
        executionId: 'exec-err',
        machineId: 'machine-err',
        status: 'running' as const,
        streamText: '',
        toolTraces: [],
        fileChanges: [],
        activityEvents: [],
        startedAt: new Date(),
      })
      useExecutionStore.setState({ executions })

      globalFetchMock.mockResolvedValue(createMockResponse(false))

      const result = await useExecutionStore.getState().steerPlanSession(
        'api-error',
        'guidance',
      )

      expect(result).toBe(false)
    })

    it('returns false on network error', async () => {
      const nodeId = `plan-network-err`
      const executions = new Map()
      executions.set(nodeId, {
        nodeId,
        projectId: 'network-err',
        executionId: 'exec-net',
        machineId: 'machine-net',
        status: 'running' as const,
        streamText: '',
        toolTraces: [],
        fileChanges: [],
        activityEvents: [],
        startedAt: new Date(),
      })
      useExecutionStore.setState({ executions })

      globalFetchMock.mockRejectedValue(new Error('Network error'))

      const result = await useExecutionStore.getState().steerPlanSession(
        'network-err',
        'guidance',
      )

      expect(result).toBe(false)
    })

    it('sends auth headers in steer request', async () => {
      const nodeId = `plan-auth-check`
      const executions = new Map()
      executions.set(nodeId, {
        nodeId,
        projectId: 'auth-check',
        executionId: 'exec-auth',
        machineId: 'machine-auth',
        status: 'running' as const,
        streamText: '',
        toolTraces: [],
        fileChanges: [],
        activityEvents: [],
        startedAt: new Date(),
      })
      useExecutionStore.setState({ executions })

      globalFetchMock.mockResolvedValue(
        createMockResponse(true, { success: true }),
      )

      await useExecutionStore.getState().steerPlanSession(
        'auth-check',
        'guidance message',
      )

      const headers = globalFetchMock.mock.calls[0][1].headers
      expect(headers['Authorization']).toBe('Bearer test-token')
      expect(headers['Content-Type']).toBe('application/json')
    })
  })
})

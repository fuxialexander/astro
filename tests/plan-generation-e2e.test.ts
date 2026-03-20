/**
 * Plan Generation End-to-End Tests
 *
 * Tests the Interactive Plan Generation feature at two levels:
 *
 * 1. Store-level tests (always run) — verify Zustand store logic:
 *    - startPlanGeneration creates execution entry synchronously
 *    - cancelPlanGeneration removes abort controller and marks cancelled
 *    - Sidebar store includes "plan" item in defaults
 *
 * 2. API integration tests (requires running server) — verify HTTP contract:
 *    - POST /api/dispatch/task accepts plan payload
 *    - POST /api/dispatch/steer endpoint exists
 *    - Health check returns valid status
 *
 * Run with: npx vitest run tests/plan-generation-e2e.test.ts
 * For API tests, start server first: npm run dev:local
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tryAutoExecuteCompletedPlanProject } from '@/lib/plan-auto-execute'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ============================================================================
// Section 1: Store Tests (always run, no server needed)
// ============================================================================

// Mock supabase-client
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
      saveExecution: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      getProfile: vi.fn().mockResolvedValue(null),
      updateProfile: vi.fn().mockResolvedValue(undefined),
      getExecutions: vi.fn().mockResolvedValue({}),
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

  // Mock sse-parser
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

// Stable UUID for predictable assertions
const MOCK_UUID = 'e2e-test-1111-2222-3333-444444444444'

// Import stores — vi.mock calls are hoisted above imports by vitest
import { useExecutionStore } from '@/stores/execution-store'
import { useSidebarStore, sidebarDefaults } from '@/stores/sidebar-store'

describe('Plan Generation - Store', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue(MOCK_UUID),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream({ start(c) { c.close() } }),
      json: vi.fn().mockResolvedValue({}),
      headers: new Headers(),
    }))
    useExecutionStore.setState({ executions: new Map() })
    vi.clearAllMocks()
    mockParseSSEStream.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── startPlanGeneration ────────────────────────────────────────────────────

  it('startPlanGeneration creates execution entry synchronously before SSE completes', async () => {
    // Simulate slow SSE stream that never resolves during the test
    mockParseSSEStream.mockReturnValue(new Promise(() => {}))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream({ start(c) { c.close() } }),
      json: vi.fn().mockResolvedValue({}),
      headers: new Headers(),
    }))

    const result = await useExecutionStore.getState().startPlanGeneration(
      'Build a full-stack todo app',
      'Todo App',
    )

    // The function returns immediately with projectId + nodeId
    expect(result.projectId).toBe(MOCK_UUID)
    expect(result.nodeId).toBe(`plan-${MOCK_UUID}`)

    // Execution entry exists in the store right away
    const execution = useExecutionStore.getState().executions.get(`plan-${MOCK_UUID}`)
    expect(execution).toBeDefined()
    expect(execution.nodeId).toBe(`plan-${MOCK_UUID}`)
    expect(execution.projectId).toBe(MOCK_UUID)
    expect(execution.status).toBe('pending')
    expect(execution.streamText).toBe('')
    expect(execution.toolTraces).toEqual([])
    expect(execution.fileChanges).toEqual([])
    expect(execution.startedAt).toBeInstanceOf(Date)
  })

  it('startPlanGeneration dispatches POST to /api/dispatch/task with isInteractivePlan flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream({ start(c) { c.close() } }),
      json: vi.fn().mockResolvedValue({}),
      headers: new Headers(),
    })
    vi.stubGlobal('fetch', fetchMock)

    await useExecutionStore.getState().startPlanGeneration(
      'Implement auth system',
      'Auth Project',
      { workingDirectory: '/home/user/project', model: 'claude-sonnet-4-6' },
    )

    // Wait for the fire-and-forget fetch to be called
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/dispatch/task')
    expect(options.method).toBe('POST')

    const body = JSON.parse(options.body)
    expect(body.isInteractivePlan).toBe(true)
    expect(body.maxTurns).toBeUndefined()
    expect(body.verification).toBe('human')
    expect(body.workingDirectory).toBe('/home/user/project')
    expect(body.model).toBe('claude-sonnet-4-6')
    expect(body.nodeId).toBe(`plan-${MOCK_UUID}`)
    expect(body.projectId).toBe(MOCK_UUID)
  })

  it('YOLO auto-execute survives plan-result ordering race', () => {
    const executeAllProject = vi.fn()
      // First attempt: plan completion arrives before plan nodes are loaded
      .mockReturnValueOnce(false)
      // Second attempt: plan_result-triggered reload makes nodes available
      .mockReturnValueOnce(true)
    const clearAutoExecute = vi.fn()
    const options = { preferredProvider: 'codex', targetMachineId: 'machine-1' }

    const firstAttempt = tryAutoExecuteCompletedPlanProject('proj-race', {
      hasAutoExecute: true,
      planExecutionStatus: 'success',
      options,
      executeAllProject,
      clearAutoExecute,
    })

    expect(firstAttempt).toBe(false)
    expect(clearAutoExecute).not.toHaveBeenCalled()

    const secondAttempt = tryAutoExecuteCompletedPlanProject('proj-race', {
      hasAutoExecute: true,
      planExecutionStatus: 'success',
      options,
      executeAllProject,
      clearAutoExecute,
    })

    expect(secondAttempt).toBe(true)
    expect(executeAllProject).toHaveBeenNthCalledWith(1, 'proj-race', options)
    expect(executeAllProject).toHaveBeenNthCalledWith(2, 'proj-race', options)
    expect(clearAutoExecute).toHaveBeenCalledTimes(1)
    expect(clearAutoExecute).toHaveBeenCalledWith('proj-race')
  })

  it('dispatch.ts auto-dispatches ready tasks when interactive planning completes in YOLO mode', () => {
    const source = readFileSync(
      join(__dirname, '../server/routes/dispatch.ts'),
      'utf-8',
    )

    expect(source).toContain('async function autoDispatchReadyPlanTasks')
    expect(source).toContain("isInteractivePlan && isSuccess && yoloEnabled")
    expect(source).toContain('serverSideDispatch(readyTaskId, projectId)')
  })

  it('dispatch.ts uses shared isYoloMode for completion status', () => {
    const source = readFileSync(
      join(__dirname, '../server/routes/dispatch.ts'),
      'utf-8',
    )

    expect(source).toContain("import { isYoloMode } from '../lib/yolo-mode.js'")
    expect(source).toContain("await isYoloMode(user?.id, nodeId).catch(() => false)")
  })

  // ── cancelPlanGeneration ───────────────────────────────────────────────────

  it('cancelPlanGeneration marks execution as cancelled and sets completedAt', async () => {
    // Set up an active execution
    const nodeId = `plan-cancel-test-id`
    const executions = new Map()
    executions.set(nodeId, {
      nodeId,
      projectId: 'cancel-test-id',
      executionId: 'exec-cancel-1',
      status: 'running',
      streamText: 'some output so far',
      toolTraces: [],
      fileChanges: [],
      activityEvents: [],
      startedAt: new Date(),
    })
    useExecutionStore.setState({ executions })

    await useExecutionStore.getState().cancelPlanGeneration('cancel-test-id')

    const execution = useExecutionStore.getState().executions.get(nodeId)
    expect(execution).toBeDefined()
    expect(execution.status).toBe('cancelled')
    expect(execution.completedAt).toBeInstanceOf(Date)
  })

  it('cancelPlanGeneration marks execution as cancelled', async () => {
    const nodeId = `plan-cancel-agent`
    const executions = new Map()
    executions.set(nodeId, {
      nodeId,
      projectId: 'cancel-agent',
      executionId: 'exec-agent-1',
      status: 'running',
      streamText: '',
      toolTraces: [],
      fileChanges: [],
      activityEvents: [],
      startedAt: new Date(),
    })
    useExecutionStore.setState({ executions })

    await useExecutionStore.getState().cancelPlanGeneration('cancel-agent')

    const execution = useExecutionStore.getState().executions.get(nodeId)
    expect(execution).toBeDefined()
    expect(execution!.status).toBe('cancelled')
    expect(execution!.completedAt).toBeInstanceOf(Date)
  })

  it('cancelPlanGeneration is a graceful no-op when no execution exists', async () => {
    await expect(
      useExecutionStore.getState().cancelPlanGeneration('nonexistent-project')
    ).resolves.not.toThrow()
  })

  // ── Sidebar Store ───────────────────────────────────────────────────────

  it('sidebar store includes "plan" item in defaults', () => {
    const planItem = sidebarDefaults.find(
      (item: { id: string }) => item.id === 'plan',
    )
    expect(planItem).toBeDefined()
    expect(planItem.to).toBe('/plan')
    expect(planItem.visible).toBe(true)
    expect(planItem.label).toBe('Plan')
  })

  it('sidebar store initializes with plan item visible', () => {
    const state = useSidebarStore.getState()
    const planItem = state.items.find(
      (item: { id: string }) => item.id === 'plan',
    )
    expect(planItem).toBeDefined()
    expect(planItem.visible).toBe(true)
  })
})

// ============================================================================
// Section 2: API Integration Tests (requires running server)
// ============================================================================

const API_BASE = 'http://localhost:3001'

let serverAvailable = false
try {
  const response = await fetch(`${API_BASE}/api/health`)
  serverAvailable = response.ok
} catch {
  serverAvailable = false
}

describe.skipIf(!serverAvailable)('Plan Generation - API (requires server)', () => {
  it('health check returns valid status', async () => {
    const response = await fetch(`${API_BASE}/api/health`)
    expect(response.ok).toBe(true)

    const data = await response.json()
    expect(data.status).toBe('ok')
    expect(data.authenticated).toBe(true)
    expect(data.relay).toBeDefined()
  })

  it('POST /api/dispatch/task accepts plan payload and returns response', async () => {
    // In local mode (no auth), dispatch requires a working directory.
    // Without a connected machine, the server returns a 400 "no available machine".
    // This validates the endpoint exists and processes the request body correctly.
    const payload = {
      nodeId: `plan-e2e-test-${Date.now()}`,
      projectId: `proj-e2e-test-${Date.now()}`,
      title: 'E2E test: interactive planning session',
      description: 'Test plan session dispatch endpoint',
      dependencies: [],
      verification: 'human',
      workingDirectory: '/tmp/e2e-test',
      isInteractivePlan: true,
    }

    const response = await fetch(`${API_BASE}/api/dispatch/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    // Without a connected agent runner, the server will return 400 with
    // "No available machine" error. This proves the endpoint processes
    // the payload and reaches the machine-selection step.
    if (!response.ok) {
      const errorBody = await response.json()
      expect(errorBody.error).toContain('No available machine')
    } else {
      // If an agent runner IS connected, we get an SSE stream
      expect(response.headers.get('content-type')).toContain('text/event-stream')
    }
  })

  it('POST /api/dispatch/task rejects missing required fields', async () => {
    const response = await fetch(`${API_BASE}/api/dispatch/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Missing nodeId, projectId, title, description
      }),
    })

    expect(response.ok).toBe(false)
    const data = await response.json()
    expect(data.error).toBeDefined()
  })

  it('POST /api/dispatch/task rejects missing workingDirectory', async () => {
    const response = await fetch(`${API_BASE}/api/dispatch/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: 'test-node',
        projectId: 'test-project',
        title: 'Test task',
        description: 'Test description',
        // Missing workingDirectory
      }),
    })

    expect(response.ok).toBe(false)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('working directory')
  })

  it('POST /api/dispatch/steer endpoint exists and validates input', async () => {
    // Without valid taskId/machineId, it should return 400
    const response = await fetch(`${API_BASE}/api/dispatch/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Missing required fields
      }),
    })

    expect(response.ok).toBe(false)
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data.error).toBeDefined()
    expect(data.success).toBe(false)
  })

  it('POST /api/dispatch/cancel endpoint exists and validates input', async () => {
    const response = await fetch(`${API_BASE}/api/dispatch/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Missing nodeId and executionId
      }),
    })

    expect(response.ok).toBe(false)
    expect(response.status).toBe(400)
  })

  it('GET /api/dispatch/status returns valid JSON response', async () => {
    const response = await fetch(`${API_BASE}/api/dispatch/status`)
    expect(response.ok).toBe(true)

    const data = await response.json()
    // Response is valid JSON with some dispatch status info
    expect(data).toBeDefined()
    expect(typeof data).toBe('object')
  })

  it('POST /api/dispatch/task supports dryRun validation', async () => {
    const payload = {
      nodeId: `plan-dryrun-${Date.now()}`,
      projectId: `proj-dryrun-${Date.now()}`,
      title: 'Dry run test',
      description: 'Validate dispatch without executing',
      workingDirectory: '/tmp/dryrun',
      dryRun: true,
    }

    const response = await fetch(`${API_BASE}/api/dispatch/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(response.ok).toBe(true)
    const data = await response.json()
    expect(data.dryRun).toBe(true)
    expect(data.success).toBe(true)
    expect(data.validationIssues).toEqual([])
  })
})

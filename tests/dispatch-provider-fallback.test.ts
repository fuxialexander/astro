/**
 * Tests that all dispatch paths in execution-store read defaultProvider
 * from settings-store as a fallback when options.preferredProvider is not set.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    delete: vi.fn().mockResolvedValue(undefined),
    getProfile: vi.fn().mockResolvedValue(null),
    updateProfile: vi.fn().mockResolvedValue(undefined),
    getExecutions: vi.fn().mockResolvedValue({}),
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue(undefined),
    updateNode: vi.fn().mockResolvedValue(undefined),
    saveExecution: vi.fn().mockResolvedValue(undefined),
    deleteExecution: vi.fn().mockResolvedValue(undefined),
  },
}))

// Mock html-utils
vi.mock('@/lib/html-utils', () => ({
  stripHtml: vi.fn((s: string) => s || ''),
  extractBlobUrls: vi.fn(() => []),
}))

// Mock dispatch-signing
vi.mock('@/lib/dispatch-signing', () => ({
  getSigningPrivateKey: vi.fn().mockResolvedValue(null),
  signDispatchIntent: vi.fn().mockResolvedValue('test-sig'),
  generateNonce: vi.fn().mockReturnValue('test-nonce'),
}))

// Mock plan-extraction
vi.mock('@/lib/plan-extraction', () => ({
  applyPlanFromText: vi.fn(),
  planNodeIdToProjectId: vi.fn(),
  clearPlanFingerprint: vi.fn(),
}))

// Mock project-source
vi.mock('@/lib/project-source', () => ({
  deriveDeliveryMode: vi.fn().mockReturnValue('branch'),
}))

// Intercept fetch
const fetchSpy = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ success: true }),
  body: null,
  headers: new Headers(),
})
vi.stubGlobal('fetch', fetchSpy)

// Import after mocks
import { useSettingsStore } from '@/stores/settings-store'
import { useExecutionStore } from '@/stores/execution-store'
import { usePlanStore } from '@/stores/plan-store'
import { useProjectStore } from '@/stores/project-store'

describe('dispatch provider fallback', () => {
  beforeEach(() => {
    fetchSpy.mockClear()

    // Reset stores
    useSettingsStore.setState({
      defaultProvider: '',
      modelTier: 'medium',
      model: 'sonnet',
      customModelMap: {},
    })
  })

  describe('startExecution reads defaultProvider from settings', () => {
    it('sends empty preferredProvider when settings is "Auto" (empty)', async () => {
      // Set up a node and project
      usePlanStore.setState({
        nodes: [{
          id: 'node-1',
          projectId: 'proj-1',
          title: 'Test Task',
          description: 'Test',
          status: 'planned',
          dependencies: [],
          type: 'task',
        } as any],
        edges: [],
      })
      useProjectStore.setState({
        projects: [{
          id: 'proj-1',
          name: 'Test Project',
          defaultMachineId: 'machine-1',
          workingDirectory: '/tmp/test',
        } as any],
      })

      // defaultProvider is empty = "Auto"
      useSettingsStore.setState({ defaultProvider: '' })

      await useExecutionStore.getState().startExecution('node-1', 'proj-1')

      // The fetch should have been called
      expect(fetchSpy).toHaveBeenCalled()

      // Find the dispatch/task call
      const dispatchCall = fetchSpy.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/api/dispatch/task')
      )
      expect(dispatchCall).toBeDefined()

      const body = JSON.parse(dispatchCall![1].body)
      // When "Auto" (empty string), effectiveProvider should be undefined
      expect(body.preferredProvider).toBeUndefined()
    })

    it('sends "codex" when settings defaultProvider is "codex"', async () => {
      usePlanStore.setState({
        nodes: [{
          id: 'node-2',
          projectId: 'proj-2',
          title: 'Codex Task',
          description: 'Test codex',
          status: 'planned',
          dependencies: [],
          type: 'task',
        } as any],
        edges: [],
      })
      useProjectStore.setState({
        projects: [{
          id: 'proj-2',
          name: 'Test Project 2',
          defaultMachineId: 'machine-1',
          workingDirectory: '/tmp/test2',
        } as any],
      })

      // Set default provider to codex
      useSettingsStore.setState({ defaultProvider: 'codex' })

      await useExecutionStore.getState().startExecution('node-2', 'proj-2')

      const dispatchCall = fetchSpy.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/api/dispatch/task')
      )
      expect(dispatchCall).toBeDefined()

      const body = JSON.parse(dispatchCall![1].body)
      expect(body.preferredProvider).toBe('codex')
    })

    it('sends correct model for the selected provider', async () => {
      usePlanStore.setState({
        nodes: [{
          id: 'node-3',
          projectId: 'proj-3',
          title: 'Model Task',
          description: 'Test model',
          status: 'planned',
          dependencies: [],
          type: 'task',
        } as any],
        edges: [],
      })
      useProjectStore.setState({
        projects: [{
          id: 'proj-3',
          name: 'Test Project 3',
          defaultMachineId: 'machine-1',
          workingDirectory: '/tmp/test3',
        } as any],
      })

      // Set provider to codex, tier to medium → should resolve to "gpt-5.3-codex"
      useSettingsStore.setState({
        defaultProvider: 'codex',
        modelTier: 'medium',
      })

      await useExecutionStore.getState().startExecution('node-3', 'proj-3')

      const dispatchCall = fetchSpy.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/api/dispatch/task')
      )
      expect(dispatchCall).toBeDefined()

      const body = JSON.parse(dispatchCall![1].body)
      expect(body.preferredProvider).toBe('codex')
      expect(body.model).toBe('gpt-5.3-codex')
    })

    it('sends claude-sdk model alias when provider is claude-sdk', async () => {
      usePlanStore.setState({
        nodes: [{
          id: 'node-4',
          projectId: 'proj-4',
          title: 'Claude Task',
          description: 'Test claude',
          status: 'planned',
          dependencies: [],
          type: 'task',
        } as any],
        edges: [],
      })
      useProjectStore.setState({
        projects: [{
          id: 'proj-4',
          name: 'Test Project 4',
          defaultMachineId: 'machine-1',
          workingDirectory: '/tmp/test4',
        } as any],
      })

      // Set provider to claude-sdk, tier to large → should resolve to "opus"
      useSettingsStore.setState({
        defaultProvider: 'claude-sdk',
        modelTier: 'large',
      })

      await useExecutionStore.getState().startExecution('node-4', 'proj-4')

      const dispatchCall = fetchSpy.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/api/dispatch/task')
      )
      expect(dispatchCall).toBeDefined()

      const body = JSON.parse(dispatchCall![1].body)
      expect(body.preferredProvider).toBe('claude-sdk')
      expect(body.model).toBe('opus')
    })

    it('explicit options.preferredProvider overrides settings', async () => {
      usePlanStore.setState({
        nodes: [{
          id: 'node-5',
          projectId: 'proj-5',
          title: 'Override Task',
          description: 'Test override',
          status: 'planned',
          dependencies: [],
          type: 'task',
        } as any],
        edges: [],
      })
      useProjectStore.setState({
        projects: [{
          id: 'proj-5',
          name: 'Test Project 5',
          defaultMachineId: 'machine-1',
          workingDirectory: '/tmp/test5',
        } as any],
      })

      // Settings say codex, but explicit option says claude-sdk
      useSettingsStore.setState({ defaultProvider: 'codex' })

      await useExecutionStore.getState().startExecution('node-5', 'proj-5', {
        preferredProvider: 'claude-sdk',
      })

      const dispatchCall = fetchSpy.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/api/dispatch/task')
      )
      expect(dispatchCall).toBeDefined()

      const body = JSON.parse(dispatchCall![1].body)
      expect(body.preferredProvider).toBe('claude-sdk')
    })
  })
})

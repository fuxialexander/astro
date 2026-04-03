/**
 * Unit tests for the transport-agnostic command layer.
 *
 * Uses a mock CommandClient to test business logic without HTTP.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getProjectStats,
  resolveProject,
} from '../packages/core/src/commands/projects.js'
import {
  buildPlanTree,
  renderTreeLines,
  getPlanTree,
  listPlanNodes,
  validateNodeIds,
} from '../packages/core/src/commands/plan.js'
import {
  listTasks,
  getTask,
  cancelTask,
  steerTask,
  updateTaskStatus,
} from '../packages/core/src/commands/tasks.js'
import {
  listMachines,
  getMachine,
  removeMachine,
  listProviders,
  getRelayStatus,
  listClusters,
  resolveMachine,
} from '../packages/core/src/commands/env.js'
import {
  searchAll,
  listActivities,
} from '../packages/core/src/commands/search.js'
import type { CommandClient } from '../packages/core/src/commands/types.js'

// ── Mock data ─────────────────────────────────────────────────────────

const mockProject = {
  id: 'proj-1234-5678',
  name: 'Test Project',
  description: 'A test project',
  visionDoc: 'Build something great',
  status: 'active',
  workingDirectory: '/tmp/test',
  repository: null,
  deliveryMode: null,
  projectType: null,
  health: null,
  progress: 50,
  startDate: null,
  targetDate: null,
  lead: null,
  defaultEnvironment: null,
  defaultMachineId: null,
  labels: [],
  color: '#000',
  icon: '🚀',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-06-01T00:00:00Z',
}

const mockNodes = [
  {
    id: 'node-1',
    projectId: 'proj-1234-5678',
    type: 'task',
    title: 'First task',
    description: 'Do the first thing',
    status: 'completed',
    parentId: null,
    dependencies: [],
    position: { x: 0, y: 0 },
    startDate: null,
    endDate: null,
    dueDate: null,
    priority: 'high',
    estimate: 'M',
    executionId: 'exec-1',
    executionOutput: 'Done',
    executionError: null,
    executionStartedAt: '2024-01-01T00:00:00Z',
    executionCompletedAt: '2024-01-01T01:00:00Z',
    branchName: null,
    prUrl: null,
    prNumber: null,
    mergeQueueStatus: null,
    autoPr: null,
    deletedAt: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-06-01T00:00:00Z',
  },
  {
    id: 'node-2',
    projectId: 'proj-1234-5678',
    type: 'task',
    title: 'Second task',
    description: 'Do the second thing',
    status: 'planned',
    parentId: null,
    dependencies: ['node-1'],
    position: { x: 100, y: 0 },
    startDate: null,
    endDate: null,
    dueDate: null,
    priority: 'medium',
    estimate: 'S',
    executionId: null,
    executionOutput: null,
    executionError: null,
    executionStartedAt: null,
    executionCompletedAt: null,
    branchName: null,
    prUrl: null,
    prNumber: null,
    mergeQueueStatus: null,
    autoPr: null,
    deletedAt: null,
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-06-02T00:00:00Z',
  },
]

const mockEdges = [
  { id: 'edge-1', source: 'node-1', target: 'node-2', type: 'dependency' },
]

const mockMachine = {
  id: 'machine-1234-5678',
  name: 'My Machine',
  hostname: 'localhost',
  platform: 'linux',
  environmentType: 'local',
  providers: ['claude'],
  providerConfigs: [{ provider: 'claude', enabled: true, defaultModel: 'sonnet' }],
  isConnected: true,
  isRevoked: false,
  workspaceId: null,
  metadata: null,
  registeredAt: '2024-01-01T00:00:00Z',
  lastSeenAt: '2024-06-01T00:00:00Z',
}

function createMockClient(overrides?: Partial<CommandClient>): CommandClient {
  return {
    listProjects: vi.fn().mockResolvedValue([mockProject]),
    getProject: vi.fn().mockResolvedValue(mockProject),
    createProject: vi.fn().mockResolvedValue(mockProject),
    updateProject: vi.fn().mockResolvedValue({ ...mockProject, name: 'Updated' }),
    deleteProject: vi.fn().mockResolvedValue({ ok: true }),
    getPlan: vi.fn().mockResolvedValue({ nodes: mockNodes, edges: mockEdges }),
    getFullPlan: vi.fn().mockResolvedValue({ nodes: mockNodes, edges: mockEdges }),
    createPlanNode: vi.fn().mockResolvedValue(mockNodes[0]),
    updatePlanNode: vi.fn().mockResolvedValue(mockNodes[0]),
    deletePlanNode: vi.fn().mockResolvedValue({ ok: true }),
    createPlanEdge: vi.fn().mockResolvedValue(mockEdges[0]),
    deletePlanEdge: vi.fn().mockResolvedValue({ ok: true }),
    getExecutions: vi.fn().mockResolvedValue({
      'node-1': {
        executionId: 'exec-1',
        projectId: 'proj-1234-5678',
        status: 'success',
        error: null,
        machineId: null,
        providerId: null,
        providerName: null,
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T01:00:00Z',
        durationMs: 3600000,
        inputTokens: 1000,
        outputTokens: 500,
        tokensUsed: 1500,
        estimatedCostUsd: 0.05,
        model: 'sonnet',
        turnsUsed: 3,
        markdownSummary: null,
      },
    }),
    listFileChanges: vi.fn().mockResolvedValue([]),
    listMachines: vi.fn().mockResolvedValue([mockMachine]),
    getMachine: vi.fn().mockResolvedValue(mockMachine),
    revokeMachine: vi.fn().mockResolvedValue({ ok: true }),
    search: vi.fn().mockResolvedValue({ projects: [mockProject], tasks: [], executions: [] }),
    listActivities: vi.fn().mockResolvedValue([]),
    getRelayStatus: vi.fn().mockResolvedValue({ server: { running: true, port: 3002 } }),
    getSlurmClusters: vi.fn().mockResolvedValue([]),
    dispatchTask: vi.fn().mockResolvedValue(new Response()),
    cancelTask: vi.fn().mockResolvedValue({ ok: true }),
    steerTask: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  }
}

// ── Project commands ──────────────────────────────────────────────────

describe('Project commands', () => {
  it('listProjects returns all projects', async () => {
    const client = createMockClient()
    const result = await listProjects(client)
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].name).toBe('Test Project')
  })

  it('getProject resolves by partial ID', async () => {
    const client = createMockClient()
    const result = await getProject(client, 'proj-12')
    expect(result.project.id).toBe('proj-1234-5678')
  })

  it('resolveProject throws on no match', async () => {
    const client = createMockClient()
    await expect(resolveProject(client, 'nonexistent')).rejects.toThrow('No project found')
  })

  it('createProject returns created project', async () => {
    const client = createMockClient()
    const result = await createProject(client, { name: 'New Project' })
    expect(result.project.name).toBe('Test Project') // mock returns mockProject
    expect(client.createProject).toHaveBeenCalledWith({
      name: 'New Project',
      description: undefined,
      workingDirectory: undefined,
    })
  })

  it('updateProject throws if no fields provided', async () => {
    const client = createMockClient()
    await expect(updateProject(client, 'proj-12', {})).rejects.toThrow('No update fields')
  })

  it('updateProject returns updated project with field list', async () => {
    const client = createMockClient()
    const result = await updateProject(client, 'proj-12', { name: 'New Name' })
    expect(result.updatedFields).toEqual(['name'])
  })

  it('deleteProject returns id and name', async () => {
    const client = createMockClient()
    const result = await deleteProject(client, 'proj-12')
    expect(result.id).toBe('proj-1234-5678')
    expect(result.name).toBe('Test Project')
  })

  it('getProjectStats computes statistics', async () => {
    const client = createMockClient()
    const result = await getProjectStats(client, 'proj-12')

    expect(result.project.name).toBe('Test Project')
    expect(result.plan.totalNodes).toBe(2)
    expect(result.plan.totalEdges).toBe(1)
    expect(result.plan.statusCounts).toEqual({ completed: 1, planned: 1 })
    expect(result.executions.total).toBe(1)
    expect(result.executions.successCount).toBe(1)
    expect(result.executions.successRate).toBe('100%')
    expect(result.executions.totalTokens).toBe(1500)
    expect(result.executions.totalCost).toBe(0.05)
  })
})

// ── Plan commands ─────────────────────────────────────────────────────

describe('Plan commands', () => {
  describe('buildPlanTree', () => {
    it('builds a tree from nodes and edges', () => {
      const nodes = [
        { id: 'a', title: 'Root', status: 'completed', type: 'task' },
        { id: 'b', title: 'Child 1', status: 'planned', type: 'task' },
        { id: 'c', title: 'Child 2', status: 'planned', type: 'task' },
      ]
      const edges = [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
      ]

      const roots = buildPlanTree(nodes, edges)
      expect(roots).toHaveLength(1)
      expect(roots[0].id).toBe('a')
      expect(roots[0].children).toHaveLength(2)
      expect(roots[0].children[0].id).toBe('b')
      expect(roots[0].children[1].id).toBe('c')
    })

    it('handles multiple roots', () => {
      const nodes = [
        { id: 'a', title: 'Root 1', status: 'planned', type: 'task' },
        { id: 'b', title: 'Root 2', status: 'planned', type: 'task' },
      ]
      const roots = buildPlanTree(nodes, [])
      expect(roots).toHaveLength(2)
    })

    it('handles empty input', () => {
      const roots = buildPlanTree([], [])
      expect(roots).toHaveLength(0)
    })
  })

  describe('renderTreeLines', () => {
    it('renders ASCII tree lines', () => {
      const roots = buildPlanTree(
        [
          { id: 'a', title: 'Root', status: 'done', type: 'milestone' },
          { id: 'b', title: 'Child', status: 'planned', type: 'task' },
        ],
        [{ source: 'a', target: 'b' }],
      )
      const lines = renderTreeLines(roots)
      expect(lines).toHaveLength(2)
      expect(lines[0]).toContain('a: Root')
      expect(lines[1]).toContain('b: Child')
      expect(lines[0]).toContain('[milestone]')
    })

    it('accepts custom formatters', () => {
      const roots = buildPlanTree(
        [{ id: 'x', title: 'Node', status: 'active', type: 'task' }],
        [],
      )
      const lines = renderTreeLines(roots, {
        statusFormatter: (s) => `<${s}>`,
        typeFormatter: (t) => `(${t})`,
      })
      expect(lines[0]).toContain('<active>')
      expect(lines[0]).toContain('(task)')
    })
  })

  it('getPlanTree returns tree with counts', async () => {
    const client = createMockClient()
    const result = await getPlanTree(client, 'proj-12')
    expect(result.roots).toHaveLength(1) // node-1 is root, node-2 is child
    expect(result.totalNodes).toBe(2)
    expect(result.totalEdges).toBe(1)
  })

  it('listPlanNodes returns active nodes only', async () => {
    const client = createMockClient({
      getPlan: vi.fn().mockResolvedValue({
        nodes: [...mockNodes, { ...mockNodes[0], id: 'deleted', deletedAt: '2024-01-01' }],
        edges: mockEdges,
      }),
    })
    const result = await listPlanNodes(client, 'proj-12')
    expect(result.nodes).toHaveLength(2) // deleted node excluded
  })

  it('validateNodeIds returns errors for missing nodes', async () => {
    const client = createMockClient()
    const errors = await validateNodeIds(client, 'proj-1234-5678', [
      { id: 'node-1', role: 'source' },
      { id: 'nonexistent', role: 'target' },
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('target "nonexistent" not found')
  })
})

// ── Task commands ─────────────────────────────────────────────────────

describe('Task commands', () => {
  it('listTasks returns filtered and sorted tasks', async () => {
    const client = createMockClient()
    const result = await listTasks(client)
    expect(result.tasks).toHaveLength(2)
    // Should be sorted by updatedAt desc
    expect(result.tasks[0].id).toBe('node-2')
    expect(result.tasks[0].projectName).toBe('Test Project')
  })

  it('listTasks filters by status', async () => {
    const client = createMockClient()
    const result = await listTasks(client, { status: 'planned' })
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].status).toBe('planned')
  })

  it('listTasks filters by date range', async () => {
    const client = createMockClient()
    const result = await listTasks(client, {
      since: new Date('2024-06-02T00:00:00Z'),
    })
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].id).toBe('node-2')
  })

  it('getTask returns detail with execution', async () => {
    const client = createMockClient()
    const result = await getTask(client, 'node-1')
    expect(result.node.id).toBe('node-1')
    expect(result.projectName).toBe('Test Project')
    expect(result.execution).not.toBeNull()
    expect(result.execution?.executionId).toBe('exec-1')
  })

  it('getTask throws if not found', async () => {
    const client = createMockClient()
    await expect(getTask(client, 'nonexistent')).rejects.toThrow('Task not found')
  })

  it('cancelTask calls client and returns result', async () => {
    const client = createMockClient()
    const result = await cancelTask(client, { executionId: 'exec-1' })
    expect(result.executionId).toBe('exec-1')
    expect(client.cancelTask).toHaveBeenCalled()
  })

  it('steerTask calls client with correct params', async () => {
    const client = createMockClient()
    const result = await steerTask(client, {
      executionId: 'exec-1',
      machineId: 'machine-1',
      message: 'Focus on tests',
      action: 'guidance',
    })
    expect(result.executionId).toBe('exec-1')
    expect(client.steerTask).toHaveBeenCalledWith({
      taskId: 'exec-1',
      machineId: 'machine-1',
      message: 'Focus on tests',
      action: 'guidance',
    })
  })

  it('updateTaskStatus calls client and returns result', async () => {
    const client = createMockClient()
    const result = await updateTaskStatus(client, 'node-1', 'completed')
    expect(result.nodeId).toBe('node-1')
    expect(result.status).toBe('completed')
  })
})

// ── Environment commands ──────────────────────────────────────────────

describe('Environment commands', () => {
  it('listMachines excludes revoked machines', async () => {
    const client = createMockClient({
      listMachines: vi.fn().mockResolvedValue([
        mockMachine,
        { ...mockMachine, id: 'revoked-1', isRevoked: true },
      ]),
    })
    const result = await listMachines(client)
    expect(result.machines).toHaveLength(1)
    expect(result.machines[0].id).toBe('machine-1234-5678')
  })

  it('getMachine resolves by partial ID', async () => {
    const client = createMockClient()
    const result = await getMachine(client, 'machine-12')
    expect(result.machine.id).toBe('machine-1234-5678')
  })

  it('resolveMachine throws on no match', async () => {
    const client = createMockClient()
    await expect(resolveMachine(client, 'nonexistent')).rejects.toThrow('No machine found')
  })

  it('removeMachine revokes and returns info', async () => {
    const client = createMockClient()
    const result = await removeMachine(client, 'machine-12')
    expect(result.machineId).toBe('machine-1234-5678')
    expect(result.name).toBe('My Machine')
    expect(client.revokeMachine).toHaveBeenCalledWith('machine-1234-5678')
  })

  it('listProviders aggregates from providerConfigs', async () => {
    const client = createMockClient()
    const result = await listProviders(client)
    expect(result.providers).toHaveLength(1)
    expect(result.providers[0].provider).toBe('claude')
    expect(result.providers[0].connected).toBe(true)
  })

  it('listProviders falls back to providers array', async () => {
    const client = createMockClient({
      listMachines: vi.fn().mockResolvedValue([
        { ...mockMachine, providerConfigs: undefined, providers: ['openai', 'claude'] },
      ]),
    })
    const result = await listProviders(client)
    expect(result.providers).toHaveLength(2)
  })

  it('getRelayStatus returns status', async () => {
    const client = createMockClient()
    const result = await getRelayStatus(client)
    expect(result.status.server?.running).toBe(true)
  })

  it('listClusters returns clusters', async () => {
    const client = createMockClient()
    const result = await listClusters(client)
    expect(result.clusters).toHaveLength(0)
  })
})

// ── Search commands ───────────────────────────────────────────────────

describe('Search commands', () => {
  it('searchAll returns grouped results with total', async () => {
    const client = createMockClient()
    const result = await searchAll(client, 'test')
    expect(result.query).toBe('test')
    expect(result.projects).toHaveLength(1)
    expect(result.totalMatches).toBe(1)
  })

  it('searchAll filters by type', async () => {
    const client = createMockClient()
    const result = await searchAll(client, 'test', { type: 'tasks' })
    expect(result.projects).toHaveLength(0)
    expect(result.tasks).toHaveLength(0)
  })

  it('searchAll filters by date', async () => {
    const client = createMockClient()
    const result = await searchAll(client, 'test', {
      since: new Date('2025-01-01'),
    })
    // mockProject.updatedAt is 2024-06-01, so it should be filtered out
    expect(result.projects).toHaveLength(0)
  })

  it('listActivities returns formatted activities', async () => {
    const client = createMockClient({
      listActivities: vi.fn().mockResolvedValue([
        {
          id: 'act-1',
          userId: 'user-1',
          projectId: 'proj-1',
          type: 'task:completed',
          title: 'Task done',
          description: null,
          nodeId: 'node-1',
          metadata: {},
          createdAt: '2024-06-01T00:00:00Z',
        },
      ]),
    })
    const result = await listActivities(client)
    expect(result.activities).toHaveLength(1)
    expect(result.activities[0].type).toBe('task:completed')
  })

  it('listActivities filters by type', async () => {
    const client = createMockClient({
      listActivities: vi.fn().mockResolvedValue([
        {
          id: 'act-1',
          userId: 'user-1',
          projectId: 'proj-1',
          type: 'task:completed',
          title: 'Task done',
          description: null,
          nodeId: 'node-1',
          metadata: {},
          createdAt: '2024-06-01T00:00:00Z',
        },
      ]),
    })
    const result = await listActivities(client, { type: 'task:failed' })
    expect(result.activities).toHaveLength(0)
  })
})

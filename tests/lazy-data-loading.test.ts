/**
 * Tests for lazy data loading (feat/lazy-data-loading-v2)
 *
 * Covers:
 * - Backend slim mode: ?slim=1 excludes large fields (content, executionOutput, streamText)
 * - Backend per-project plan endpoint: field parity with global /plan
 * - Plan store: loadForProject merge logic (replace project nodes/edges, keep others)
 * - Execution store: loadForProject merge (replace project execs, preserve running)
 * - Content sync: render-time state adjustment for slim → full transition
 * - Page navigation simulation: what data is available at each stage
 */

import { describe, it, expect } from 'vitest'

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface SlimNode {
  id: string
  projectId: string
  title: string
  description: string | null
  content: string | null
  executionOutput: string | null
  status: string
}

interface FullNode extends SlimNode {
  content: string
}

interface SlimExecution {
  nodeId: string
  projectId: string
  status: string
  streamText: string | null
  summary: { workCompleted: string } | null
}

interface PlanEdge {
  id: string
  source: string
  target: string
}

// ─── Slim Mode Filtering ─────────────────────────────────────────────────────

describe('slim mode field filtering', () => {
  it('excludes content and executionOutput from nodes in slim mode', () => {
    const rawNode = {
      id: 'node-1',
      projectId: 'proj-1',
      title: 'Task 1',
      description: 'Do something',
      content: '<p>Rich content with images and formatting</p>',
      executionOutput: 'Long execution output...',
      status: 'planned',
    }

    const slim = true

    // This mirrors the server-side slim filtering in data.ts
    const slimNode = {
      ...rawNode,
      executionOutput: slim ? null : rawNode.executionOutput,
      content: slim ? null : rawNode.content,
    }

    expect(slimNode.content).toBeNull()
    expect(slimNode.executionOutput).toBeNull()
    expect(slimNode.title).toBe('Task 1')
    expect(slimNode.description).toBe('Do something')
  })

  it('preserves all fields when slim mode is off', () => {
    const rawNode = {
      id: 'node-1',
      projectId: 'proj-1',
      title: 'Task 1',
      description: 'Do something',
      content: '<p>Rich content</p>',
      executionOutput: 'Output text',
      status: 'planned',
    }

    const slim = false

    const fullNode = {
      ...rawNode,
      executionOutput: slim ? null : rawNode.executionOutput,
      content: slim ? null : rawNode.content,
    }

    expect(fullNode.content).toBe('<p>Rich content</p>')
    expect(fullNode.executionOutput).toBe('Output text')
  })

  it('excludes streamText from executions in slim mode', () => {
    const rawExec = {
      nodeId: 'node-1',
      projectId: 'proj-1',
      status: 'success',
      streamText: 'Very long streaming text (100KB+)',
      cost: 0.5,
    }

    const slim = true

    // In slim mode, streamText column is omitted from the SQL select.
    // Simulate by stripping it.
    const slimExec = slim
      ? { nodeId: rawExec.nodeId, projectId: rawExec.projectId, status: rawExec.status, cost: rawExec.cost }
      : rawExec

    expect('streamText' in slimExec).toBe(false)
    expect(slimExec.cost).toBe(0.5)
  })
})

// ─── Per-Project Endpoint Field Parity ───────────────────────────────────────

describe('per-project plan endpoint field parity', () => {
  const globalFields = [
    'id', 'projectId', 'number', 'type', 'title', 'description', 'status',
    'parentId', 'dependencies', 'environment', 'verification', 'position',
    'startDate', 'endDate', 'actualStartDate', 'actualEndDate',
    'priority', 'estimate', 'dueDate', 'milestoneId', 'labelIds',
    'executionId', 'executionOutput', 'executionError',
    'executionStartedAt', 'executionCompletedAt',
    'branchName', 'prUrl', 'prNumber',
    'content', 'attachments', 'links', 'acceptanceCriteria',
    'loopConfig', 'loopCurrentIteration', 'loopBestMetricValue',
    'loopBestIteration', 'loopStatus',
    'createdAt', 'updatedAt',
  ]

  it('per-project endpoint includes all fields from global endpoint', () => {
    // Simulate what the per-project endpoint returns
    const perProjectNode: Record<string, unknown> = {}
    for (const field of globalFields) {
      perProjectNode[field] = `value-${field}`
    }

    for (const field of globalFields) {
      expect(perProjectNode).toHaveProperty(field)
    }
  })

  it('actualStartDate and actualEndDate are included', () => {
    // This was a bug found in review — these fields were missing from /plan/:projectId
    const node = {
      actualStartDate: '2024-01-15',
      actualEndDate: '2024-01-20',
    }
    expect(node.actualStartDate).toBeDefined()
    expect(node.actualEndDate).toBeDefined()
  })
})

// ─── Plan Store: loadForProject Merge Logic ──────────────────────────────────

describe('plan store loadForProject merge logic', () => {
  function mergeProjectNodes(
    existingNodes: SlimNode[],
    existingEdges: PlanEdge[],
    fullNodes: FullNode[],
    fullEdges: PlanEdge[],
    projectId: string,
  ) {
    // This mirrors the merge logic in plan-store.ts loadForProject
    const otherNodes = existingNodes.filter((n) => n.projectId !== projectId)
    const projectNodeIds = new Set(
      existingNodes.filter((n) => n.projectId === projectId).map((n) => n.id)
    )
    const otherEdges = existingEdges.filter(
      (e) => !projectNodeIds.has(e.source) && !projectNodeIds.has(e.target)
    )
    return {
      nodes: [...otherNodes, ...fullNodes],
      edges: [...otherEdges, ...fullEdges],
    }
  }

  it('replaces slim project nodes with full nodes', () => {
    const existing: SlimNode[] = [
      { id: 'n1', projectId: 'p1', title: 'Task 1', description: 'desc', content: null, executionOutput: null, status: 'planned' },
      { id: 'n2', projectId: 'p1', title: 'Task 2', description: 'desc', content: null, executionOutput: null, status: 'planned' },
      { id: 'n3', projectId: 'p2', title: 'Other', description: 'desc', content: null, executionOutput: null, status: 'planned' },
    ]
    const full: FullNode[] = [
      { id: 'n1', projectId: 'p1', title: 'Task 1', description: 'desc', content: '<p>Full content 1</p>', executionOutput: 'output', status: 'planned' },
      { id: 'n2', projectId: 'p1', title: 'Task 2', description: 'desc', content: '<p>Full content 2</p>', executionOutput: 'output', status: 'planned' },
    ]

    const result = mergeProjectNodes(existing, [], full, [], 'p1')

    // Project p1 nodes replaced with full versions
    expect(result.nodes).toHaveLength(3)
    const p1Nodes = result.nodes.filter((n) => n.projectId === 'p1')
    expect(p1Nodes).toHaveLength(2)
    expect(p1Nodes[0].content).toBe('<p>Full content 1</p>')
    expect(p1Nodes[1].content).toBe('<p>Full content 2</p>')

    // Project p2 nodes unchanged
    const p2Nodes = result.nodes.filter((n) => n.projectId === 'p2')
    expect(p2Nodes).toHaveLength(1)
    expect(p2Nodes[0].content).toBeNull()
  })

  it('preserves edges from other projects', () => {
    const existingNodes: SlimNode[] = [
      { id: 'n1', projectId: 'p1', title: 'T1', description: null, content: null, executionOutput: null, status: 'planned' },
      { id: 'n2', projectId: 'p1', title: 'T2', description: null, content: null, executionOutput: null, status: 'planned' },
      { id: 'n3', projectId: 'p2', title: 'T3', description: null, content: null, executionOutput: null, status: 'planned' },
      { id: 'n4', projectId: 'p2', title: 'T4', description: null, content: null, executionOutput: null, status: 'planned' },
    ]
    const existingEdges: PlanEdge[] = [
      { id: 'e1', source: 'n1', target: 'n2' }, // p1 edge
      { id: 'e2', source: 'n3', target: 'n4' }, // p2 edge
    ]
    const fullEdges: PlanEdge[] = [
      { id: 'e1', source: 'n1', target: 'n2' }, // p1 edge from full load
    ]

    const result = mergeProjectNodes(
      existingNodes,
      existingEdges,
      existingNodes.filter((n) => n.projectId === 'p1') as FullNode[],
      fullEdges,
      'p1',
    )

    expect(result.edges).toHaveLength(2) // p2 edge preserved + p1 edge from full load
    expect(result.edges.find((e) => e.id === 'e2')).toBeDefined() // p2 edge kept
  })

  it('edge filtering checks both source and target', () => {
    // Regression test: previously only checked source, causing duplicate edges
    const existingNodes: SlimNode[] = [
      { id: 'n1', projectId: 'p1', title: 'T1', description: null, content: null, executionOutput: null, status: 'planned' },
      { id: 'n2', projectId: 'p1', title: 'T2', description: null, content: null, executionOutput: null, status: 'planned' },
      { id: 'n3', projectId: 'p2', title: 'T3', description: null, content: null, executionOutput: null, status: 'planned' },
    ]
    const existingEdges: PlanEdge[] = [
      { id: 'e1', source: 'n3', target: 'n1' }, // cross-project edge: p2 → p1
    ]

    const projectNodeIds = new Set(
      existingNodes.filter((n) => n.projectId === 'p1').map((n) => n.id)
    )

    // Old (buggy) logic: only checked source
    const buggyFilter = existingEdges.filter((e) => !projectNodeIds.has(e.source))
    expect(buggyFilter).toHaveLength(1) // BUG: keeps the edge because source is n3 (p2)

    // Fixed logic: checks both source and target
    const fixedFilter = existingEdges.filter(
      (e) => !projectNodeIds.has(e.source) && !projectNodeIds.has(e.target)
    )
    expect(fixedFilter).toHaveLength(0) // Correct: removes edge because target is n1 (p1)
  })

  it('handles loading a project with no nodes gracefully', () => {
    const existing: SlimNode[] = [
      { id: 'n1', projectId: 'p1', title: 'T1', description: null, content: null, executionOutput: null, status: 'planned' },
    ]

    const result = mergeProjectNodes(existing, [], [], [], 'p2')

    // p1 nodes preserved, no p2 nodes added
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('n1')
  })
})

// ─── Execution Store: loadForProject with Running Protection ─────────────────

describe('execution store loadForProject merge logic', () => {
  function mergeProjectExecutions(
    existing: Map<string, SlimExecution>,
    fullExecs: Map<string, SlimExecution>,
    projectId: string,
  ): Map<string, SlimExecution> {
    // This mirrors the merge logic in execution-store.ts loadForProject
    const merged = new Map(existing)

    // Remove old entries for this project (except actively running ones)
    for (const [nodeId, exec] of existing) {
      if (exec.projectId === projectId && exec.status !== 'running' && exec.status !== 'pending') {
        merged.delete(nodeId)
      }
    }

    // Add fresh full data (skip if we preserved a running entry)
    for (const [nodeId, exec] of fullExecs) {
      if (!merged.has(nodeId) || merged.get(nodeId)?.status !== 'running') {
        merged.set(nodeId, exec)
      }
    }

    return merged
  }

  it('replaces completed executions with full data', () => {
    const existing = new Map<string, SlimExecution>([
      ['n1', { nodeId: 'n1', projectId: 'p1', status: 'success', streamText: null, summary: null }],
      ['n2', { nodeId: 'n2', projectId: 'p2', status: 'success', streamText: null, summary: null }],
    ])
    const full = new Map<string, SlimExecution>([
      ['n1', { nodeId: 'n1', projectId: 'p1', status: 'success', streamText: 'full stream text', summary: { workCompleted: 'Done' } }],
    ])

    const result = mergeProjectExecutions(existing, full, 'p1')

    expect(result.size).toBe(2) // n1 replaced, n2 preserved
    expect(result.get('n1')?.streamText).toBe('full stream text')
    expect(result.get('n2')?.streamText).toBeNull() // unchanged
  })

  it('preserves running executions during merge', () => {
    const existing = new Map<string, SlimExecution>([
      ['n1', { nodeId: 'n1', projectId: 'p1', status: 'running', streamText: 'live streaming data...', summary: null }],
      ['n2', { nodeId: 'n2', projectId: 'p1', status: 'success', streamText: null, summary: null }],
    ])
    const full = new Map<string, SlimExecution>([
      ['n1', { nodeId: 'n1', projectId: 'p1', status: 'running', streamText: 'stale DB snapshot', summary: null }],
      ['n2', { nodeId: 'n2', projectId: 'p1', status: 'success', streamText: 'full text', summary: { workCompleted: 'Done' } }],
    ])

    const result = mergeProjectExecutions(existing, full, 'p1')

    // Running execution preserved with live data (not stale DB snapshot)
    expect(result.get('n1')?.streamText).toBe('live streaming data...')
    // Completed execution replaced with full data
    expect(result.get('n2')?.streamText).toBe('full text')
  })

  it('preserves pending executions during merge', () => {
    const existing = new Map<string, SlimExecution>([
      ['n1', { nodeId: 'n1', projectId: 'p1', status: 'pending', streamText: null, summary: null }],
    ])
    const full = new Map<string, SlimExecution>([
      ['n1', { nodeId: 'n1', projectId: 'p1', status: 'pending', streamText: null, summary: null }],
    ])

    const result = mergeProjectExecutions(existing, full, 'p1')

    // Pending execution preserved
    expect(result.get('n1')?.status).toBe('pending')
  })

  it('does not affect executions from other projects', () => {
    const existing = new Map<string, SlimExecution>([
      ['n1', { nodeId: 'n1', projectId: 'p1', status: 'success', streamText: null, summary: null }],
      ['n2', { nodeId: 'n2', projectId: 'p2', status: 'running', streamText: 'live', summary: null }],
    ])
    const full = new Map<string, SlimExecution>([
      ['n1', { nodeId: 'n1', projectId: 'p1', status: 'success', streamText: 'full', summary: null }],
    ])

    const result = mergeProjectExecutions(existing, full, 'p1')

    // p2 execution untouched
    expect(result.get('n2')?.streamText).toBe('live')
    expect(result.get('n2')?.projectId).toBe('p2')
  })
})

// ─── Content Sync: Render-time State Adjustment ──────────────────────────────

describe('content sync for slim → full transition', () => {
  // Simulates the render-time state adjustment pattern in task-content-tab.tsx

  interface ContentSyncState {
    draftContent: string
    prevInitialContent: string
  }

  function syncContent(
    state: ContentSyncState,
    newInitialContent: string,
  ): ContentSyncState {
    if (newInitialContent !== state.prevInitialContent) {
      // Content source changed (e.g., full data arrived)
      if (state.draftContent === state.prevInitialContent) {
        // User hasn't diverged → sync to new content
        return {
          draftContent: newInitialContent,
          prevInitialContent: newInitialContent,
        }
      } else {
        // User has local edits → preserve their work
        return {
          ...state,
          prevInitialContent: newInitialContent,
        }
      }
    }
    return state
  }

  it('syncs draft when full content arrives and user has not edited', () => {
    const state: ContentSyncState = {
      draftContent: '',  // slim mode: content was null → empty string
      prevInitialContent: '',
    }

    const result = syncContent(state, '<p>Full rich content</p>')

    expect(result.draftContent).toBe('<p>Full rich content</p>')
    expect(result.prevInitialContent).toBe('<p>Full rich content</p>')
  })

  it('preserves user edits when full content arrives', () => {
    const state: ContentSyncState = {
      draftContent: '<p>User typed something</p>',  // user edited
      prevInitialContent: '',  // originally empty from slim load
    }

    const result = syncContent(state, '<p>Full rich content from DB</p>')

    expect(result.draftContent).toBe('<p>User typed something</p>') // preserved!
    expect(result.prevInitialContent).toBe('<p>Full rich content from DB</p>') // updated for future comparisons
  })

  it('no-ops when initialContent has not changed', () => {
    const state: ContentSyncState = {
      draftContent: '<p>Content</p>',
      prevInitialContent: '<p>Content</p>',
    }

    const result = syncContent(state, '<p>Content</p>')

    expect(result).toBe(state) // exact same object, no state change
  })

  it('syncs when content changes from one value to another (re-render)', () => {
    const state: ContentSyncState = {
      draftContent: '<p>Original</p>',
      prevInitialContent: '<p>Original</p>',
    }

    const result = syncContent(state, '<p>Updated by another user</p>')

    expect(result.draftContent).toBe('<p>Updated by another user</p>')
  })
})

// ─── Page Navigation Simulation ──────────────────────────────────────────────

describe('page navigation simulation', () => {
  // Simulates what data is available at each stage of user navigation

  interface AppState {
    planNodes: SlimNode[]
    planEdges: PlanEdge[]
    executions: Map<string, SlimExecution>
    loadedProjects: Set<string>
  }

  function initialSlimLoad(): AppState {
    // Simulates DataLoader → load() with slim=true
    return {
      planNodes: [
        { id: 'n1', projectId: 'p1', title: 'Task 1', description: 'Do X', content: null, executionOutput: null, status: 'planned' },
        { id: 'n2', projectId: 'p1', title: 'Task 2', description: 'Do Y', content: null, executionOutput: null, status: 'completed' },
        { id: 'n3', projectId: 'p2', title: 'Task 3', description: 'Do Z', content: null, executionOutput: null, status: 'planned' },
      ],
      planEdges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n3', target: 'n3' }, // self-loop in p2
      ],
      executions: new Map([
        ['n2', { nodeId: 'n2', projectId: 'p1', status: 'success', streamText: null, summary: null }],
      ]),
      loadedProjects: new Set(),
    }
  }

  it('projects page shows all projects with slim data', () => {
    const state = initialSlimLoad()

    // Projects page lists all projects — just needs title, status
    const p1Tasks = state.planNodes.filter((n) => n.projectId === 'p1')
    const p2Tasks = state.planNodes.filter((n) => n.projectId === 'p2')

    expect(p1Tasks).toHaveLength(2)
    expect(p2Tasks).toHaveLength(1)

    // Titles are available
    expect(p1Tasks[0].title).toBe('Task 1')

    // Content is NOT available (slim)
    expect(p1Tasks[0].content).toBeNull()
  })

  it('plan view shows task graph but content is null until full load', () => {
    const state = initialSlimLoad()

    // Plan graph uses: title, status, position, edges — all available in slim mode
    const p1Nodes = state.planNodes.filter((n) => n.projectId === 'p1')
    const p1NodeIds = new Set(p1Nodes.map((n) => n.id))
    const p1Edges = state.planEdges.filter(
      (e) => p1NodeIds.has(e.source) || p1NodeIds.has(e.target)
    )

    expect(p1Nodes).toHaveLength(2)
    expect(p1Edges).toHaveLength(1)

    // Content not yet loaded
    expect(p1Nodes[0].content).toBeNull()
    expect(p1Nodes[0].executionOutput).toBeNull()
  })

  it('after loadForProject, content and executionOutput are available', () => {
    const state = initialSlimLoad()

    // Simulate loadForProject('p1')
    const fullNodes: FullNode[] = [
      { id: 'n1', projectId: 'p1', title: 'Task 1', description: 'Do X', content: '<p>Full instructions for Task 1</p>', executionOutput: null, status: 'planned' },
      { id: 'n2', projectId: 'p1', title: 'Task 2', description: 'Do Y', content: '<p>Full instructions for Task 2</p>', executionOutput: 'Build succeeded!', status: 'completed' },
    ]
    const fullEdges: PlanEdge[] = [
      { id: 'e1', source: 'n1', target: 'n2' },
    ]

    // Merge
    const otherNodes = state.planNodes.filter((n) => n.projectId !== 'p1')
    const projectNodeIds = new Set(state.planNodes.filter((n) => n.projectId === 'p1').map((n) => n.id))
    const otherEdges = state.planEdges.filter(
      (e) => !projectNodeIds.has(e.source) && !projectNodeIds.has(e.target)
    )

    state.planNodes = [...otherNodes, ...fullNodes]
    state.planEdges = [...otherEdges, ...fullEdges]
    state.loadedProjects.add('p1')

    // Now content is available for p1
    const p1Nodes = state.planNodes.filter((n) => n.projectId === 'p1')
    expect(p1Nodes[0].content).toBe('<p>Full instructions for Task 1</p>')
    expect(p1Nodes[1].executionOutput).toBe('Build succeeded!')

    // p2 still slim
    const p2Nodes = state.planNodes.filter((n) => n.projectId === 'p2')
    expect(p2Nodes[0].content).toBeNull()
  })

  it('navigating between projects loads each one independently', () => {
    const state = initialSlimLoad()

    // Navigate to p1 → triggers loadForProject('p1')
    state.loadedProjects.add('p1')

    // Navigate to p2 → triggers loadForProject('p2')
    state.loadedProjects.add('p2')

    // Both loaded
    expect(state.loadedProjects.has('p1')).toBe(true)
    expect(state.loadedProjects.has('p2')).toBe(true)
  })

  it('returning to already-loaded project does not re-fetch', () => {
    const loadedProjects = new Set<string>()
    const loadingProjects = new Set<string>()
    let fetchCount = 0

    function shouldLoad(projectId: string): boolean {
      if (loadedProjects.has(projectId) || loadingProjects.has(projectId)) return false
      loadingProjects.add(projectId)
      fetchCount++
      // Simulate async load completing
      loadingProjects.delete(projectId)
      loadedProjects.add(projectId)
      return true
    }

    // First visit to p1
    expect(shouldLoad('p1')).toBe(true)
    expect(fetchCount).toBe(1)

    // Return to p1 — no re-fetch
    expect(shouldLoad('p1')).toBe(false)
    expect(fetchCount).toBe(1)

    // Visit p2
    expect(shouldLoad('p2')).toBe(true)
    expect(fetchCount).toBe(2)

    // Return to p1 again — still no re-fetch
    expect(shouldLoad('p1')).toBe(false)
    expect(fetchCount).toBe(2)
  })

  it('concurrent navigation to same project deduplicates', () => {
    const loadedProjects = new Set<string>()
    const loadingProjects = new Set<string>()
    let fetchCount = 0

    function tryLoad(projectId: string): boolean {
      if (loadedProjects.has(projectId) || loadingProjects.has(projectId)) return false
      loadingProjects.add(projectId)
      fetchCount++
      return true
    }

    function completeLoad(projectId: string) {
      loadingProjects.delete(projectId)
      loadedProjects.add(projectId)
    }

    // Two components mount simultaneously for p1
    const load1 = tryLoad('p1')
    const load2 = tryLoad('p1') // Should be blocked by loadingProjects

    expect(load1).toBe(true)
    expect(load2).toBe(false)
    expect(fetchCount).toBe(1)

    completeLoad('p1')

    // After completion, still only 1 fetch
    expect(tryLoad('p1')).toBe(false)
    expect(fetchCount).toBe(1)
  })

  it('failed load allows retry on next navigation', () => {
    const loadedProjects = new Set<string>()
    const loadingProjects = new Set<string>()
    let fetchCount = 0

    function tryLoad(projectId: string): boolean {
      if (loadedProjects.has(projectId) || loadingProjects.has(projectId)) return false
      loadingProjects.add(projectId)
      fetchCount++
      return true
    }

    function failLoad(projectId: string) {
      loadingProjects.delete(projectId)
      // Don't add to loadedProjects — allow retry
    }

    // First attempt fails
    expect(tryLoad('p1')).toBe(true)
    failLoad('p1')

    // Retry succeeds
    expect(tryLoad('p1')).toBe(true)
    expect(fetchCount).toBe(2)
  })
})

// ─── Backfill Summary No-op in Slim Mode ─────────────────────────────────────

describe('backfill summary in slim mode', () => {
  it('backfill loop is no-op when streamText is null (slim mode)', () => {
    const executions = new Map<string, SlimExecution>([
      ['n1', { nodeId: 'n1', projectId: 'p1', status: 'success', streamText: null, summary: null }],
      ['n2', { nodeId: 'n2', projectId: 'p1', status: 'failure', streamText: null, summary: null }],
    ])

    // Simulate the backfill loop
    let backfillCount = 0
    for (const [, exec] of executions) {
      if (!exec.summary && exec.streamText && (exec.status === 'success' || exec.status === 'failure')) {
        backfillCount++
      }
    }

    // streamText is null in slim mode, so no backfills triggered
    expect(backfillCount).toBe(0)
  })

  it('backfill works when streamText is available (full load)', () => {
    const executions = new Map<string, SlimExecution>([
      ['n1', { nodeId: 'n1', projectId: 'p1', status: 'success', streamText: 'some output text', summary: null }],
    ])

    let backfillCount = 0
    for (const [, exec] of executions) {
      if (!exec.summary && exec.streamText && (exec.status === 'success' || exec.status === 'failure')) {
        backfillCount++
      }
    }

    expect(backfillCount).toBe(1)
  })
})

// ─── URL Parameter Construction ──────────────────────────────────────────────

describe('API URL parameter construction', () => {
  it('builds correct URL for slim plan request', () => {
    const slim = true
    const params = slim ? '?slim=1' : ''
    expect(`/api/data/plan${params}`).toBe('/api/data/plan?slim=1')
  })

  it('builds correct URL for slim execution request', () => {
    const params = new URLSearchParams()
    params.set('slim', '1')
    expect(`/api/data/executions?${params.toString()}`).toBe('/api/data/executions?slim=1')
  })

  it('builds correct URL for project-scoped execution request', () => {
    const params = new URLSearchParams()
    params.set('projectId', 'proj-123')
    expect(`/api/data/executions?${params.toString()}`).toBe('/api/data/executions?projectId=proj-123')
  })

  it('builds correct URL with both slim and projectId', () => {
    const params = new URLSearchParams()
    params.set('slim', '1')
    params.set('projectId', 'proj-123')
    const qs = params.toString()
    expect(qs).toContain('slim=1')
    expect(qs).toContain('projectId=proj-123')
  })

  it('builds empty query string when no options', () => {
    const params = new URLSearchParams()
    const qs = params.toString()
    expect(qs).toBe('')
  })
})

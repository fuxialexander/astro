/**
 * Discovery Pipeline E2E Tests
 *
 * Integration tests using PGlite-backed test server to verify:
 * 1. OutputDir generation on node creation (discoveryMode projects)
 * 2. Milestone-prefixed output dirs
 * 3. No outputDir for non-discovery projects
 * 4. No outputDir for milestone-type nodes
 * 5. Prune-cleanup endpoint records pending cleanup metadata
 */

// Must be set BEFORE any server/ imports so PGlite is used instead of Supabase
process.env.ASTRO_LOCAL_MODE = 'true'

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestServer, postJson, request, patchJson, db } from './helpers/test-server.js'
import { projects, planNodes, planEdges } from '../server/lib/db/schema.js'

let branchProjectId: string
let directProjectId: string

beforeAll(async () => {
  await setupTestServer()
})

beforeEach(async () => {
  // Clean plan data and projects between tests
  await db.delete(planEdges)
  await db.delete(planNodes)
  await db.delete(projects)
})

// ============================================================================
// Helper: create a project with a specific delivery mode
// ============================================================================

async function createProject(opts: { deliveryMode: string; discoveryMode?: boolean; name?: string }): Promise<string> {
  const res = await postJson('/api/data/projects', {
    name: opts.name ?? `Test Project (${opts.deliveryMode})`,
    description: 'Discovery pipeline E2E test',
    deliveryMode: opts.deliveryMode,
    ...(opts.discoveryMode !== undefined && { discoveryMode: opts.discoveryMode }),
  })
  expect(res.status).toBe(201)
  const body = await res.json()
  return body.id
}

async function createMilestoneNode(projectId: string, id: string, title: string): Promise<void> {
  const res = await postJson('/api/data/plan/nodes', {
    id,
    projectId,
    type: 'milestone',
    title,
    status: 'planned',
    position: { x: 0, y: 0 },
  })
  expect(res.status).toBe(201)
}

async function createTaskNode(
  projectId: string,
  id: string,
  title: string,
  opts?: { milestoneId?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const res = await postJson('/api/data/plan/nodes', {
    id,
    projectId,
    type: 'task',
    title,
    status: 'planned',
    position: { x: 0, y: 0 },
    milestoneId: opts?.milestoneId,
    metadata: opts?.metadata,
  })
  expect(res.status).toBe(201)
}

async function getNodeMetadata(projectId: string, nodeId: string): Promise<Record<string, unknown> | null> {
  const res = await request(`/api/data/plan/${projectId}`)
  expect(res.status).toBe(200)
  const plan = await res.json()
  const node = plan.nodes.find((n: { id: string }) => n.id === nodeId)
  return node?.metadata ?? null
}

// ============================================================================
// OutputDir Generation on Node Creation
// ============================================================================

describe('OutputDir generation — discovery mode projects', () => {
  beforeEach(async () => {
    branchProjectId = await createProject({ deliveryMode: 'direct', discoveryMode: true })
  })

  it('generates outputDir for a standalone task node', async () => {
    await createTaskNode(branchProjectId, 'task-1', 'Pathway enrichment analysis')
    const metadata = await getNodeMetadata(branchProjectId, 'task-1')
    expect(metadata).not.toBeNull()
    expect(metadata!.outputDir).toBe('pathway-enrichment-analysis')
  })

  it('generates milestone-prefixed outputDir for task under milestone', async () => {
    await createMilestoneNode(branchProjectId, 'ms-1', 'ESR1 Downstream Analysis')
    await createTaskNode(branchProjectId, 'task-under-ms', 'Pathway enrichment on ESR1-TP53 target genes', {
      milestoneId: 'ms-1',
    })
    const metadata = await getNodeMetadata(branchProjectId, 'task-under-ms')
    expect(metadata).not.toBeNull()
    expect(metadata!.outputDir).toBe('esr1-downstream-analysis/pathway-enrichment-on-esr1-tp53-target-genes')
  })

  it('always overwrites client-supplied outputDir with server-generated slug', async () => {
    await createTaskNode(branchProjectId, 'task-custom', 'Some task', {
      metadata: { outputDir: 'custom/path' },
    })
    const metadata = await getNodeMetadata(branchProjectId, 'task-custom')
    expect(metadata).not.toBeNull()
    // Server always generates outputDir from title, ignoring client-supplied value
    expect(metadata!.outputDir).toBe('some-task')
  })

  it('generates hyphenated slugs (not underscores)', async () => {
    await createTaskNode(branchProjectId, 'task-slug', 'Set up database schema')
    const metadata = await getNodeMetadata(branchProjectId, 'task-slug')
    expect(metadata!.outputDir).toBe('set-up-database-schema')
  })

  it('handles special characters in titles', async () => {
    await createTaskNode(branchProjectId, 'task-special', 'GO/KEGG/Reactome pathway enrichment')
    const metadata = await getNodeMetadata(branchProjectId, 'task-special')
    expect(metadata!.outputDir).toBe('go-kegg-reactome-pathway-enrichment')
  })

  it('generates unique outputDirs for different tasks', async () => {
    await createTaskNode(branchProjectId, 'task-a', 'Data preparation')
    await createTaskNode(branchProjectId, 'task-b', 'Statistical analysis')
    const metaA = await getNodeMetadata(branchProjectId, 'task-a')
    const metaB = await getNodeMetadata(branchProjectId, 'task-b')
    expect(metaA!.outputDir).not.toBe(metaB!.outputDir)
  })
})

describe('OutputDir generation — non-discovery projects', () => {
  it('does NOT generate outputDir for direct-delivery project', async () => {
    directProjectId = await createProject({ deliveryMode: 'direct' })
    await createTaskNode(directProjectId, 'task-direct', 'Some direct task')
    const metadata = await getNodeMetadata(directProjectId, 'task-direct')
    // metadata may exist but outputDir should not be set
    expect(metadata?.outputDir).toBeUndefined()
  })

  it('does NOT generate outputDir for pr-delivery project', async () => {
    const prProjectId = await createProject({ deliveryMode: 'pr' })
    await createTaskNode(prProjectId, 'task-pr', 'Some PR task')
    const metadata = await getNodeMetadata(prProjectId, 'task-pr')
    expect(metadata?.outputDir).toBeUndefined()
  })

  it('does NOT generate outputDir for branch-delivery without discoveryMode', async () => {
    const branchNonDiscovery = await createProject({ deliveryMode: 'branch' })
    await createTaskNode(branchNonDiscovery, 'task-branch', 'Some branch task')
    const metadata = await getNodeMetadata(branchNonDiscovery, 'task-branch')
    expect(metadata?.outputDir).toBeUndefined()
  })
})

describe('OutputDir generation — milestone nodes', () => {
  it('does NOT generate outputDir for milestone-type nodes', async () => {
    branchProjectId = await createProject({ deliveryMode: 'direct', discoveryMode: true })
    await createMilestoneNode(branchProjectId, 'ms-only', 'Big Milestone')
    const metadata = await getNodeMetadata(branchProjectId, 'ms-only')
    // Milestones should not have outputDir (only task nodes do)
    expect(metadata?.outputDir).toBeUndefined()
  })
})

// ============================================================================
// Prune Cleanup Endpoint
// ============================================================================

describe('POST /api/dispatch/prune-cleanup', () => {
  let projectId: string

  beforeEach(async () => {
    projectId = await createProject({ deliveryMode: 'direct', discoveryMode: true })
  })

  it('returns 400 for missing projectId', async () => {
    const res = await postJson('/api/dispatch/prune-cleanup', {
      nodeIds: ['some-id'],
      deleteBranches: true,
      deleteOutputs: true,
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing nodeIds', async () => {
    const res = await postJson('/api/dispatch/prune-cleanup', {
      projectId,
      nodeIds: [],
      deleteBranches: true,
      deleteOutputs: true,
    })
    expect(res.status).toBe(400)
  })

  it('records pendingCleanup metadata on nodes with outputDir', async () => {
    await createTaskNode(projectId, 'prune-task-1', 'Analysis task to prune')
    // Verify outputDir was generated
    const metaBefore = await getNodeMetadata(projectId, 'prune-task-1')
    expect(metaBefore!.outputDir).toBe('analysis-task-to-prune')

    // Call prune-cleanup
    const res = await postJson('/api/dispatch/prune-cleanup', {
      projectId,
      nodeIds: ['prune-task-1'],
      deleteBranches: false,
      deleteOutputs: true,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.cleanupItems).toBeGreaterThanOrEqual(1)

    // Verify pendingCleanup metadata was written
    const metaAfter = await getNodeMetadata(projectId, 'prune-task-1')
    expect(metaAfter!.pendingCleanup).toBeDefined()
    const cleanup = metaAfter!.pendingCleanup as Record<string, unknown>
    expect(cleanup.deleteOutputDir).toBe('analysis-task-to-prune')
    expect(cleanup.requestedAt).toBeDefined()
  })

  it('records branch cleanup when deleteBranches is true', async () => {
    await createTaskNode(projectId, 'branch-task', 'Task with branch')

    // Manually set a branchName on the node to simulate execution
    await patchJson('/api/data/plan/nodes/branch-task', {
      branchName: 'astro/test-branch-123',
    })

    const res = await postJson('/api/dispatch/prune-cleanup', {
      projectId,
      nodeIds: ['branch-task'],
      deleteBranches: true,
      deleteOutputs: false,
    })
    expect(res.status).toBe(200)

    const metaAfter = await getNodeMetadata(projectId, 'branch-task')
    expect(metaAfter!.pendingCleanup).toBeDefined()
    const cleanup = metaAfter!.pendingCleanup as Record<string, unknown>
    expect(cleanup.deleteBranch).toBe('astro/test-branch-123')
  })

  it('handles multiple nodes in a single request', async () => {
    await createTaskNode(projectId, 'multi-1', 'First task')
    await createTaskNode(projectId, 'multi-2', 'Second task')

    const res = await postJson('/api/dispatch/prune-cleanup', {
      projectId,
      nodeIds: ['multi-1', 'multi-2'],
      deleteBranches: false,
      deleteOutputs: true,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.cleanupItems).toBe(2)

    const meta1 = await getNodeMetadata(projectId, 'multi-1')
    const meta2 = await getNodeMetadata(projectId, 'multi-2')
    expect(meta1!.pendingCleanup).toBeDefined()
    expect(meta2!.pendingCleanup).toBeDefined()
  })

  it('succeeds with no-op for nodes without outputDir or branchName', async () => {
    // Create node on a direct project (no outputDir generated)
    const directId = await createProject({ deliveryMode: 'direct' })
    await createTaskNode(directId, 'noop-task', 'Task with nothing to clean')

    const res = await postJson('/api/dispatch/prune-cleanup', {
      projectId: directId,
      nodeIds: ['noop-task'],
      deleteBranches: true,
      deleteOutputs: true,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    // No pendingCleanup should be set (nothing to clean)
    const meta = await getNodeMetadata(directId, 'noop-task')
    expect(meta?.pendingCleanup).toBeUndefined()
  })
})

// ============================================================================
// Plan Retrieval with OutputDir Metadata
// ============================================================================

describe('GET /api/data/plan/:projectId — includes outputDir in metadata', () => {
  it('returns outputDir in node metadata for discovery projects', async () => {
    const pid = await createProject({ deliveryMode: 'direct', discoveryMode: true })
    await createMilestoneNode(pid, 'ms-get', 'Milestone Alpha')
    await createTaskNode(pid, 'task-get', 'Fetch ChIP-seq peaks', { milestoneId: 'ms-get' })

    const res = await request(`/api/data/plan/${pid}`)
    expect(res.status).toBe(200)
    const plan = await res.json()

    const taskNode = plan.nodes.find((n: { id: string }) => n.id === 'task-get')
    expect(taskNode).toBeDefined()
    expect(taskNode.metadata.outputDir).toBe('milestone-alpha/fetch-chip-seq-peaks')
  })
})

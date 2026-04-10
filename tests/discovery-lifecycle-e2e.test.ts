/**
 * Discovery Pipeline Full Lifecycle E2E Tests
 *
 * Tests the complete lifecycle of a real discovery project:
 * 1. Project creation with discoveryMode=true
 * 2. Milestone + task creation with auto-generated outputDirs
 * 3. Dependency chain: Task B depends on Task A
 * 4. Dispatch dry-run: verify prompt assembly includes discovery workspace,
 *    output dir, upstream dependency context, and _manifest.json instructions
 * 5. Task completion simulation → dependency output resolution for downstream tasks
 * 6. Prune/archive flow with metadata recording
 * 7. Soft-deleted nodes excluded from prune-cleanup
 */

// Must be set BEFORE any server/ imports so PGlite is used instead of Supabase
process.env.ASTRO_LOCAL_MODE = 'true'

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestServer, postJson, request, patchJson, db, LOCAL_USER_ID } from './helpers/test-server.js'
import {
  projects,
  planNodes,
  planEdges,
  taskExecutions,
} from '../server/lib/db/schema.js'
import { eq } from 'drizzle-orm'

beforeAll(async () => {
  await setupTestServer()
})

beforeEach(async () => {
  // Clean all test data between tests
  await db.delete(taskExecutions)
  await db.delete(planEdges)
  await db.delete(planNodes)
  await db.delete(projects)
})

// ============================================================================
// Helpers
// ============================================================================

async function createDiscoveryProject(opts?: {
  name?: string
  workingDirectory?: string
  visionDoc?: string
}): Promise<string> {
  const res = await postJson('/api/data/projects', {
    name: opts?.name ?? 'ESR1 Downstream Analysis',
    description: 'Full lifecycle discovery project',
    deliveryMode: 'direct',
    discoveryMode: true,
    workingDirectory: opts?.workingDirectory ?? '/home/user/projects/esr1-analysis',
    ...(opts?.visionDoc && { visionDoc: opts.visionDoc }),
  })
  expect(res.status).toBe(201)
  return (await res.json()).id
}

async function createMilestone(projectId: string, id: string, title: string): Promise<void> {
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

async function createTask(
  projectId: string,
  id: string,
  title: string,
  opts?: {
    milestoneId?: string
    description?: string
    content?: string
    status?: string
  },
): Promise<void> {
  const res = await postJson('/api/data/plan/nodes', {
    id,
    projectId,
    type: 'task',
    title,
    status: opts?.status ?? 'planned',
    position: { x: 0, y: 0 },
    milestoneId: opts?.milestoneId,
    description: opts?.description,
    content: opts?.content,
  })
  expect(res.status).toBe(201)
}

async function addEdge(projectId: string, edgeId: string, source: string, target: string): Promise<void> {
  const res = await postJson('/api/data/plan/edges', {
    id: edgeId,
    projectId,
    source,
    target,
    type: 'dependency',
  })
  expect(res.status).toBe(201)
}

async function simulateTaskCompletion(
  projectId: string,
  nodeId: string,
  opts: { executionOutput?: string; markdownSummary?: string },
): Promise<string> {
  const executionId = `exec-${nodeId}-${Date.now()}`

  // Create task execution record
  await db.insert(taskExecutions).values({
    executionId,
    nodeClientId: nodeId,
    projectId,
    userId: LOCAL_USER_ID,
    status: 'success',
    streamText: '',
    markdownSummary: opts.markdownSummary ?? null,
    startedAt: new Date(),
    completedAt: new Date(),
  })

  // Update plan node to completed with execution reference
  await patchJson(`/api/data/plan/nodes/${nodeId}`, {
    status: 'completed',
    executionId,
    executionOutput: opts.executionOutput ?? 'Task completed successfully.',
  })

  return executionId
}

async function getNodeMetadata(projectId: string, nodeId: string): Promise<Record<string, unknown> | null> {
  const res = await request(`/api/data/plan/${projectId}`)
  expect(res.status).toBe(200)
  const plan = await res.json()
  const node = plan.nodes.find((n: { id: string }) => n.id === nodeId)
  return node?.metadata ?? null
}

async function dispatchDryRun(
  projectId: string,
  nodeId: string,
  opts?: {
    workingDirectory?: string
    dependencies?: string[]
  },
): Promise<{
  success: boolean
  prompt: string
  systemPrompt?: string
  taskMeta?: Record<string, unknown>
}> {
  const res = await postJson('/api/dispatch/task', {
    nodeId,
    projectId,
    dryRun: true,
    ...(opts?.workingDirectory && { workingDirectory: opts.workingDirectory }),
    ...(opts?.dependencies && { dependencies: opts.dependencies }),
  })
  if (res.status !== 200) {
    const errorBody = await res.text()
    throw new Error(`Dispatch dry-run failed (${res.status}): ${errorBody}`)
  }
  return res.json()
}

// ============================================================================
// Full Lifecycle: Create → Dispatch → Complete → Downstream → Prune
// ============================================================================

describe('Discovery project full lifecycle', () => {
  let projectId: string
  const WORKING_DIR = '/home/user/projects/esr1-analysis'

  beforeEach(async () => {
    projectId = await createDiscoveryProject({
      workingDirectory: WORKING_DIR,
      visionDoc: 'Investigate ESR1 downstream signaling and co-binding partners in breast cancer.',
    })
  })

  it('Phase 1: project creation sets discoveryMode correctly', async () => {
    const res = await request(`/api/data/projects`)
    expect(res.status).toBe(200)
    const body = await res.json()
    const proj = body.find((p: { id: string }) => p.id === projectId)
    expect(proj).toBeDefined()
    expect(proj.discoveryMode).toBe(true)
    expect(proj.deliveryMode).toBe('direct')
  })

  it('Phase 2: milestone + tasks get correct outputDir hierarchy', async () => {
    await createMilestone(projectId, 'ms-esr1', 'ESR1 Downstream Analysis')
    await createTask(projectId, 'task-chipseq', 'Fetch ChIP-seq peaks for ESR1', {
      milestoneId: 'ms-esr1',
      description: 'Download and process ChIP-seq data from ENCODE',
    })
    await createTask(projectId, 'task-enrichment', 'GO/KEGG pathway enrichment on target genes', {
      milestoneId: 'ms-esr1',
    })
    // Standalone task (no milestone)
    await createTask(projectId, 'task-qc', 'Quality control pipeline')

    const chipMeta = await getNodeMetadata(projectId, 'task-chipseq')
    const enrichMeta = await getNodeMetadata(projectId, 'task-enrichment')
    const qcMeta = await getNodeMetadata(projectId, 'task-qc')

    // Tasks under milestone get milestone-slug/task-slug
    expect(chipMeta!.outputDir).toBe('esr1-downstream-analysis/fetch-chip-seq-peaks-for-esr1')
    expect(enrichMeta!.outputDir).toBe('esr1-downstream-analysis/go-kegg-pathway-enrichment-on-target-genes')
    // Standalone task gets just task-slug
    expect(qcMeta!.outputDir).toBe('quality-control-pipeline')
  })

  it('Phase 3: dispatch dry-run includes discovery workspace section', async () => {
    await createMilestone(projectId, 'ms-1', 'ChIP Analysis')
    await createTask(projectId, 'task-1', 'Peak calling with MACS2', {
      milestoneId: 'ms-1',
      description: 'Run MACS2 peak calling on ESR1 ChIP-seq data',
    })

    const result = await dispatchDryRun(projectId, 'task-1', {
      workingDirectory: WORKING_DIR,
    })

    expect(result.success).toBe(true)
    const prompt = result.prompt

    // Discovery mode instructions (from DISCOVERY_MODE_INSTRUCTIONS constant)
    expect(prompt).toContain('## Discovery Mode — Directory-Scoped Project')
    expect(prompt).toContain('analysis/')
    expect(prompt).toContain('_manifest.json')

    // Task-specific workspace section with concrete paths
    expect(prompt).toContain('## Your Task Workspace')
    expect(prompt).toContain(`${WORKING_DIR}/analysis/chip-analysis/peak-calling-with-macs2/`)

    // Task directory creation instruction
    expect(prompt).toContain('mkdir -p')

    // Discovery mode uses "## Your Task Workspace" (not separate "## Output Directory")
    // to avoid duplicate prompt sections
    expect(prompt).not.toContain('## Output Directory')

    // _manifest.json instruction (from DISCOVERY_MODE_INSTRUCTIONS)
    expect(prompt).toContain('_manifest.json')

    // .archived exclusion
    expect(prompt).toContain('.archived/')

    // Commit convention with task outputDir
    expect(prompt).toContain('[chip-analysis/peak-calling-with-macs2]')

    // Vision doc injected
    expect(prompt).toContain('ESR1 downstream signaling')
  })

  it('Phase 4: dispatch dry-run injects upstream dependency output paths', async () => {
    // Create upstream task (Task A)
    await createMilestone(projectId, 'ms-chip', 'ChIP-seq Analysis')
    await createTask(projectId, 'task-a', 'Fetch ESR1 ChIP-seq peaks', {
      milestoneId: 'ms-chip',
    })

    // Simulate Task A completion with output
    await simulateTaskCompletion(projectId, 'task-a', {
      markdownSummary: '## Results\nFound 12,847 ESR1 binding peaks. Output files:\n- peaks.narrowPeak\n- signal.bigWig',
    })

    // Create downstream task (Task B) that depends on Task A
    await createTask(projectId, 'task-b', 'Pathway enrichment on ESR1 targets', {
      milestoneId: 'ms-chip',
    })
    await addEdge(projectId, 'edge-a-b', 'task-a', 'task-b')

    // Dispatch Task B in dry-run
    const result = await dispatchDryRun(projectId, 'task-b', {
      workingDirectory: WORKING_DIR,
    })

    expect(result.success).toBe(true)
    const prompt = result.prompt

    // Previous task outputs section
    expect(prompt).toContain('## Previous Task Outputs')
    expect(prompt).toContain('Fetch ESR1 ChIP-seq peaks')
    expect(prompt).toContain('12,847 ESR1 binding peaks')

    // Output dir annotation on dependency output
    expect(prompt).toContain('analysis/chip-seq-analysis/fetch-esr1-chip-seq-peaks/')

    // Input data section with absolute paths
    expect(prompt).toContain('### Input Data (from upstream tasks)')
    expect(prompt).toContain(`${WORKING_DIR}/analysis/chip-seq-analysis/fetch-esr1-chip-seq-peaks/`)

    // Task B's own output directory
    expect(prompt).toContain(`${WORKING_DIR}/analysis/chip-seq-analysis/pathway-enrichment-on-esr1-targets/`)
  })

  it('Phase 5: non-discovery project dispatch does NOT include discovery workspace', async () => {
    // Create a non-discovery project
    const nonDiscoveryRes = await postJson('/api/data/projects', {
      name: 'Regular Project',
      description: 'Non-discovery project',
      deliveryMode: 'direct',
      workingDirectory: '/home/user/projects/regular',
    })
    expect(nonDiscoveryRes.status).toBe(201)
    const nonDiscPid = (await nonDiscoveryRes.json()).id

    await createTask(nonDiscPid, 'task-nd', 'Regular task', {
      description: 'A regular task with no discovery mode',
    })

    const result = await dispatchDryRun(nonDiscPid, 'task-nd', {
      workingDirectory: '/home/user/projects/regular',
    })

    expect(result.success).toBe(true)
    expect(result.prompt).not.toContain('## Discovery Mode — Directory-Scoped Project')
    expect(result.prompt).not.toContain('_manifest.json')
  })

  it('Phase 6: prune records cleanup metadata and excludes soft-deleted nodes', async () => {
    await createMilestone(projectId, 'ms-prune', 'Prunable Milestone')
    await createTask(projectId, 'task-prune-a', 'Analysis A (to prune)', {
      milestoneId: 'ms-prune',
    })
    await createTask(projectId, 'task-prune-b', 'Analysis B (to prune)', {
      milestoneId: 'ms-prune',
    })
    await createTask(projectId, 'task-deleted', 'Soft-deleted task', {
      milestoneId: 'ms-prune',
    })

    // Soft-delete one node
    await db.update(planNodes)
      .set({ deletedAt: new Date() })
      .where(eq(planNodes.clientId, 'task-deleted'))

    // Prune all three (including the soft-deleted one)
    const res = await postJson('/api/dispatch/prune-cleanup', {
      projectId,
      nodeIds: ['task-prune-a', 'task-prune-b', 'task-deleted'],
      deleteBranches: false,
      deleteOutputs: true,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    // Only 2 nodes should have cleanup metadata (soft-deleted excluded)
    expect(body.cleanupItems).toBe(2)

    const metaA = await getNodeMetadata(projectId, 'task-prune-a')
    expect(metaA!.pendingCleanup).toBeDefined()
    const cleanupA = metaA!.pendingCleanup as Record<string, unknown>
    expect(cleanupA.deleteOutputDir).toBe('prunable-milestone/analysis-a-to-prune')

    const metaB = await getNodeMetadata(projectId, 'task-prune-b')
    expect(metaB!.pendingCleanup).toBeDefined()
    const cleanupB = metaB!.pendingCleanup as Record<string, unknown>
    expect(cleanupB.deleteOutputDir).toBe('prunable-milestone/analysis-b-to-prune')
  })

  it('Phase 7: full chain — create → dispatch → complete → downstream dispatch → prune', async () => {
    // === Setup: milestone with two tasks in a dependency chain ===
    await createMilestone(projectId, 'ms-cobinding', 'Co-binding Analysis')

    await createTask(projectId, 'task-data-prep', 'Prepare ESR1-TP53 co-binding data', {
      milestoneId: 'ms-cobinding',
      description: 'Merge ESR1 and TP53 ChIP-seq peaks, annotate with gene symbols',
    })

    await createTask(projectId, 'task-motif', 'Motif analysis on co-bound regions', {
      milestoneId: 'ms-cobinding',
      description: 'Run HOMER/MEME on co-binding peaks to identify enriched motifs',
    })

    await addEdge(projectId, 'edge-prep-motif', 'task-data-prep', 'task-motif')

    // === Verify outputDirs ===
    const prepMeta = await getNodeMetadata(projectId, 'task-data-prep')
    const motifMeta = await getNodeMetadata(projectId, 'task-motif')
    expect(prepMeta!.outputDir).toBe('co-binding-analysis/prepare-esr1-tp53-co-binding-data')
    expect(motifMeta!.outputDir).toBe('co-binding-analysis/motif-analysis-on-co-bound-regions')

    // === Dispatch Task A (data prep) dry-run ===
    const dispatchA = await dispatchDryRun(projectId, 'task-data-prep', {
      workingDirectory: WORKING_DIR,
    })
    expect(dispatchA.success).toBe(true)
    expect(dispatchA.prompt).toContain('## Discovery Mode — Directory-Scoped Project')
    expect(dispatchA.prompt).toContain('co-binding-analysis/prepare-esr1-tp53-co-binding-data')
    // No upstream deps for first task
    expect(dispatchA.prompt).not.toContain('## Previous Task Outputs')

    // === Complete Task A ===
    await simulateTaskCompletion(projectId, 'task-data-prep', {
      markdownSummary: [
        '## Results',
        'Identified 3,247 ESR1-TP53 co-occupied regions.',
        '- `cobinding_peaks.bed` — merged peak file with 3,247 regions',
        '- `annotated_genes.tsv` — 1,892 unique gene symbols',
        '- `_manifest.json` — output registry',
      ].join('\n'),
    })

    // === Dispatch Task B (motif analysis) dry-run ===
    const dispatchB = await dispatchDryRun(projectId, 'task-motif', {
      workingDirectory: WORKING_DIR,
    })
    expect(dispatchB.success).toBe(true)
    const promptB = dispatchB.prompt

    // Task B workspace points to its own directory
    expect(promptB).toContain(`${WORKING_DIR}/analysis/co-binding-analysis/motif-analysis-on-co-bound-regions/`)

    // Task B sees Task A's output
    expect(promptB).toContain('## Previous Task Outputs')
    expect(promptB).toContain('Prepare ESR1-TP53 co-binding data')
    expect(promptB).toContain('3,247 ESR1-TP53 co-occupied regions')

    // Task B gets input data section with Task A's output dir
    expect(promptB).toContain('### Input Data (from upstream tasks)')
    expect(promptB).toContain(`${WORKING_DIR}/analysis/co-binding-analysis/prepare-esr1-tp53-co-binding-data/`)

    // === Prune the entire milestone ===
    const pruneRes = await postJson('/api/dispatch/prune-cleanup', {
      projectId,
      nodeIds: ['task-data-prep', 'task-motif'],
      deleteBranches: false,
      deleteOutputs: true,
    })
    expect(pruneRes.status).toBe(200)
    const pruneBody = await pruneRes.json()
    expect(pruneBody.success).toBe(true)
    expect(pruneBody.cleanupItems).toBe(2)

    // Both nodes have pendingCleanup with their respective outputDirs
    const prunedPrepMeta = await getNodeMetadata(projectId, 'task-data-prep')
    const prunedMotifMeta = await getNodeMetadata(projectId, 'task-motif')
    expect((prunedPrepMeta!.pendingCleanup as Record<string, unknown>).deleteOutputDir)
      .toBe('co-binding-analysis/prepare-esr1-tp53-co-binding-data')
    expect((prunedMotifMeta!.pendingCleanup as Record<string, unknown>).deleteOutputDir)
      .toBe('co-binding-analysis/motif-analysis-on-co-bound-regions')
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Discovery lifecycle edge cases', () => {
  let projectId: string

  beforeEach(async () => {
    projectId = await createDiscoveryProject()
  })

  it('task without workingDirectory still generates outputDir but dispatch skips workspace section', async () => {
    // Create project without workingDirectory
    const res = await postJson('/api/data/projects', {
      name: 'No WorkDir Project',
      description: 'Discovery project without workingDirectory',
      deliveryMode: 'direct',
      discoveryMode: true,
    })
    expect(res.status).toBe(201)
    const noWdPid = (await res.json()).id

    await createTask(noWdPid, 'task-nowd', 'Analysis without working dir')

    // outputDir should still be generated
    const meta = await getNodeMetadata(noWdPid, 'task-nowd')
    expect(meta!.outputDir).toBe('analysis-without-working-dir')

    // Dispatch dry-run — workspace section requires workingDirectory
    const dispatch = await dispatchDryRun(noWdPid, 'task-nowd')
    expect(dispatch.success).toBe(true)
    // No workspace section without workingDirectory
    expect(dispatch.prompt).not.toContain('## Workspace — Discovery Mode')
    // But outputDir section should still be present (relative path)
    expect(dispatch.prompt).toContain('analysis/analysis-without-working-dir/')
  })

  it('completed dependency without execution output contributes status-only to downstream', async () => {
    await createMilestone(projectId, 'ms-edge', 'Edge Case Milestone')
    await createTask(projectId, 'task-upstream', 'Upstream task', {
      milestoneId: 'ms-edge',
    })

    // Complete upstream without any execution output or markdown summary
    await patchJson('/api/data/plan/nodes/task-upstream', {
      status: 'completed',
    })

    await createTask(projectId, 'task-downstream', 'Downstream task', {
      milestoneId: 'ms-edge',
    })
    await addEdge(projectId, 'edge-upstream-downstream', 'task-upstream', 'task-downstream')

    const result = await dispatchDryRun(projectId, 'task-downstream', {
      workingDirectory: '/home/user/projects/esr1-analysis',
    })

    expect(result.success).toBe(true)
    // Should see the dependency with a status-only output
    expect(result.prompt).toContain('Upstream task')
    expect(result.prompt).toContain('[task completed]')
  })

  it('dispatch rejects task whose dependency is pruned (not completed)', async () => {
    await createMilestone(projectId, 'ms-pruned', 'Pruned Deps Test')
    await createTask(projectId, 'task-pruned-dep', 'Pruned upstream', {
      milestoneId: 'ms-pruned',
    })

    // Prune the upstream dependency
    await patchJson('/api/data/plan/nodes/task-pruned-dep', {
      status: 'pruned',
    })

    await createTask(projectId, 'task-after-prune', 'Task after pruned dep', {
      milestoneId: 'ms-pruned',
    })
    await addEdge(projectId, 'edge-pruned-after', 'task-pruned-dep', 'task-after-prune')

    const res = await postJson('/api/dispatch/task', {
      nodeId: 'task-after-prune',
      projectId,
      dryRun: true,
      workingDirectory: '/home/user/projects/esr1-analysis',
    })
    expect(res.status).toBe(200)
    const result = await res.json()

    // Dispatch should reject: pruned dependency is a pending (incomplete) dependency
    expect(result.success).toBe(false)
    expect(result.validationIssues).toBeDefined()
    expect(result.validationIssues[0]).toContain('task-pruned-dep')
  })

  it('multiple dependencies from different milestones are all included', async () => {
    await createMilestone(projectId, 'ms-alpha', 'Alpha Analysis')
    await createMilestone(projectId, 'ms-beta', 'Beta Analysis')

    await createTask(projectId, 'task-alpha-1', 'Alpha task result', {
      milestoneId: 'ms-alpha',
    })
    await createTask(projectId, 'task-beta-1', 'Beta task result', {
      milestoneId: 'ms-beta',
    })

    await simulateTaskCompletion(projectId, 'task-alpha-1', {
      markdownSummary: 'Alpha analysis found 500 significant genes.',
    })
    await simulateTaskCompletion(projectId, 'task-beta-1', {
      markdownSummary: 'Beta analysis identified 3 novel pathways.',
    })

    // Integrator task depends on both
    await createTask(projectId, 'task-integrate', 'Cross-analysis integration')
    await addEdge(projectId, 'edge-alpha-integrate', 'task-alpha-1', 'task-integrate')
    await addEdge(projectId, 'edge-beta-integrate', 'task-beta-1', 'task-integrate')

    const result = await dispatchDryRun(projectId, 'task-integrate', {
      workingDirectory: '/home/user/projects/esr1-analysis',
    })

    expect(result.success).toBe(true)
    const prompt = result.prompt

    // Both upstream outputs present
    expect(prompt).toContain('Alpha analysis found 500 significant genes')
    expect(prompt).toContain('Beta analysis identified 3 novel pathways')

    // Both output dirs referenced as input
    expect(prompt).toContain('alpha-analysis/alpha-task-result/')
    expect(prompt).toContain('beta-analysis/beta-task-result/')
  })
})

// ============================================================================
// Serial Execution: discovery mode allows parallel dispatch
// ============================================================================

describe('Discovery mode parallel dispatch', () => {
  it('allows concurrent dispatch for discovery projects (no serial execution block)', async () => {
    const pid = await createDiscoveryProject()

    // Create two independent tasks
    await createTask(pid, 'parallel-a', 'Analysis A')
    await createTask(pid, 'parallel-b', 'Analysis B')

    // Simulate task A as in-progress
    await patchJson('/api/data/plan/nodes/parallel-a', {
      status: 'in_progress',
    })

    // Dispatch task B — should NOT be blocked by serial execution check
    const res = await postJson('/api/dispatch/task', {
      nodeId: 'parallel-b',
      projectId: pid,
      dryRun: true,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    // Should succeed (not blocked by serial execution)
    expect(body.success).toBe(true)
    expect(body.dryRun).toBe(true)
  })

  it('blocks concurrent dispatch for non-discovery direct projects', async () => {
    const res = await postJson('/api/data/projects', {
      name: 'Non-Discovery Direct',
      description: 'Direct mode without discovery',
      deliveryMode: 'direct',
    })
    expect(res.status).toBe(201)
    const pid = (await res.json()).id

    await createTask(pid, 'serial-a', 'Task A')
    await createTask(pid, 'serial-b', 'Task B')

    // Simulate task A as in-progress
    await patchJson('/api/data/plan/nodes/serial-a', {
      status: 'in_progress',
    })

    // Dispatch task B — should be blocked
    const dispatchRes = await postJson('/api/dispatch/task', {
      nodeId: 'serial-b',
      projectId: pid,
      deliveryMode: 'direct',
    })
    expect(dispatchRes.status).toBe(409)
    const body = await dispatchRes.json()
    expect(body.error).toContain('Serial execution required')
  })
})

// ============================================================================
// Discovery mode enforces deliveryMode: 'direct'
// ============================================================================

describe('Discovery mode delivery mode enforcement', () => {
  it('forces deliveryMode to direct when creating a discovery project', async () => {
    const res = await postJson('/api/data/projects', {
      name: 'Discovery with PR attempt',
      description: 'Tries to set pr delivery',
      deliveryMode: 'pr',
      discoveryMode: true,
    })
    expect(res.status).toBe(201)
    const pid = (await res.json()).id

    // Should have been overridden to 'direct'
    const projRes = await request(`/api/data/projects`)
    const projects = await projRes.json()
    const proj = projects.find((p: { id: string }) => p.id === pid)
    expect(proj.deliveryMode).toBe('direct')
    expect(proj.discoveryMode).toBe(true)
  })

  it('forces deliveryMode to direct when enabling discovery on existing project', async () => {
    const res = await postJson('/api/data/projects', {
      name: 'Project to convert',
      description: 'Will become discovery',
      deliveryMode: 'pr',
    })
    expect(res.status).toBe(201)
    const pid = (await res.json()).id

    // Enable discovery mode via PATCH
    await patchJson(`/api/data/projects/${pid}`, {
      discoveryMode: true,
    })

    const projRes = await request(`/api/data/projects`)
    const projects = await projRes.json()
    const proj = projects.find((p: { id: string }) => p.id === pid)
    expect(proj.deliveryMode).toBe('direct')
    expect(proj.discoveryMode).toBe(true)
  })
})

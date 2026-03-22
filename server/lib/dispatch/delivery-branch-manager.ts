/**
 * Delivery Branch Manager
 *
 * Manages the lifecycle of delivery branches — per-connected-component
 * accumulation branches that each produce their own PR to the base branch.
 *
 * Replaces the single project-level accumulation branch model.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { eq, and, isNull, inArray, sql } from 'drizzle-orm'
import { deliveryBranches, planNodes, planEdges } from '../db/schema.js'
import type { PlanNode, PlanEdge, DeliveryBranch } from '../../../packages/core/src/types.js'
import {
  computeConnectedComponents,
  detectStructuralChanges,
  type DeliveryBranchRecord,
} from '../../../packages/core/src/dispatch/connected-components.js'

/** Short ID from a UUID: first 8 hex chars after stripping hyphens. */
function getShortUUID(uuid: string): string {
  return uuid.replace(/-/g, '').slice(0, 8)
}

/** Batch-update plan_nodes to set deliveryBranchId for a list of node client IDs. */
async function assignBranchToNodes(
  tx: any,
  projectId: string,
  branchId: string,
  nodeIds: string[],
): Promise<void> {
  if (nodeIds.length === 0) return
  await tx.update(planNodes)
    .set({ deliveryBranchId: branchId, updatedAt: new Date() })
    .where(and(
      eq(planNodes.projectId, projectId),
      inArray(planNodes.clientId, nodeIds),
    ))
}

/**
 * Ensure delivery branches exist for a project.
 * If no delivery branches have been assigned yet, compute connected components
 * and create delivery branch records for each component.
 *
 * @param db - Drizzle database instance
 * @param projectId - Project UUID
 * @param shortProjectId - Short project ID (first 6 hex chars)
 * @returns Array of active delivery branches
 */
export async function ensureDeliveryBranches(
  db: any,
  projectId: string,
  shortProjectId: string,
): Promise<DeliveryBranch[]> {
  // Everything inside a transaction with advisory lock to prevent concurrent
  // dispatches from creating duplicate branch sets (TOCTOU race).
  return await db.transaction(async (tx: any) => {
    // Advisory lock scoped to this project — serializes concurrent calls
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`delivery-branches:${projectId}`}))`)

    // Check for existing active delivery branches (now race-free)
    const existing = await tx.select().from(deliveryBranches).where(
      and(
        eq(deliveryBranches.projectId, projectId),
        isNull(deliveryBranches.deletedAt),
        inArray(deliveryBranches.status, ['active', 'pr_created']),
      )
    )

    if (existing.length > 0) {
      return existing.map(rowToDeliveryBranch)
    }

    // No delivery branches yet — compute connected components from the plan graph
    const nodeRows = await tx.select().from(planNodes).where(
      and(eq(planNodes.projectId, projectId), isNull(planNodes.deletedAt))
    )
    const edgeRows = await tx.select().from(planEdges).where(
      and(eq(planEdges.projectId, projectId), isNull(planEdges.deletedAt))
    )

    const nodes: PlanNode[] = nodeRows.map(dbNodeToPlanNode)
    const edges: PlanEdge[] = edgeRows.map(dbEdgeToPlanEdge)

    const components = computeConnectedComponents(nodes, edges)

    if (components.length === 0) return []

    const branches: DeliveryBranch[] = []

    for (const comp of components) {
      const branchId = crypto.randomUUID()
      const shortDeliveryId = getShortUUID(branchId)
      const branchName = `astro/${shortProjectId}-${shortDeliveryId}`

      const [row] = await tx.insert(deliveryBranches).values({
        id: branchId,
        projectId,
        branchName,
        isSingleton: comp.isSingleton,
        nodeIds: comp.nodeIds,
        status: 'active',
      }).returning()

      await assignBranchToNodes(tx, projectId, branchId, comp.nodeIds)

      branches.push(rowToDeliveryBranch(row))
    }

    return branches
  })
}

/**
 * Get the delivery branch for a specific task node.
 *
 * @param db - Drizzle database instance
 * @param projectId - Project UUID
 * @param nodeClientId - Plan node client ID
 * @param shortProjectId - Short project ID for branch naming
 * @returns Delivery branch record, or null if not assigned
 */
export async function getDeliveryBranchForNode(
  db: any,
  projectId: string,
  nodeClientId: string,
  shortProjectId: string,
): Promise<DeliveryBranch | null> {
  // First try: look up via plan_nodes.delivery_branch_id
  const [nodeRow] = await db.select({ deliveryBranchId: planNodes.deliveryBranchId })
    .from(planNodes)
    .where(and(
      eq(planNodes.projectId, projectId),
      eq(planNodes.clientId, nodeClientId),
    ))
    .limit(1)

  if (nodeRow?.deliveryBranchId) {
    const [branchRow] = await db.select().from(deliveryBranches)
      .where(eq(deliveryBranches.id, nodeRow.deliveryBranchId))
      .limit(1)
    if (branchRow) return rowToDeliveryBranch(branchRow)
  }

  // Fallback: ensure delivery branches exist, then look up again
  const branches = await ensureDeliveryBranches(db, projectId, shortProjectId)

  // Find the branch that contains this node
  for (const branch of branches) {
    if (branch.nodeIds.includes(nodeClientId)) {
      return branch
    }
  }

  return null
}

/**
 * Mark a delivery branch as obsolete (used during re-plan restarts).
 */
export async function markDeliveryBranchObsolete(
  db: any,
  branchId: string,
): Promise<void> {
  await db.update(deliveryBranches)
    .set({ status: 'obsolete', updatedAt: new Date() })
    .where(eq(deliveryBranches.id, branchId))
}

/**
 * Update delivery branch PR info after component completion.
 */
export async function updateDeliveryBranchPr(
  db: any,
  branchId: string,
  prUrl: string,
  prNumber: number,
): Promise<void> {
  await db.update(deliveryBranches)
    .set({ prUrl, prNumber, status: 'pr_created', updatedAt: new Date() })
    .where(eq(deliveryBranches.id, branchId))
}

/**
 * Check if all executable tasks in a delivery branch's component are complete.
 */
export async function isComponentComplete(
  db: any,
  branchId: string,
): Promise<boolean> {
  // Transaction ensures consistent read of branch + its nodes (no TOCTOU race
  // where a task completes between the two queries).
  return await db.transaction(async (tx: any) => {
    const [branch] = await tx.select().from(deliveryBranches)
      .where(eq(deliveryBranches.id, branchId))
      .limit(1)

    if (!branch || branch.status !== 'active') return false

    const completedStatuses = ['completed', 'auto_verified']
    const nodeRows = await tx.select({ status: planNodes.status, type: planNodes.type })
      .from(planNodes)
      .where(and(
        eq(planNodes.deliveryBranchId, branchId),
        isNull(planNodes.deletedAt),
      ))

    // Check if all task nodes (not milestones/branches) are complete.
    // Pruned tasks are excluded — pruning sets status='pruned' but NOT deletedAt,
    // so they'd otherwise block completion forever.
    // If no active task nodes remain (all deleted or pruned), the component is vacuously complete.
    const taskRows = nodeRows.filter((r: any) => r.type === 'task' && r.status !== 'pruned')
    if (taskRows.length === 0) return true

    return taskRows.every((r: any) => completedStatuses.includes(r.status))
  })
}

/**
 * Run the delivery branch reconciliation after a re-plan.
 * Returns structured log messages for the plan chat.
 */
export async function reconcileAfterReplan(
  db: any,
  projectId: string,
  shortProjectId: string,
): Promise<{
  messages: string[]
  requiresRestart: boolean
  restartedBranches: string[]
  newBranches: string[]
}> {
  // All reads and mutations inside a single transaction with advisory lock
  // to prevent TOCTOU races with concurrent re-plans.
  const messages: string[] = []
  const restartedBranches: string[] = []
  const newBranches: string[] = []

  await db.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`delivery-branches:${projectId}`}))`)

    const existingRows = await tx.select().from(deliveryBranches).where(
      and(
        eq(deliveryBranches.projectId, projectId),
        isNull(deliveryBranches.deletedAt),
        inArray(deliveryBranches.status, ['active', 'pr_created']),
      )
    )
    const existingRecords: DeliveryBranchRecord[] = existingRows.map((r: any) => ({
      id: r.id,
      branchName: r.branchName,
      nodeIds: r.nodeIds ?? [],
      isSingleton: r.isSingleton,
      status: r.status,
    }))

    const nodeRows = await tx.select().from(planNodes).where(
      and(eq(planNodes.projectId, projectId), isNull(planNodes.deletedAt))
    )
    const edgeRows = await tx.select().from(planEdges).where(
      and(eq(planEdges.projectId, projectId), isNull(planEdges.deletedAt))
    )
    const nodes: PlanNode[] = nodeRows.map(dbNodeToPlanNode)
    const edges: PlanEdge[] = edgeRows.map(dbEdgeToPlanEdge)

    const reconciliation = detectStructuralChanges(nodes, edges, existingRecords)

    // Handle restarts
    for (const restart of reconciliation.restart) {
      messages.push(`-- Delivery branch restructuring required (${restart.reason}) --`)

      for (const branch of restart.affectedBranches) {
        messages.push(`Closing delivery branch ${branch.branchName} (${branch.nodeIds.length} tasks)`)
        await tx.update(deliveryBranches)
          .set({ status: 'obsolete', updatedAt: new Date() })
          .where(eq(deliveryBranches.id, branch.id))
        restartedBranches.push(branch.branchName)

        // Batch-reset all tasks on this branch to 'planned'
        if (branch.nodeIds.length > 0) {
          await tx.update(planNodes)
            .set({
              status: 'planned',
              deliveryBranchId: null,
              executionId: null,
              executionOutput: null,
              executionError: null,
              executionStartedAt: null,
              executionCompletedAt: null,
              branchName: null,
              prUrl: null,
              prNumber: null,
              commitBeforeSha: null,
              commitAfterSha: null,
              updatedAt: new Date(),
            })
            .where(and(
              eq(planNodes.projectId, projectId),
              inArray(planNodes.clientId, branch.nodeIds),
            ))
        }
      }

      // Create new delivery branches for the restructured components
      for (const comp of restart.newComponents) {
        const branchId = crypto.randomUUID()
        const shortDeliveryId = getShortUUID(branchId)
        const branchName = `astro/${shortProjectId}-${shortDeliveryId}`

        await tx.insert(deliveryBranches).values({
          id: branchId,
          projectId,
          branchName,
          isSingleton: comp.isSingleton,
          nodeIds: comp.nodeIds,
          status: 'active',
        })

        await assignBranchToNodes(tx, projectId, branchId, comp.nodeIds)

        newBranches.push(branchName)
        messages.push(`Created delivery branch ${branchName} (${comp.taskIds.length} tasks, ${comp.isSingleton ? 'singleton' : 'multi-task'})`)
      }
    }

    // Handle new components (no restart needed)
    for (const entry of reconciliation.create) {
      const branchId = crypto.randomUUID()
      const shortDeliveryId = getShortUUID(branchId)
      const branchName = `astro/${shortProjectId}-${shortDeliveryId}`

      await tx.insert(deliveryBranches).values({
        id: branchId,
        projectId,
        branchName,
        isSingleton: entry.component.isSingleton,
        nodeIds: entry.component.nodeIds,
        status: 'active',
      })

      await assignBranchToNodes(tx, projectId, branchId, entry.component.nodeIds)

      newBranches.push(branchName)
      messages.push(`Created delivery branch ${branchName} (${entry.component.taskIds.length} tasks, ${entry.component.isSingleton ? 'singleton' : 'multi-task'})`)
    }

    // Handle kept branches (update node lists + assign new nodes)
    const keptBranchIds = new Set(reconciliation.keep.map((e) => e.branch.id))
    for (const entry of reconciliation.keep) {
      await tx.update(deliveryBranches)
        .set({ nodeIds: entry.newNodeIds, updatedAt: new Date() })
        .where(eq(deliveryBranches.id, entry.branch.id))

      // Find nodes that are new to this branch and set their deliveryBranchId
      const addedNodeIds = entry.newNodeIds.filter(
        (id) => !entry.branch.nodeIds.includes(id)
      )
      if (addedNodeIds.length > 0) {
        await assignBranchToNodes(tx, projectId, entry.branch.id, addedNodeIds)
      }
    }

    // Mark orphan branches as obsolete — these are active branches that were
    // neither kept, restarted, nor claimed by any new component (e.g., when
    // two unexecuted branches merge and only one gets claimed).
    const restartBranchIds = new Set<string>()
    for (const restart of reconciliation.restart) {
      for (const b of restart.affectedBranches) restartBranchIds.add(b.id)
    }
    for (const branch of existingRecords) {
      if (!keptBranchIds.has(branch.id) && !restartBranchIds.has(branch.id)) {
        await tx.update(deliveryBranches)
          .set({ status: 'obsolete', updatedAt: new Date() })
          .where(eq(deliveryBranches.id, branch.id))
        messages.push(`Obsoleted orphan delivery branch ${branch.branchName}`)
      }
    }
  })

  return {
    messages,
    requiresRestart: restartedBranches.length > 0,
    restartedBranches,
    newBranches,
  }
}

// ── Row conversion helpers ───────────────────────────────────────────

function rowToDeliveryBranch(row: any): DeliveryBranch {
  return {
    id: row.id,
    projectId: row.projectId,
    branchName: row.branchName,
    isSingleton: row.isSingleton,
    nodeIds: row.nodeIds ?? [],
    prUrl: row.prUrl ?? undefined,
    prNumber: row.prNumber ?? undefined,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function dbNodeToPlanNode(row: any): PlanNode {
  return {
    id: row.clientId,
    number: row.number,
    projectId: row.projectId,
    type: row.type,
    title: row.title,
    description: row.description,
    status: row.status,
    parentId: row.parentId,
    // NOTE: dependencies are in the plan_node_dependencies junction table, not on plan_nodes directly.
    // This field will always be []. Connectivity relies on plan_edges, which covers the same ground.
    dependencies: [],
    verification: row.verification ?? 'auto',
    position: { x: row.positionX ?? 0, y: row.positionY ?? 0 },
    milestoneId: row.milestoneId,
    deliveryBranchId: row.deliveryBranchId,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as PlanNode
}

function dbEdgeToPlanEdge(row: any): PlanEdge {
  return {
    id: row.clientId ?? row.id,
    source: row.sourceClientId,
    target: row.targetClientId,
    type: row.type,
    deletedAt: row.deletedAt,
  }
}

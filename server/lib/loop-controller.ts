/**
 * Loop Controller
 *
 * Manages the iterate/evaluate/decide cycle for loop nodes.
 * A loop node is a single DAG node that internally runs repeated
 * dispatch/evaluate/decide iterations, inspired by autoresearch.
 *
 * The controller is stateless — it is invoked at two points:
 * 1. When a loop node is initially dispatched (starts iteration 1)
 * 2. When a loop node's iteration completes (called from onResult in dispatch.ts)
 *
 * All state lives in the database (plan_nodes + loop_iterations tables).
 */

import { db } from './db/index.js'
import { planNodes, loopIterations } from './db/schema.js'
import { eq, and } from 'drizzle-orm'
import { serverSideDispatch } from './server-side-dispatch.js'
import { autoDispatchDownstream } from '../routes/data.js'
import type { LoopConfig, LoopIteration } from '../../packages/core/src/types.js'

// ── Public API ───────────────────────────────────────────────────────

/**
 * Start a loop: creates iteration #1 record and dispatches it.
 * Called when autoDispatchDownstream finds a ready loop node.
 */
export async function startLoop(nodeId: string, projectId: string): Promise<void> {
  const [node] = await db.select({
    loopConfig: planNodes.loopConfig,
    loopStatus: planNodes.loopStatus,
    status: planNodes.status,
  }).from(planNodes)
    .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))
    .limit(1)

  if (!node?.loopConfig) {
    console.error(`[loop] Cannot start loop: node ${nodeId} has no loopConfig`)
    return
  }

  if (node.loopStatus === 'iterating') {
    console.log(`[loop] Loop ${nodeId} is already iterating, skipping start`)
    return
  }

  console.log(`[loop] Starting loop for node ${nodeId} (max ${node.loopConfig.maxIterations} iterations)`)

  // Initialize loop state on the node
  await db.update(planNodes)
    .set({
      loopStatus: 'iterating',
      loopCurrentIteration: 0,
      loopBestMetricValue: null,
      loopBestIteration: null,
      updatedAt: new Date(),
    })
    .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))

  // Dispatch the first iteration
  await dispatchNextIteration(nodeId, projectId, node.loopConfig as LoopConfig, 1)
}

/**
 * Advance a loop: called when an iteration completes.
 * Evaluates metric, records keep/discard, checks stop condition,
 * then either dispatches next iteration or marks loop as completed.
 */
export async function advanceLoop(
  nodeId: string,
  projectId: string,
  iterationResult: {
    executionId: string
    output?: string
    status: 'success' | 'failure'
    branchName?: string
    diff?: string
  }
): Promise<void> {
  const [node] = await db.select({
    loopConfig: planNodes.loopConfig,
    loopCurrentIteration: planNodes.loopCurrentIteration,
    loopBestMetricValue: planNodes.loopBestMetricValue,
    loopBestIteration: planNodes.loopBestIteration,
    loopStatus: planNodes.loopStatus,
  }).from(planNodes)
    .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))
    .limit(1)

  if (!node?.loopConfig || node.loopStatus !== 'iterating') {
    console.log(`[loop] advanceLoop called for non-iterating node ${nodeId}, skipping`)
    return
  }

  const loopConfig = node.loopConfig as LoopConfig
  const currentIteration = (node.loopCurrentIteration ?? 0) + 1

  // Extract metric from execution output
  const metricValue = extractMetric(iterationResult.output ?? '', loopConfig)

  // Determine keep/discard
  let iterationStatus: 'keep' | 'discard' | 'crash'
  if (iterationResult.status === 'failure') {
    iterationStatus = 'crash'
  } else if (metricValue == null) {
    // No metric found — treat as keep for iteration 1 (baseline), discard otherwise
    iterationStatus = currentIteration === 1 ? 'keep' : 'discard'
  } else if (node.loopBestMetricValue == null) {
    // First metric ever — always keep (baseline)
    iterationStatus = 'keep'
  } else {
    const direction = loopConfig.stopCondition?.direction ?? 'minimize'
    const improved = direction === 'minimize'
      ? metricValue < node.loopBestMetricValue
      : metricValue > node.loopBestMetricValue
    iterationStatus = improved ? 'keep' : 'discard'
  }

  // Extract description from output (look for a summary line)
  const description = extractDescription(iterationResult.output ?? '', currentIteration)

  // Update the existing 'running' iteration record (created by dispatchNextIteration)
  const [runningRecord] = await db.select({ id: loopIterations.id })
    .from(loopIterations)
    .where(and(
      eq(loopIterations.nodeId, nodeId),
      eq(loopIterations.projectId, projectId),
      eq(loopIterations.iteration, currentIteration),
      eq(loopIterations.status, 'running'),
    ))
    .limit(1)

  if (runningRecord) {
    await db.update(loopIterations)
      .set({
        executionId: iterationResult.executionId,
        metricValue,
        metricName: loopConfig.stopCondition?.metric,
        status: iterationStatus,
        description,
        diff: iterationResult.diff,
        completedAt: new Date(),
      })
      .where(eq(loopIterations.id, runningRecord.id))
  } else {
    // Fallback: insert if no running record found (shouldn't happen in normal flow)
    await db.insert(loopIterations).values({
      nodeId,
      projectId,
      iteration: currentIteration,
      executionId: iterationResult.executionId,
      metricValue,
      metricName: loopConfig.stopCondition?.metric,
      status: iterationStatus,
      description,
      diff: iterationResult.diff,
      completedAt: new Date(),
    })
  }

  // Update best if improved
  const newBestValue = iterationStatus === 'keep' && metricValue != null
    ? metricValue
    : node.loopBestMetricValue
  const newBestIteration = iterationStatus === 'keep' && metricValue != null
    ? currentIteration
    : node.loopBestIteration

  // Update node loop state
  await db.update(planNodes)
    .set({
      loopCurrentIteration: currentIteration,
      loopBestMetricValue: newBestValue,
      loopBestIteration: newBestIteration,
      updatedAt: new Date(),
    })
    .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))

  console.log(`[loop] Iteration ${currentIteration} for ${nodeId}: ${iterationStatus} (metric=${metricValue ?? 'N/A'}, best=${newBestValue ?? 'N/A'})`)

  // Check stop conditions
  const allIterations = await db.select()
    .from(loopIterations)
    .where(and(eq(loopIterations.nodeId, nodeId), eq(loopIterations.projectId, projectId)))
    .orderBy(loopIterations.iteration)

  const stopResult = shouldStopLoop(loopConfig, currentIteration, metricValue, allIterations)

  if (stopResult.stop) {
    console.log(`[loop] Stopping loop ${nodeId}: ${stopResult.reason}`)
    await completeLoop(nodeId, projectId, stopResult.reason)
  } else {
    // Reset node execution state and dispatch next iteration
    await dispatchNextIteration(nodeId, projectId, loopConfig, currentIteration + 1)
  }
}

/**
 * Stop a loop early (human interrupt).
 */
export async function stopLoop(nodeId: string, projectId: string): Promise<void> {
  // Mark any running iteration as aborted
  const [runningIter] = await db.select({ id: loopIterations.id })
    .from(loopIterations)
    .where(and(
      eq(loopIterations.nodeId, nodeId),
      eq(loopIterations.projectId, projectId),
      eq(loopIterations.status, 'running'),
    ))
    .limit(1)

  if (runningIter) {
    await db.update(loopIterations)
      .set({ status: 'aborted', completedAt: new Date() })
      .where(eq(loopIterations.id, runningIter.id))
  }

  await completeLoop(nodeId, projectId, 'Stopped by user')
}

/**
 * Build iteration context for injection into the agent prompt.
 */
export function buildIterationContext(
  loopConfig: LoopConfig,
  iterations: LoopIteration[],
  currentIteration: number,
): string {
  const parts: string[] = []
  const metricName = loopConfig.stopCondition?.metric ?? 'metric'

  parts.push(`## Loop Iteration Context (auto-generated)`)
  parts.push(`You are on iteration ${currentIteration} of an optimization loop (max: ${loopConfig.maxIterations}).`)

  // Best so far
  const keeps = iterations.filter(i => i.status === 'keep' && i.metricValue != null)
  if (keeps.length > 0) {
    const direction = loopConfig.stopCondition?.direction ?? 'minimize'
    const best = direction === 'minimize'
      ? keeps.reduce((a, b) => (a.metricValue! < b.metricValue!) ? a : b)
      : keeps.reduce((a, b) => (a.metricValue! > b.metricValue!) ? a : b)
    parts.push(`### Best so far\n${metricName}: ${best.metricValue} (iteration ${best.iteration}: ${best.description ?? 'no description'})`)
  }

  // Recent history (last 20 iterations to keep context manageable)
  const recent = iterations.slice(-20)
  if (recent.length > 0) {
    const header = `### Recent history (last ${recent.length})\n| Iter | ${metricName} | Status | Description |`
    const separator = `|------|--------|---------|-------------|`
    const rows = recent.map(i =>
      `| ${i.iteration} | ${i.metricValue ?? 'N/A'} | ${i.status} | ${i.description ?? ''} |`
    )
    parts.push([header, separator, ...rows].join('\n'))
  }

  // Task template
  parts.push(`### Your task\n${loopConfig.taskTemplate}`)

  return parts.join('\n\n')
}

/**
 * Get all iterations for a loop node.
 */
export async function getLoopIterations(nodeId: string, projectId: string): Promise<LoopIteration[]> {
  const rows = await db.select()
    .from(loopIterations)
    .where(and(eq(loopIterations.nodeId, nodeId), eq(loopIterations.projectId, projectId)))
    .orderBy(loopIterations.iteration)

  return rows.map(r => ({
    id: r.id,
    nodeId: r.nodeId,
    projectId: r.projectId,
    iteration: r.iteration,
    executionId: r.executionId ?? undefined,
    metricValue: r.metricValue ?? undefined,
    metricName: r.metricName ?? undefined,
    status: r.status as LoopIteration['status'],
    description: r.description ?? undefined,
    diff: r.diff ?? undefined,
    createdAt: r.createdAt,
    completedAt: r.completedAt ?? undefined,
  }))
}

// ── Internal Helpers ─────────────────────────────────────────────────

async function dispatchNextIteration(
  nodeId: string,
  projectId: string,
  loopConfig: LoopConfig,
  nextIteration: number,
): Promise<void> {
  // Create a 'running' iteration record
  await db.insert(loopIterations).values({
    nodeId,
    projectId,
    iteration: nextIteration,
    metricName: loopConfig.stopCondition?.metric,
    status: 'running',
  })

  // Reset node execution state so it can be re-dispatched
  await db.update(planNodes)
    .set({
      status: 'planned',
      executionId: null,
      executionOutput: null,
      executionError: null,
      executionStartedAt: null,
      executionCompletedAt: null,
      loopCurrentIteration: nextIteration,
      updatedAt: new Date(),
    })
    .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))

  // Dispatch via the standard server-side dispatch mechanism
  console.log(`[loop] Dispatching iteration ${nextIteration} for ${nodeId}`)
  serverSideDispatch(nodeId, projectId).catch(err => {
    console.error(`[loop] Failed to dispatch iteration ${nextIteration} for ${nodeId}:`, err)
  })
}

async function completeLoop(nodeId: string, projectId: string, reason: string): Promise<void> {
  // Build a summary of the loop results
  const allIters = await db.select()
    .from(loopIterations)
    .where(and(eq(loopIterations.nodeId, nodeId), eq(loopIterations.projectId, projectId)))
    .orderBy(loopIterations.iteration)

  const keeps = allIters.filter(i => i.status === 'keep')
  const discards = allIters.filter(i => i.status === 'discard')
  const crashes = allIters.filter(i => i.status === 'crash')

  const summary = [
    `Loop completed: ${reason}`,
    `Total iterations: ${allIters.length}`,
    `Kept: ${keeps.length}, Discarded: ${discards.length}, Crashed: ${crashes.length}`,
  ]

  const bestKeep = keeps.filter(i => i.metricValue != null)
  if (bestKeep.length > 0) {
    // Read loopConfig to determine direction
    const [loopNode] = await db.select({ loopConfig: planNodes.loopConfig })
      .from(planNodes)
      .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))
      .limit(1)
    const direction = (loopNode?.loopConfig as LoopConfig | null)?.stopCondition?.direction ?? 'minimize'
    const best = direction === 'minimize'
      ? bestKeep.reduce((a, b) => (a.metricValue! < b.metricValue!) ? a : b)
      : bestKeep.reduce((a, b) => (a.metricValue! > b.metricValue!) ? a : b)
    summary.push(`Best metric: ${best.metricValue} (iteration ${best.iteration})`)
  }

  // Mark loop as completed
  await db.update(planNodes)
    .set({
      status: 'auto_verified',
      loopStatus: 'stopped',
      executionOutput: summary.join('\n'),
      executionCompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))

  console.log(`[loop] Loop ${nodeId} completed. ${summary.join(', ')}`)

  // Trigger downstream task dispatch
  autoDispatchDownstream(projectId, nodeId).catch(err => {
    console.error(`[loop] Auto-dispatch downstream failed after loop completion:`, err)
  })
}

/**
 * Extract a numeric metric from execution output.
 * Searches for patterns like "metric_name: 0.997" or "metric_name: 0.997\n".
 */
function extractMetric(output: string, loopConfig: LoopConfig): number | null {
  const metricName = loopConfig.stopCondition?.metric
  if (!metricName) return null

  // Look for "metric_name:  value" pattern (common in training logs)
  const regex = new RegExp(`${escapeRegex(metricName)}[:\\s]+([\\d.eE+-]+)`, 'i')
  const match = output.match(regex)
  if (match) {
    const parsed = parseFloat(match[1])
    if (!isNaN(parsed)) return parsed
  }

  // Try JSON parsing as fallback
  try {
    const jsonMatches = output.match(/\{[^{}]*\}/g)
    if (jsonMatches) {
      for (const jsonStr of jsonMatches) {
        const parsed = JSON.parse(jsonStr)
        if (typeof parsed[metricName] === 'number') return parsed[metricName]
      }
    }
  } catch { /* not JSON */ }

  return null
}

/**
 * Extract a description/summary from the execution output.
 */
function extractDescription(output: string, iteration: number): string {
  // Look for a line starting with "description:" or "experiment:"
  const descMatch = output.match(/(?:description|experiment|change|summary):\s*(.+)/i)
  if (descMatch) return descMatch[1].trim().slice(0, 200)

  // Default
  return `Iteration ${iteration}`
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Evaluate whether a loop should stop.
 */
function shouldStopLoop(
  loopConfig: LoopConfig,
  currentIteration: number,
  metricValue: number | null,
  iterations: Array<{ status: string; metricValue: number | null }>,
): { stop: boolean; reason: string } {
  // 1. Max iterations
  if (currentIteration >= loopConfig.maxIterations) {
    return { stop: true, reason: `Reached max iterations (${loopConfig.maxIterations})` }
  }

  if (!loopConfig.stopCondition) return { stop: false, reason: '' }

  // 2. Threshold
  if (loopConfig.stopCondition.threshold != null && metricValue != null) {
    const { direction, threshold } = loopConfig.stopCondition
    if (direction === 'minimize' && metricValue <= threshold) {
      return { stop: true, reason: `Metric ${metricValue} passed threshold ${threshold}` }
    }
    if (direction === 'maximize' && metricValue >= threshold) {
      return { stop: true, reason: `Metric ${metricValue} passed threshold ${threshold}` }
    }
  }

  // 3. Plateau detection
  if (loopConfig.stopCondition.plateauWindow) {
    const window = loopConfig.stopCondition.plateauWindow
    if (iterations.length >= window) {
      const recentKeeps = iterations.slice(-window).filter(i => i.status === 'keep')
      if (recentKeeps.length === 0) {
        return { stop: true, reason: `No improvement in last ${window} iterations` }
      }
    }
  }

  return { stop: false, reason: '' }
}

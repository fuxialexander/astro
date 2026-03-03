/**
 * Replan utilities — extract lessons from prior executions and build
 * summaries for the replanning prompt.
 */

import type { PlanNode, PlanEdge, ReplanContext } from '@astro/core'

/**
 * Derive a lesson status from a PlanNode's execution state.
 *
 * Mapping rules:
 *  - `completed` or `auto_verified` → `'success'`
 *  - Has `executionError`           → `'failure'`
 *  - Has `executionId` but not completed/auto_verified → `'partial'`
 *  - Otherwise                      → `'not_executed'`
 */
function deriveStatus(node: PlanNode): ReplanContext['lessons'][number]['status'] {
  if (node.status === 'completed' || node.status === 'auto_verified') {
    return 'success'
  }
  if (node.executionError) {
    return 'failure'
  }
  if (node.executionId) {
    return 'partial'
  }
  return 'not_executed'
}

/**
 * Extract per-task lessons from a list of plan nodes.
 *
 * Filters out milestone-type nodes and maps each remaining node to a lesson
 * object with status derived from execution state.
 */
export function extractLessonsFromPlan(
  nodes: PlanNode[],
): ReplanContext['lessons'] {
  return nodes
    .filter((node) => node.type !== 'milestone')
    .map((node) => ({
      taskTitle: node.title,
      taskDescription: node.description,
      status: deriveStatus(node),
      executionSummary: node.executionOutput || undefined,
    }))
}

/**
 * Build a markdown summary of a previous plan's structure and outcomes.
 *
 * Groups tasks by milestoneId, shows total/completed counts, and lists
 * dependency edges for context.
 */
export function buildPreviousPlanSummary(
  nodes: PlanNode[],
  edges: PlanEdge[],
): string {
  // Only consider task-type nodes (skip milestones, branches, decisions for counting)
  const tasks = nodes.filter((n) => n.type !== 'milestone')
  const milestones = nodes.filter((n) => n.type === 'milestone')

  const totalTasks = tasks.length
  const completedTasks = tasks.filter(
    (t) => t.status === 'completed' || t.status === 'auto_verified',
  ).length

  // Group tasks by milestoneId
  const milestoneMap = new Map<string, PlanNode>()
  for (const m of milestones) {
    milestoneMap.set(m.id, m)
  }

  const tasksByMilestone = new Map<string | undefined, PlanNode[]>()
  for (const task of tasks) {
    const key = task.milestoneId
    if (!tasksByMilestone.has(key)) {
      tasksByMilestone.set(key, [])
    }
    tasksByMilestone.get(key)!.push(task)
  }

  // Build markdown
  const lines: string[] = []
  lines.push(`## Previous Plan Summary`)
  lines.push('')
  lines.push(`**Total tasks:** ${totalTasks} | **Completed:** ${completedTasks}`)
  lines.push('')

  // Milestones with their tasks
  for (const [milestoneId, milestoneTasks] of tasksByMilestone) {
    if (milestoneId && milestoneMap.has(milestoneId)) {
      const milestone = milestoneMap.get(milestoneId)!
      lines.push(`### ${milestone.title}`)
    } else if (milestoneId) {
      lines.push(`### Milestone: ${milestoneId}`)
    } else {
      lines.push(`### Unassigned Tasks`)
    }
    lines.push('')

    for (const task of milestoneTasks) {
      const statusIcon =
        task.status === 'completed' || task.status === 'auto_verified'
          ? '\u2705'
          : task.executionError
            ? '\u274C'
            : task.executionId
              ? '\u26A0\uFE0F'
              : '\u2B1C'
      lines.push(`- ${statusIcon} **${task.title}** — ${task.status}`)
    }
    lines.push('')
  }

  // Dependency structure
  const dependencyEdges = edges.filter((e) => e.type === 'dependency')
  if (dependencyEdges.length > 0) {
    lines.push(`### Dependencies`)
    lines.push('')

    const nodeMap = new Map<string, PlanNode>()
    for (const n of nodes) {
      nodeMap.set(n.id, n)
    }

    for (const edge of dependencyEdges) {
      const source = nodeMap.get(edge.source)
      const target = nodeMap.get(edge.target)
      if (source && target) {
        lines.push(`- ${source.title} \u2192 ${target.title}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

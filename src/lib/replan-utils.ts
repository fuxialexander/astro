import type { PlanNode, PlanEdge } from "@/types"

export interface ReplanLesson {
  nodeId: string
  title: string
  status: PlanNode["status"]
  lesson: string
}

/**
 * Extract lessons from completed/failed plan nodes for replan context.
 * Maps node statuses to actionable lessons.
 */
export function extractLessonsFromPlan(nodes: PlanNode[]): ReplanLesson[] {
  const lessons: ReplanLesson[] = []

  for (const node of nodes) {
    if (node.type === "milestone") continue

    let lesson: string | null = null

    switch (node.status) {
      case "completed":
      case "auto_verified":
        lesson = `Completed successfully${node.executionOutput ? `: ${node.executionOutput.slice(0, 200)}` : ""}`
        break
      case "pruned":
        lesson = "Was pruned/cancelled — may not be needed or was replaced"
        break
      case "planned":
        lesson = "Was planned but never started — consider if still needed"
        break
      case "dispatched":
      case "in_progress":
        lesson = "Was in progress when replan started — work may be partially done"
        break
      case "awaiting_judgment":
      case "awaiting_approval":
        lesson = "Was awaiting review — output exists but was not verified"
        break
    }

    if (lesson) {
      lessons.push({
        nodeId: node.id,
        title: node.title,
        status: node.status,
        lesson,
      })
    }
  }

  return lessons
}

/**
 * Build a text summary of the previous plan for replan context.
 * Groups nodes by milestone and lists dependencies.
 */
export function buildPreviousPlanSummary(
  nodes: PlanNode[],
  edges: PlanEdge[],
): string {
  if (nodes.length === 0) return "No previous plan."

  const milestones = nodes.filter((n) => n.type === "milestone")
  const tasks = nodes.filter((n) => n.type !== "milestone")

  // Build dependency map
  const depMap = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.type !== "dependency") continue
    const deps = depMap.get(edge.target) || []
    deps.push(edge.source)
    depMap.set(edge.target, deps)
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  const lines: string[] = []
  lines.push(`Previous plan had ${nodes.length} nodes (${milestones.length} milestones, ${tasks.length} tasks).`)
  lines.push("")

  // Group tasks by milestone
  if (milestones.length > 0) {
    for (const ms of milestones) {
      lines.push(`## ${ms.title} [${ms.status}]`)
      const msTasks = tasks.filter((t) => t.milestoneId === ms.id)
      for (const task of msTasks) {
        const deps = depMap.get(task.id) || []
        const depNames = deps
          .map((d) => nodeById.get(d)?.title)
          .filter(Boolean)
          .join(", ")
        lines.push(`- ${task.title} [${task.status}]${depNames ? ` (depends on: ${depNames})` : ""}`)
      }
      lines.push("")
    }
  }

  // Tasks without milestones
  const orphanTasks = tasks.filter((t) => !t.milestoneId)
  if (orphanTasks.length > 0) {
    lines.push("## Ungrouped Tasks")
    for (const task of orphanTasks) {
      const deps = depMap.get(task.id) || []
      const depNames = deps
        .map((d) => nodeById.get(d)?.title)
        .filter(Boolean)
        .join(", ")
      lines.push(`- ${task.title} [${task.status}]${depNames ? ` (depends on: ${depNames})` : ""}`)
    }
  }

  return lines.join("\n")
}

import type { PlanNode, PlanEdge } from "@/types"

export const DAY_WIDTH = 20

export const statusColors: Record<string, string> = {
  completed: "bg-green-500",
  auto_verified: "bg-green-500",
  in_progress: "bg-blue-500",
  dispatched: "bg-blue-500",
  awaiting_judgment: "bg-amber-500",
  planned: "bg-primary/70",
  pruned: "bg-border opacity-40",
}

export const progressColors: Record<string, string> = {
  in_progress: "bg-blue-700",
  dispatched: "bg-blue-700",
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000)
}

export function snapToMonday(d: Date): Date {
  const day = d.getUTCDay()
  const diff = day === 0 ? 6 : day - 1
  return addDays(d, -diff)
}

/**
 * Topological sort + assign default dates to nodes missing startDate/endDate.
 * Milestones keep their authored dates. Tasks get auto-derived positions.
 */
export function assignDefaultDates(nodes: PlanNode[], edges: PlanEdge[]): PlanNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, { ...n }]))

  const inDeps = new Map<string, string[]>()
  for (const n of nodes) inDeps.set(n.id, [])
  for (const e of edges) {
    inDeps.get(e.target)?.push(e.source)
  }

  for (const n of nodes) {
    const list = inDeps.get(n.id) || []
    for (const dep of n.dependencies) {
      if (!list.includes(dep)) list.push(dep)
    }
    inDeps.set(n.id, list)
  }

  // Kahn's topological sort
  const inDegree = new Map<string, number>()
  for (const n of nodes) inDegree.set(n.id, inDeps.get(n.id)!.length)
  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const sorted: string[] = []
  const outEdges = new Map<string, string[]>()
  for (const n of nodes) outEdges.set(n.id, [])
  for (const e of edges) {
    outEdges.get(e.source)?.push(e.target)
  }
  for (const n of nodes) {
    for (const dep of n.dependencies) {
      const outs = outEdges.get(dep) || []
      if (!outs.includes(n.id)) outs.push(n.id)
      outEdges.set(dep, outs)
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!
    sorted.push(id)
    for (const next of outEdges.get(id) || []) {
      const deg = (inDegree.get(next) || 1) - 1
      inDegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
  }

  for (const n of nodes) {
    if (!sorted.includes(n.id)) sorted.push(n.id)
  }

  const today = fmtDate(new Date())

  for (const id of sorted) {
    const node = nodeMap.get(id)!
    if (node.startDate && node.endDate) continue

    const deps = inDeps.get(id) || []
    let earliest = today
    for (const depId of deps) {
      const dep = nodeMap.get(depId)
      if (dep?.endDate && dep.endDate > earliest) {
        earliest = dep.endDate
      }
    }

    if (!node.startDate) {
      node.startDate = earliest
    }
    if (!node.endDate) {
      const duration = node.type === "milestone" ? 0 : 3
      node.endDate = fmtDate(addDays(parseDate(node.startDate), duration))
    }
  }

  return nodes.map((n) => nodeMap.get(n.id)!)
}

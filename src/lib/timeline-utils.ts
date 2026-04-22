import type { PlanNode, PlanEdge } from "@/types"

export const DAY_WIDTH = 20

/** Check whether a string is a valid YYYY-MM-DD date */
export function isValidDateStr(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + "T00:00:00Z")
  return !isNaN(d.getTime())
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Returns today's date in YYYY-MM-DD using the local timezone (not UTC). */
export function localDateStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
 * Invalid date strings are treated as missing and get re-assigned.
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
    for (const dep of n.dependencies ?? []) {
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
    for (const dep of n.dependencies ?? []) {
      const outs = outEdges.get(dep) || []
      if (!outs.includes(n.id)) outs.push(n.id)
      outEdges.set(dep, outs)
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!
    sorted.push(id)
    for (const next of outEdges.get(id) || []) {
      if (!nodeMap.has(next)) continue // skip references to nodes outside our set
      const deg = (inDegree.get(next) || 1) - 1
      inDegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
  }

  for (const n of nodes) {
    if (!sorted.includes(n.id)) sorted.push(n.id)
  }

  const today = localDateStr()

  for (const id of sorted) {
    const node = nodeMap.get(id)
    if (!node) continue // defensive: skip if ID not in our node set

    // Only skip nodes with VALID dates for both start and end
    if (isValidDateStr(node.startDate) && isValidDateStr(node.endDate)) continue

    // Clear invalid dates so they get re-assigned
    if (node.startDate && !isValidDateStr(node.startDate)) node.startDate = undefined
    if (node.endDate && !isValidDateStr(node.endDate)) node.endDate = undefined

    const deps = inDeps.get(id) || []
    let earliest = today
    for (const depId of deps) {
      const dep = nodeMap.get(depId)
      if (dep?.endDate && isValidDateStr(dep.endDate) && dep.endDate > earliest) {
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

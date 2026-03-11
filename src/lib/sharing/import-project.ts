import { useProjectStore } from '@/stores/project-store'
import { usePlanStore } from '@/stores/plan-store'
import type { Project, PlanNode, PlanEdge } from '@/types'
import type { ProjectExportData, ImportResult } from './types'

/**
 * Import a project from exported data.
 * Generates new IDs for the project, nodes, and edges, remapping all references.
 */
export async function importProject(data: ProjectExportData): Promise<ImportResult> {
  const warnings: string[] = []

  // Generate new project ID
  const newProjectId = crypto.randomUUID()

  // Build old→new node ID mapping
  const nodeIdMap = new Map<string, string>()
  for (const node of data.nodes) {
    if (node.id) {
      nodeIdMap.set(node.id, crypto.randomUUID())
    }
  }

  // Reconstruct project
  const now = new Date()
  const project: Project = {
    id: newProjectId,
    name: data.project.name ?? 'Imported Project',
    description: data.project.description ?? '',
    visionDoc: data.project.visionDoc ?? '',
    status: data.project.status ?? 'active',
    startDate: data.project.startDate,
    targetDate: data.project.targetDate,
    lead: data.project.lead,
    health: data.project.health,
    initiativeId: data.project.initiativeId,
    progress: 0, // Reset progress
    labels: data.project.labels,
    color: data.project.color,
    icon: data.project.icon,
    repository: data.project.repository,
    createdAt: now,
    updatedAt: now,
  }

  // Reconstruct nodes with remapped IDs
  const nodes: PlanNode[] = data.nodes
    .filter((n) => n.id && nodeIdMap.has(n.id))
    .map((n) => {
      const newId = nodeIdMap.get(n.id!)!
      return {
        id: newId,
        projectId: newProjectId,
        type: n.type ?? 'task',
        title: n.title ?? 'Untitled',
        description: n.description ?? '',
        status: 'planned' as const,
        parentId: n.parentId ? (nodeIdMap.get(n.parentId) ?? null) : null,
        dependencies: (n.dependencies ?? [])
          .map((dep) => nodeIdMap.get(dep))
          .filter((d): d is string => d != null),
        verification: n.verification ?? 'auto',
        position: n.position ?? { x: 0, y: 0 },
        startDate: n.startDate,
        endDate: n.endDate,
        priority: n.priority,
        labelIds: n.labelIds,
        dueDate: n.dueDate,
        estimate: n.estimate,
        milestoneId: n.milestoneId ? (nodeIdMap.get(n.milestoneId) ?? undefined) : undefined,
        createdAt: now,
        updatedAt: now,
      }
    })

  // Reconstruct edges with remapped source/target
  const edges: PlanEdge[] = data.edges
    .filter((e) => nodeIdMap.has(e.source) && nodeIdMap.has(e.target))
    .map((e) => ({
      id: crypto.randomUUID(),
      source: nodeIdMap.get(e.source)!,
      target: nodeIdMap.get(e.target)!,
      type: e.type,
    }))

  // Check for unmapped references
  const unmappedDeps = data.nodes.filter((n) => !n.id).length
  if (unmappedDeps > 0) {
    warnings.push(`${unmappedDeps} node(s) skipped due to missing ID`)
  }

  const skippedEdges = data.edges.length - edges.length
  if (skippedEdges > 0) {
    warnings.push(`${skippedEdges} edge(s) skipped due to missing node references`)
  }

  // Persist project before plan so downstream session creation finds the FK target
  await useProjectStore.getState().addProject(project)
  usePlanStore.getState().setProjectPlan(newProjectId, nodes, edges)

  return {
    success: true,
    projectId: newProjectId,
    warnings,
    nodesImported: nodes.length,
    edgesImported: edges.length,
  }
}

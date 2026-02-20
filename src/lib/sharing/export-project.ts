import { useProjectStore } from '@/stores/project-store'
import { usePlanStore, isLive } from '@/stores/plan-store'
import { sanitizeProject, sanitizeNode } from './sanitize'
import type { AstroExportBundle, ProjectExportData } from './types'

/**
 * Export a project as an AstroExportBundle.
 * Reads from stores, sanitizes data, and returns a serializable bundle.
 */
export function exportProject(projectId: string): AstroExportBundle {
  const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
  if (!project) throw new Error(`Project ${projectId} not found`)

  const allNodes = usePlanStore.getState().nodes.filter(isLive)
  const allEdges = usePlanStore.getState().edges.filter(isLive)

  const projectNodes = allNodes.filter((n) => n.projectId === projectId)
  const nodeIds = new Set(projectNodes.map((n) => n.id))
  const projectEdges = allEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

  const data: ProjectExportData = {
    project: sanitizeProject(project),
    nodes: projectNodes.map(sanitizeNode),
    edges: projectEdges,
  }

  return {
    $schema: 'astro-export',
    version: '1.0',
    type: 'project',
    exportedAt: new Date().toISOString(),
    astroVersion: '0.1.0',
    name: project.name,
    description: project.description,
    data,
  }
}

/**
 * Trigger a file download of the export bundle.
 */
export function downloadBundle(bundle: AstroExportBundle) {
  const json = JSON.stringify(bundle, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${bundle.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.astro.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

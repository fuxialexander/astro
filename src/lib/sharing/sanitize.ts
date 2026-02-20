import type { Project, PlanNode } from '@/types'

/** Fields to strip from Project when exporting */
const PROJECT_STRIP_KEYS: (keyof Project)[] = [
  'workingDirectory',
  'defaultMachineId',
  'fileTree',
  'fileTreeUpdatedAt',
  'fileTreeMachineId',
]

/** Fields to strip from PlanNode when exporting */
const NODE_STRIP_KEYS: (keyof PlanNode)[] = [
  'executionId',
  'executionOutput',
  'executionError',
  'executionStartedAt',
  'executionCompletedAt',
  'machineId',
  'deletedAt',
  'deletionActionId',
  'branchName',
  'prUrl',
  'prNumber',
]

/**
 * Sanitize a project for export — strips machine-specific and sensitive fields.
 */
export function sanitizeProject(project: Project): Partial<Project> {
  const result = { ...project }
  for (const key of PROJECT_STRIP_KEYS) {
    delete result[key]
  }
  return result
}

/**
 * Sanitize a plan node for export — strips execution data, resets status to 'planned'.
 */
export function sanitizeNode(node: PlanNode): Partial<PlanNode> {
  const result: Record<string, unknown> = { ...node }
  for (const key of NODE_STRIP_KEYS) {
    delete result[key]
  }
  result.status = 'planned'
  return result as Partial<PlanNode>
}

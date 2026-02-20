import type { Project, PlanNode, PlanEdge } from '@/types'
import type { OpenClawSkill } from '@/types/skill'
import type { SidebarItem } from '@/stores/sidebar-store'

export interface AstroExportBundle {
  $schema: 'astro-export'
  version: '1.0'
  type: 'project' | 'workspace-config' | 'plugin-config'
  exportedAt: string // ISO 8601
  astroVersion: string
  name: string
  description?: string
  data: ProjectExportData | WorkspaceConfigExportData | PluginConfigExportData
}

export interface ProjectExportData {
  project: Partial<Project>
  nodes: Partial<PlanNode>[]
  edges: PlanEdge[]
  skills?: OpenClawSkill[]
}

export interface WorkspaceConfigExportData {
  sidebarItems?: SidebarItem[]
  displaySettings?: Record<string, unknown>
  preferences?: Record<string, unknown>
}

export interface PluginConfigExportData {
  plugins: Array<{ id: string; config: Record<string, unknown>; enabled: boolean }>
}

export interface ImportResult {
  success: boolean
  projectId?: string
  warnings: string[]
  nodesImported: number
  edgesImported: number
}

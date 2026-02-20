import { useSidebarStore } from '@/stores/sidebar-store'
import { useDisplaySettingsStore } from '@/stores/display-settings-store'
import type { AstroExportBundle, WorkspaceConfigExportData } from './types'

/**
 * Export workspace configuration (sidebar items, display settings) as an AstroExportBundle.
 */
export function exportWorkspaceConfig(): AstroExportBundle {
  const sidebarItems = useSidebarStore.getState().items
  const displaySettings = useDisplaySettingsStore.getState().settings

  const data: WorkspaceConfigExportData = {
    sidebarItems,
    displaySettings: displaySettings as unknown as Record<string, unknown>,
  }

  return {
    $schema: 'astro-export',
    version: '1.0',
    type: 'workspace-config',
    exportedAt: new Date().toISOString(),
    astroVersion: '0.1.0',
    name: 'Workspace Configuration',
    data,
  }
}

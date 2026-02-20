import { useSidebarStore } from '@/stores/sidebar-store'
import { useDisplaySettingsStore, type ViewKey } from '@/stores/display-settings-store'
import type { WorkspaceConfigExportData } from './types'

/**
 * Import workspace configuration, merging with existing settings.
 */
export function importWorkspaceConfig(data: WorkspaceConfigExportData): void {
  // Merge sidebar items
  if (data.sidebarItems) {
    const store = useSidebarStore.getState()
    const currentItems = store.items
    // Merge: keep existing items, update matching ones from import
    const mergedItems = currentItems.map((item) => {
      const imported = data.sidebarItems!.find((s) => s.id === item.id)
      if (imported) {
        return { ...item, visible: imported.visible }
      }
      return item
    })
    // We can't directly set items, so we toggle to match
    for (const item of mergedItems) {
      const current = currentItems.find((c) => c.id === item.id)
      if (current && current.visible !== item.visible && !current.protected) {
        store.toggleItemVisibility(item.id)
      }
    }
  }

  // Merge display settings
  if (data.displaySettings) {
    const store = useDisplaySettingsStore.getState()
    for (const [key, value] of Object.entries(data.displaySettings)) {
      if (value && typeof value === 'object') {
        store.update(key as ViewKey, value as Record<string, unknown>)
      }
    }
  }
}

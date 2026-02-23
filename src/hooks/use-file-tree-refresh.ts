import { useEffect } from 'react'
import { useProjectStore } from '@/stores/project-store'
import { apiUrl } from '@/lib/api-url'
import type { Project } from '@/types'

const FILE_TREE_STALE_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Auto-fetch file tree for a project when stale, missing, or from a different machine.
 * Requires a connected machine (via relay) — backend never touches filesystem directly.
 * Runs in the background — does not block rendering.
 */
export function useFileTreeRefresh(project: Project | undefined) {
  const updateFileTree = useProjectStore((s) => s.updateFileTree)

  useEffect(() => {
    if (!project?.workingDirectory) return
    const machineId = project.defaultMachineId
    if (!machineId) return // No machine connected — cannot fetch file tree

    const cachedForMachine = project.fileTreeMachineId
    const updatedAt = project.fileTreeUpdatedAt ? new Date(project.fileTreeUpdatedAt).getTime() : 0
    const isStale = Date.now() - updatedAt >= FILE_TREE_STALE_MS || !project.fileTree?.length
    const isMachineMismatch = cachedForMachine !== machineId
    if (!isStale && !isMachineMismatch) return

    const params = new URLSearchParams({ projectId: project.id, machineId, workingDirectory: project.workingDirectory })
    fetch(apiUrl(`/api/fs/files?${params}`))
      .then((r) => r.json())
      .then((data) => {
        if (data.files?.length) updateFileTree(project.id, data.files, machineId)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.workingDirectory, project?.defaultMachineId])
}

/**
 * Refresh file trees for all projects that have a workingDirectory and connected machine.
 * Called once after projects load (e.g., from DataLoader).
 * Non-blocking — fires and forgets.
 */
export function refreshAllFileTrees() {
  const { projects, updateFileTree } = useProjectStore.getState()
  for (const project of projects) {
    if (!project.workingDirectory) continue
    const machineId = project.defaultMachineId
    if (!machineId) continue // No machine connected — skip

    const updatedAt = project.fileTreeUpdatedAt ? new Date(project.fileTreeUpdatedAt).getTime() : 0
    const isStale = Date.now() - updatedAt >= FILE_TREE_STALE_MS || !project.fileTree?.length
    if (!isStale) continue

    const params = new URLSearchParams({ projectId: project.id, machineId, workingDirectory: project.workingDirectory })
    fetch(apiUrl(`/api/fs/files?${params}`))
      .then((r) => r.json())
      .then((data) => {
        if (data.files?.length) updateFileTree(project.id, data.files, machineId)
      })
      .catch(() => {})
  }
}

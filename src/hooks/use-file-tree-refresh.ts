import { useEffect } from 'react'
import { useProjectStore } from '@/stores/project-store'
import { apiUrl } from '@/lib/api-url'
import type { Project } from '@/types'

const FILE_TREE_STALE_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Auto-fetch file tree for a project when stale, missing, or from a different machine.
 * Runs in the background — does not block rendering.
 */
export function useFileTreeRefresh(project: Project | undefined) {
  const updateFileTree = useProjectStore((s) => s.updateFileTree)

  useEffect(() => {
    if (!project?.workingDirectory) return
    const machineId = project.defaultMachineId
    const cachedForMachine = project.fileTreeMachineId || 'local'
    const currentMachine = machineId || 'local'
    const updatedAt = project.fileTreeUpdatedAt ? new Date(project.fileTreeUpdatedAt).getTime() : 0
    const isStale = Date.now() - updatedAt >= FILE_TREE_STALE_MS || !project.fileTree?.length
    const isMachineMismatch = cachedForMachine !== currentMachine
    if (!isStale && !isMachineMismatch) return

    if (machineId) {
      const params = new URLSearchParams({ projectId: project.id, machineId, workingDirectory: project.workingDirectory })
      fetch(apiUrl(`/api/fs/files?${params}`))
        .then((r) => r.json())
        .then((data) => {
          if (data.files?.length) updateFileTree(project.id, data.files, machineId)
        })
        .catch(() => {})
    } else {
      fetch(apiUrl(`/api/repo/file-tree?workingDirectory=${encodeURIComponent(project.workingDirectory)}`))
        .then((r) => r.json())
        .then((data) => {
          if (data.files?.length) updateFileTree(project.id, data.files)
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.workingDirectory, project?.defaultMachineId])
}

/**
 * Refresh file trees for all projects that have a workingDirectory.
 * Called once after projects load (e.g., from DataLoader).
 * Non-blocking — fires and forgets.
 */
export function refreshAllFileTrees() {
  const { projects, updateFileTree } = useProjectStore.getState()
  for (const project of projects) {
    if (!project.workingDirectory) continue
    const updatedAt = project.fileTreeUpdatedAt ? new Date(project.fileTreeUpdatedAt).getTime() : 0
    const isStale = Date.now() - updatedAt >= FILE_TREE_STALE_MS || !project.fileTree?.length
    if (!isStale) continue

    const machineId = project.defaultMachineId
    if (machineId) {
      const params = new URLSearchParams({ projectId: project.id, machineId, workingDirectory: project.workingDirectory })
      fetch(apiUrl(`/api/fs/files?${params}`))
        .then((r) => r.json())
        .then((data) => {
          if (data.files?.length) updateFileTree(project.id, data.files, machineId)
        })
        .catch(() => {})
    } else {
      fetch(apiUrl(`/api/repo/file-tree?workingDirectory=${encodeURIComponent(project.workingDirectory)}`))
        .then((r) => r.json())
        .then((data) => {
          if (data.files?.length) updateFileTree(project.id, data.files)
        })
        .catch(() => {})
    }
  }
}

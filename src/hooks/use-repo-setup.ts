import { useState } from 'react'
import { useProjectStore } from '@/stores/project-store'
import { apiUrl } from '@/lib/api-url'

export interface RepoSetupParams {
  projectId: string
  projectName: string
  projectDescription?: string
  workingDirectory?: string
  repository?: string
  baseBranch?: string
  targetMachineId?: string
}

export interface RepoSetupResult {
  workingDirectory?: string
  fileTree?: string[]
  keyFiles?: { claudeMd?: string; readmeMd?: string; packageInfo?: string }
}

export interface GitInitPrompt {
  projectId: string
  dir: string
  name: string
  description?: string
}

export function useRepoSetup() {
  const updateProject = useProjectStore((s) => s.updateProject)
  const updateFileTree = useProjectStore((s) => s.updateFileTree)
  const [gitInitPrompt, setGitInitPrompt] = useState<GitInitPrompt | null>(null)

  async function setupRepo(params: RepoSetupParams): Promise<RepoSetupResult | null> {
    console.log('[repo-setup] Starting repo setup for project:', params.projectId, params)
    try {
      const res = await fetch(apiUrl('/api/repo/setup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: params.projectId,
          projectName: params.projectName,
          projectDescription: params.projectDescription,
          workingDirectory: params.workingDirectory,
          repository: params.repository,
          baseBranch: params.baseBranch,
          targetMachineId: params.targetMachineId,
        }),
      })
      console.log('[repo-setup] Response status:', res.status, res.statusText)
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        const errorMsg = errorData.error || 'Repo setup failed'
        console.error('[repo-setup] Setup failed:', errorMsg, errorData)
        throw new Error(errorMsg)
      }
      const data = await res.json()
      console.log('[repo-setup] Success! Data:', data)

      if (data.needsGitInit) {
        setGitInitPrompt({
          projectId: params.projectId,
          dir: data.workingDirectory,
          name: params.projectName,
          description: params.projectDescription,
        })
        return null
      }

      // Update project with resolved source directory, auto-detected repository, and structured source
      if (data.workingDirectory || data.repository || data.source) {
        updateProject(params.projectId, {
          ...(data.workingDirectory ? { sourceDirectory: data.workingDirectory, workingDirectory: data.workingDirectory } : {}),
          ...(data.repository ? { repository: data.repository } : {}),
          ...(data.source ? { source: data.source } : {}),
          ...(data.deliveryMode ? { deliveryMode: data.deliveryMode } : {}),
          ...(data.agentDir ? { agentDir: data.agentDir } : {}),
        })
      }
      if (data.fileTree) {
        updateFileTree(params.projectId, data.fileTree, params.targetMachineId)
      }

      return {
        workingDirectory: data.workingDirectory,
        fileTree: data.fileTree,
        keyFiles: data.keyFiles,
      }
    } catch (error) {
      console.error('[repo-setup] Setup failed:', error)
      throw error
    }
  }

  async function confirmGitInit(targetMachineId?: string) {
    if (!gitInitPrompt) return
    const { projectId, dir, name, description } = gitInitPrompt
    setGitInitPrompt(null)
    try {
      const res = await fetch(apiUrl('/api/repo/git-init'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workingDirectory: dir,
          projectId,
          projectName: name,
          projectDescription: description,
          targetMachineId,
        }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.workingDirectory) {
        updateProject(projectId, {
          sourceDirectory: data.workingDirectory,
          workingDirectory: data.workingDirectory,
          ...(data.source ? { source: data.source } : {}),
          ...(data.deliveryMode ? { deliveryMode: data.deliveryMode } : {}),
          ...(data.agentDir ? { agentDir: data.agentDir } : {}),
        })
      }
      if (data.fileTree) {
        updateFileTree(projectId, data.fileTree)
      }
    } catch (error) {
      console.error('[repo-setup] Git init failed:', error)
    }
  }

  return {
    setupRepo,
    gitInitPrompt,
    dismissGitInit: () => setGitInitPrompt(null),
    confirmGitInit,
  }
}

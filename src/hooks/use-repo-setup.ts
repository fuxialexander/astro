import { useProjectStore } from '@/stores/project-store'
import { apiUrl } from '@/lib/api-url'
import { getAccessToken } from '@/lib/supabase-client'

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {}
  const token = await getAccessToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

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

export function useRepoSetup() {
  const updateProject = useProjectStore((s) => s.updateProject)
  const updateFileTree = useProjectStore((s) => s.updateFileTree)

  async function setupRepo(params: RepoSetupParams): Promise<RepoSetupResult | null> {
    console.log('[repo-setup] Starting repo setup for project:', params.projectId, params)
    try {
      const hdrs = await authHeaders()
      const res = await fetch(apiUrl('/api/repo/setup'), {
        method: 'POST',
        headers: { ...hdrs, 'Content-Type': 'application/json' },
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

      // Update project with resolved source directory, auto-detected repository, and structured source
      if (data.workingDirectory || data.repository || data.source) {
        updateProject(params.projectId, {
          ...(data.workingDirectory ? { workingDirectory: data.workingDirectory } : {}),
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

  return {
    setupRepo,
  }
}

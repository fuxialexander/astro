/**
 * Repo Routes
 *
 * HTTP API endpoints for project repository setup and file tree caching.
 * Provides git init/clone, .gitignore generation, CLAUDE.md generation,
 * and file tree listing.
 */

import { Hono } from 'hono'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setupProjectRepo, initializeGitRepo, getFileTree } from '../lib/repo-setup.js'
import { relayServer, type RepoSetupRelayResult } from '../lib/relay-server.js'
import { detectRemoteType } from '../lib/git-url-utils.js'
import { errorMessage } from '../lib/error-utils.js'

const repoRoute = new Hono()

/**
 * Request repo setup from a remote machine via relay WebSocket.
 * Follows the same pattern as requestRemoteFileList in fs.ts.
 */
async function requestRemoteRepoSetup(
  machineId: string,
  body: {
    projectId: string
    projectName: string
    projectDescription?: string
    workingDirectory?: string
    repository?: string
  },
): Promise<RepoSetupRelayResult> {
  const correlationId = crypto.randomUUID()

  return new Promise<RepoSetupRelayResult>((resolve) => {
    const timeout = setTimeout(() => {
      relayServer.removeListener('repo_setup:response', handler)
      resolve({ success: false, error: 'Remote repo setup timed out' })
    }, 30_000)

    function handler(data: { correlationId: string; result: RepoSetupRelayResult }) {
      if (data.correlationId !== correlationId) return
      clearTimeout(timeout)
      relayServer.removeListener('repo_setup:response', handler)
      resolve(data.result)
    }

    relayServer.on('repo_setup:response', handler)

    const sent = relayServer.requestRepoSetup(machineId, {
      correlationId,
      ...body,
    })
    if (!sent) {
      clearTimeout(timeout)
      relayServer.removeListener('repo_setup:response', handler)
      resolve({ success: false, error: `Machine ${machineId} is not connected` })
    }
  })
}

/**
 * GET /api/repo/detect?path=<dir>
 *
 * Lightweight, read-only probe that returns detection info about a directory.
 * Does NOT modify anything — purely diagnostic. Used for inline detection
 * feedback as the user types a directory path in the project creation form.
 *
 * Response: { exists, isGit, remoteUrl?, remoteType, baseBranch?, suggestedDeliveryMode }
 */
repoRoute.get('/detect', async (c) => {
  const dirPath = c.req.query('path')

  if (!dirPath) {
    return c.json({ error: 'path query parameter is required' }, 400)
  }

  try {
    const exists = existsSync(dirPath)
    if (!exists) {
      return c.json({
        exists: false,
        isGit: false,
        remoteType: 'none' as const,
        suggestedDeliveryMode: 'branch' as const,
      })
    }

    // Check if it's a git repo
    let isGit = false
    try {
      execFileSync('git', ['-C', dirPath, 'rev-parse', '--is-inside-work-tree'], {
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: 'pipe',
      })
      isGit = true
    } catch {
      // Not a git repo
    }

    if (!isGit) {
      return c.json({
        exists: true,
        isGit: false,
        remoteType: 'none' as const,
        suggestedDeliveryMode: 'direct' as const,
      })
    }

    // Get remote URL
    let remoteUrl: string | undefined
    try {
      const url = execFileSync('git', ['-C', dirPath, 'remote', 'get-url', 'origin'], {
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: 'pipe',
      }).trim()
      if (url) remoteUrl = url
    } catch {
      // No remote
    }

    // Get default branch
    let baseBranch = 'main'
    try {
      const branch = execFileSync('git', ['-C', dirPath, 'symbolic-ref', '--short', 'HEAD'], {
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: 'pipe',
      }).trim()
      if (branch) baseBranch = branch
    } catch {
      // Default to 'main'
    }

    // Detect remote type and derive delivery mode
    const remoteType = detectRemoteType(remoteUrl)
    let suggestedDeliveryMode: 'pr' | 'push' | 'branch' | 'direct' = 'branch'
    switch (remoteType) {
      case 'github':
      case 'gitlab':
      case 'bitbucket':
        suggestedDeliveryMode = 'pr'
        break
      case 'generic':
        suggestedDeliveryMode = 'push'
        break
      case 'none':
      default:
        suggestedDeliveryMode = 'branch'
        break
    }

    return c.json({
      exists: true,
      isGit: true,
      remoteUrl,
      remoteType,
      baseBranch,
      suggestedDeliveryMode,
    })
  } catch (error) {
    const message = errorMessage(error)
    console.error('[repo] Detect failed:', message)
    return c.json({ error: `Detection failed: ${message}` }, 500)
  }
})

/**
 * POST /api/repo/setup
 *
 * Main endpoint called during project creation to set up a git-backed directory.
 * If targetMachineId is provided, relays the request to the remote machine.
 *
 * Input: { projectId, projectName, projectDescription?, workingDirectory?, repository?, targetMachineId? }
 * Response: { workingDirectory, fileTree, needsGitInit?, claudeMdCreated?, gitignoreCreated? }
 */
repoRoute.post('/setup', async (c) => {
  const body = await c.req.json<{
    projectId: string
    projectName: string
    projectDescription?: string
    workingDirectory?: string
    repository?: string
    referenceUrls?: string[]
    targetMachineId?: string
  }>()

  const { projectId, projectName, projectDescription, workingDirectory, repository, referenceUrls, targetMachineId } = body

  if (!projectId || !projectName) {
    return c.json({ error: 'projectId and projectName are required' }, 400)
  }

  // Remote machine: relay via WebSocket
  if (targetMachineId) {
    try {
      const result = await requestRemoteRepoSetup(targetMachineId, {
        projectId,
        projectName,
        projectDescription,
        workingDirectory,
        repository,
      })

      if (!result.success) {
        return c.json({ error: result.error || 'Remote repo setup failed' }, 500)
      }

      return c.json(result)
    } catch (error) {
      const message = errorMessage(error)
      console.error('[repo] Remote setup failed:', message)
      return c.json({ error: `Remote repo setup failed: ${message}` }, 500)
    }
  }

  // Local: run setup directly
  try {
    const result = setupProjectRepo({
      projectId,
      projectName,
      projectDescription,
      workingDirectory,
      repository,
      referenceUrls,
    })

    return c.json(result)
  } catch (error) {
    const message = errorMessage(error)
    console.error('[repo] Setup failed:', message)
    return c.json({ error: `Repo setup failed: ${message}` }, 500)
  }
})

/**
 * POST /api/repo/git-init
 *
 * Called after user confirms git init for an existing non-git directory.
 *
 * Input: { workingDirectory, projectId, projectName, projectDescription? }
 * Response: { workingDirectory, fileTree, claudeMdCreated?, gitignoreCreated? }
 */
repoRoute.post('/git-init', async (c) => {
  const body = await c.req.json<{
    workingDirectory: string
    projectId: string
    projectName: string
    projectDescription?: string
  }>()

  const { workingDirectory, projectName, projectDescription } = body

  if (!workingDirectory) {
    return c.json({ error: 'workingDirectory is required' }, 400)
  }

  try {
    const result = initializeGitRepo(workingDirectory, projectName, projectDescription)
    return c.json(result)
  } catch (error) {
    const message = errorMessage(error)
    console.error('[repo] Git init failed:', message)
    return c.json({ error: `Git init failed: ${message}` }, 500)
  }
})

/**
 * GET /api/repo/file-tree?workingDirectory=path
 *
 * Lightweight refresh endpoint — returns current git ls-files output.
 * Path expansion (tilde ~) is handled automatically in getFileTree.
 *
 * Response: { files: string[] }
 */
repoRoute.get('/file-tree', async (c) => {
  const workingDirectory = c.req.query('workingDirectory')

  if (!workingDirectory) {
    return c.json({ files: [] })
  }

  try {
    const files = getFileTree(workingDirectory)
    return c.json({ files })
  } catch (error) {
    console.error('[repo] File tree failed:', error)
    return c.json({ files: [] })
  }
})

export { repoRoute }

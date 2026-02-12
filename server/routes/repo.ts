/**
 * Repo Routes
 *
 * HTTP API endpoints for project repository setup and file tree caching.
 * Provides git init/clone, .gitignore generation, CLAUDE.md generation,
 * and file tree listing.
 */

import { Hono } from 'hono'
import { setupProjectRepo, initializeGitRepo, getFileTree } from '../lib/repo-setup.js'
import { relayServer, type RepoSetupRelayResult } from '../lib/relay-server.js'
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
    targetMachineId?: string
  }>()

  const { projectId, projectName, projectDescription, workingDirectory, repository, targetMachineId } = body

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

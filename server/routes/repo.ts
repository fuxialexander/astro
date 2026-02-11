/**
 * Repo Routes
 *
 * HTTP API endpoints for project repository setup and file tree caching.
 * Provides git init/clone, .gitignore generation, CLAUDE.md generation,
 * and file tree listing.
 */

import { Hono } from 'hono'
import { setupProjectRepo, initializeGitRepo, getFileTree } from '../lib/repo-setup.js'

const repoRoute = new Hono()

/**
 * POST /api/repo/setup
 *
 * Main endpoint called during project creation to set up a git-backed directory.
 *
 * Input: { projectId, projectName, projectDescription?, workingDirectory?, repository? }
 * Response: { workingDirectory, fileTree, needsGitInit?, claudeMdCreated?, gitignoreCreated? }
 */
repoRoute.post('/setup', async (c) => {
  const body = await c.req.json<{
    projectId: string
    projectName: string
    projectDescription?: string
    workingDirectory?: string
    repository?: string
  }>()

  const { projectId, projectName, projectDescription, workingDirectory, repository } = body

  if (!projectId || !projectName) {
    return c.json({ error: 'projectId and projectName are required' }, 400)
  }

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
    const message = error instanceof Error ? error.message : 'Unknown error'
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
    const message = error instanceof Error ? error.message : 'Unknown error'
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

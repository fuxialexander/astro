/**
 * Repo Routes
 *
 * HTTP API endpoints for project repository setup, detection, and git init.
 * All filesystem operations are routed through the relay to connected agent runners.
 * The server never touches the filesystem directly.
 *
 * Repo detection results are cached in-memory (60s TTL) since git status
 * doesn't change frequently enough to justify a relay round-trip on every keystroke.
 */

import { Hono } from 'hono'
import { relayServer, type RepoSetupRelayResult, type RepoDetectRelayResult, type GitInitRelayResult, type BranchListRelayResult, type GitCheckoutRelayResult, type GitCreateBranchRelayResult } from '../lib/relay-server.js'
import { machineRegistry } from '../lib/machine-registry.js'
import { errorMessage } from '../lib/error-utils.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'

// --- In-memory cache for repo detection (per-instance, best-effort) ---
// Read-through cache: misses fall through to the relay. ~50% hit rate
// with 2 Fly.io instances. No correctness depends on the cache.
// Invalidated on git-init to reflect changed repo state.
const DETECT_CACHE_TTL_MS = 60_000 // 60 seconds
const DETECT_CACHE_MAX_ENTRIES = 100

interface DetectCacheEntry {
  data: RepoDetectRelayResult
  expiresAt: number
}

const detectCache = new Map<string, DetectCacheEntry>()

function detectCacheKey(machineId: string, path: string): string {
  return `${machineId}:${path}`
}

function getCachedDetect(machineId: string, path: string): RepoDetectRelayResult | null {
  const key = detectCacheKey(machineId, path)
  const entry = detectCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    detectCache.delete(key)
    return null
  }
  return entry.data
}

function setCachedDetect(machineId: string, path: string, data: RepoDetectRelayResult): void {
  if (detectCache.size >= DETECT_CACHE_MAX_ENTRIES) {
    // Evict expired entries first, then oldest by insertion if still over limit
    const now = Date.now()
    for (const [k, v] of detectCache) {
      if (v.expiresAt < now) detectCache.delete(k)
    }
    if (detectCache.size >= DETECT_CACHE_MAX_ENTRIES) {
      const oldest = detectCache.keys().next().value
      if (oldest) detectCache.delete(oldest)
    }
  }
  detectCache.set(detectCacheKey(machineId, path), {
    data,
    expiresAt: Date.now() + DETECT_CACHE_TTL_MS,
  })
}

/** Invalidate detect cache for a path (called after git-init changes the repo state) */
export function invalidateDetectCache(machineId: string, path: string): void {
  detectCache.delete(detectCacheKey(machineId, path))
}

const repoRoute = new Hono()

// All repo routes require authentication
repoRoute.use('/*', requireAuth)

/**
 * Request repo detect from a remote machine via relay WebSocket.
 * Follows the same pattern as requestRemoteFileList in fs.ts.
 */
async function requestRemoteRepoDetect(
  machineId: string,
  path: string,
): Promise<RepoDetectRelayResult> {
  const correlationId = crypto.randomUUID()

  return new Promise<RepoDetectRelayResult>((resolve) => {
    const timeout = setTimeout(() => {
      relayServer.removeListener('repo_detect:response', handler)
      resolve({ exists: false, isGit: false, remoteType: 'none', suggestedDeliveryMode: 'branch', error: 'Remote repo detect timed out' })
    }, 10_000)

    function handler(data: { correlationId: string; result: RepoDetectRelayResult }) {
      if (data.correlationId !== correlationId) return
      clearTimeout(timeout)
      relayServer.removeListener('repo_detect:response', handler)
      resolve(data.result)
    }

    relayServer.on('repo_detect:response', handler)

    const sent = relayServer.requestRepoDetect(machineId, path, correlationId)
    if (!sent) {
      clearTimeout(timeout)
      relayServer.removeListener('repo_detect:response', handler)
      resolve({ exists: false, isGit: false, remoteType: 'none', suggestedDeliveryMode: 'branch', error: `Machine ${machineId} is not connected` })
    }
  })
}

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
    baseBranch?: string
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
 * Request branch list from a remote machine via relay WebSocket.
 */
async function requestRemoteBranchList(
  machineId: string,
  path: string,
): Promise<BranchListRelayResult> {
  const correlationId = crypto.randomUUID()

  return new Promise<BranchListRelayResult>((resolve) => {
    const timeout = setTimeout(() => {
      relayServer.removeListener('branch_list:response', handler)
      resolve({ branches: [], error: 'Remote branch list timed out' })
    }, 10_000)

    function handler(data: { correlationId: string; result: BranchListRelayResult }) {
      if (data.correlationId !== correlationId) return
      clearTimeout(timeout)
      relayServer.removeListener('branch_list:response', handler)
      resolve(data.result)
    }

    relayServer.on('branch_list:response', handler)

    const sent = relayServer.requestBranchList(machineId, path, correlationId)
    if (!sent) {
      clearTimeout(timeout)
      relayServer.removeListener('branch_list:response', handler)
      resolve({ branches: [], error: `Machine ${machineId} is not connected` })
    }
  })
}

/**
 * Request git checkout from a remote machine via relay WebSocket.
 */
async function requestRemoteGitCheckout(
  machineId: string,
  path: string,
  branch: string,
  stash?: boolean,
): Promise<GitCheckoutRelayResult> {
  const correlationId = crypto.randomUUID()

  return new Promise<GitCheckoutRelayResult>((resolve) => {
    const timeout = setTimeout(() => {
      relayServer.removeListener('git_checkout:response', handler)
      resolve({ success: false, error: 'Remote git checkout timed out' })
    }, 15_000)

    function handler(data: { correlationId: string; result: GitCheckoutRelayResult }) {
      if (data.correlationId !== correlationId) return
      clearTimeout(timeout)
      relayServer.removeListener('git_checkout:response', handler)
      resolve(data.result)
    }

    relayServer.on('git_checkout:response', handler)

    const sent = relayServer.requestGitCheckout(machineId, path, branch, correlationId, stash)
    if (!sent) {
      clearTimeout(timeout)
      relayServer.removeListener('git_checkout:response', handler)
      resolve({ success: false, error: `Machine ${machineId} is not connected` })
    }
  })
}

/**
 * Request git create-branch from a remote machine via relay WebSocket.
 */
async function requestRemoteGitCreateBranch(
  machineId: string,
  path: string,
  branch: string,
): Promise<GitCreateBranchRelayResult> {
  const correlationId = crypto.randomUUID()

  return new Promise<GitCreateBranchRelayResult>((resolve) => {
    const timeout = setTimeout(() => {
      relayServer.removeListener('git_create_branch:response', handler)
      resolve({ success: false, error: 'Remote git create-branch timed out' })
    }, 15_000)

    function handler(data: { correlationId: string; result: GitCreateBranchRelayResult }) {
      if (data.correlationId !== correlationId) return
      clearTimeout(timeout)
      relayServer.removeListener('git_create_branch:response', handler)
      resolve(data.result)
    }

    relayServer.on('git_create_branch:response', handler)

    const sent = relayServer.requestGitCreateBranch(machineId, path, branch, correlationId)
    if (!sent) {
      clearTimeout(timeout)
      relayServer.removeListener('git_create_branch:response', handler)
      resolve({ success: false, error: `Machine ${machineId} is not connected` })
    }
  })
}

/**
 * Request git init from a remote machine via relay WebSocket.
 */
async function requestRemoteGitInit(
  machineId: string,
  body: {
    workingDirectory: string
    projectId: string
    projectName: string
    projectDescription?: string
  },
): Promise<GitInitRelayResult> {
  const correlationId = crypto.randomUUID()

  return new Promise<GitInitRelayResult>((resolve) => {
    const timeout = setTimeout(() => {
      relayServer.removeListener('git_init:response', handler)
      resolve({ success: false, error: 'Remote git init timed out' })
    }, 30_000)

    function handler(data: { correlationId: string; result: GitInitRelayResult }) {
      if (data.correlationId !== correlationId) return
      clearTimeout(timeout)
      relayServer.removeListener('git_init:response', handler)
      resolve(data.result)
    }

    relayServer.on('git_init:response', handler)

    const sent = relayServer.requestGitInit(machineId, {
      correlationId,
      ...body,
    })
    if (!sent) {
      clearTimeout(timeout)
      relayServer.removeListener('git_init:response', handler)
      resolve({ success: false, error: `Machine ${machineId} is not connected` })
    }
  })
}

/**
 * GET /api/repo/detect?path=<dir>&machineId=<id>
 *
 * Lightweight, read-only probe that returns detection info about a directory.
 * Does NOT modify anything — purely diagnostic. Used for inline detection
 * feedback as the user types a directory path in the project creation form.
 *
 * Requires machineId — all FS operations go through relay.
 *
 * Response: { exists, isGit, remoteUrl?, remoteType, baseBranch?, suggestedDeliveryMode }
 */
repoRoute.get('/detect', async (c) => {
  const dirPath = c.req.query('path')
  const machineId = c.req.query('machineId')

  if (!dirPath) {
    return c.json({ error: 'path query parameter is required' }, 400)
  }

  if (dirPath.includes('..')) {
    return c.json({ error: 'path must not contain ".."' }, 400)
  }

  if (!machineId) {
    return c.json({ error: 'machineId query parameter is required. Connect a machine to detect directories.' }, 400)
  }

  // Check in-memory cache first (skip relay round-trip for repeated detections)
  const cached = getCachedDetect(machineId, dirPath)
  if (cached) {
    return c.json(cached)
  }

  // Fast-fail for ghost machines
  const reachable = await relayServer.isMachineReachable(machineId)
  if (!reachable) {
    return c.json({ error: 'Machine not connected' }, 502)
  }

  try {
    const result = await requestRemoteRepoDetect(machineId, dirPath)
    if (result.error) {
      return c.json({ error: result.error }, 502)
    }
    // Cache successful detection results
    setCachedDetect(machineId, dirPath, result)
    return c.json(result)
  } catch (error) {
    const message = errorMessage(error)
    console.error('[repo] Detect failed:', message)
    return c.json({ error: `Detection failed: ${message}` }, 500)
  }
})

/**
 * GET /api/repo/branches?path=<dir>&machineId=<id>
 *
 * Fetches the list of local and remote branches for a git repository.
 * Requires machineId — all FS operations go through relay.
 *
 * Response: { branches: [...], defaultBranch? }
 */
repoRoute.get('/branches', async (c) => {
  const dirPath = c.req.query('path')
  const machineId = c.req.query('machineId')

  if (!dirPath) {
    return c.json({ error: 'path query parameter is required' }, 400)
  }

  if (dirPath.includes('..')) {
    return c.json({ error: 'path must not contain ".."' }, 400)
  }

  if (!machineId) {
    return c.json({ error: 'machineId query parameter is required. Connect a machine to list branches.' }, 400)
  }

  try {
    const result = await requestRemoteBranchList(machineId, dirPath)
    if (result.error) {
      return c.json({ error: result.error }, 502)
    }
    return c.json(result)
  } catch (error) {
    const message = errorMessage(error)
    console.error('[repo] Branch list failed:', message)
    return c.json({ error: `Branch list failed: ${message}` }, 502)
  }
})

/**
 * POST /api/repo/checkout
 *
 * Checkout an existing branch on the remote machine.
 * Invalidates the detect cache so subsequent calls get fresh state.
 *
 * Input: { path, machineId, branch }
 * Response: { success, branch?, error? }
 */
repoRoute.post('/checkout', async (c) => {
  const { path, machineId, branch, stash } = await c.req.json<{ path: string; machineId: string; branch: string; stash?: boolean }>()

  if (!path || !machineId || !branch) {
    return c.json({ error: 'path, machineId, and branch are required' }, 400)
  }

  if (path.includes('..')) {
    return c.json({ error: 'path must not contain ".."' }, 400)
  }

  try {
    const result = await requestRemoteGitCheckout(machineId, path, branch, stash)
    // Invalidate detect cache so next detection picks up the new branch
    const cacheKey = detectCacheKey(machineId, path)
    detectCache.delete(cacheKey)
    if (result.error) {
      return c.json(result, 500)
    }
    return c.json(result)
  } catch (error) {
    const message = errorMessage(error)
    console.error('[repo] Git checkout failed:', message)
    return c.json({ success: false, error: `Git checkout failed: ${message}` }, 500)
  }
})

/**
 * POST /api/repo/create-branch
 *
 * Create and checkout a new branch on the remote machine.
 * Invalidates the detect cache so subsequent calls get fresh state.
 *
 * Input: { path, machineId, branch }
 * Response: { success, branch?, error? }
 */
repoRoute.post('/create-branch', async (c) => {
  const { path, machineId, branch } = await c.req.json<{ path: string; machineId: string; branch: string }>()

  if (!path || !machineId || !branch) {
    return c.json({ error: 'path, machineId, and branch are required' }, 400)
  }

  if (path.includes('..')) {
    return c.json({ error: 'path must not contain ".."' }, 400)
  }

  try {
    const result = await requestRemoteGitCreateBranch(machineId, path, branch)
    const cacheKey = detectCacheKey(machineId, path)
    detectCache.delete(cacheKey)
    if (result.error) {
      return c.json(result, 500)
    }
    return c.json(result)
  } catch (error) {
    const message = errorMessage(error)
    console.error('[repo] Git create-branch failed:', message)
    return c.json({ success: false, error: `Git create-branch failed: ${message}` }, 500)
  }
})

/**
 * POST /api/repo/setup
 *
 * Main endpoint called during project creation to set up a git-backed directory.
 * Routes request to connected machine via relay. If no targetMachineId,
 * auto-selects the best available machine.
 *
 * Input: { projectId, projectName, projectDescription?, workingDirectory?, repository?, baseBranch?, targetMachineId? }
 * Response: { workingDirectory, fileTree, needsGitInit?, claudeMdCreated?, gitignoreCreated? }
 */
repoRoute.post('/setup', async (c) => {
  const body = await c.req.json<{
    projectId: string
    projectName: string
    projectDescription?: string
    workingDirectory?: string
    repository?: string
    baseBranch?: string
    targetMachineId?: string
  }>()

  const { projectId, projectName, projectDescription, workingDirectory, repository, baseBranch, targetMachineId } = body

  if (!projectId || !projectName) {
    return c.json({ error: 'projectId and projectName are required' }, 400)
  }

  if (workingDirectory?.includes('..')) {
    return c.json({ error: 'workingDirectory must not contain ".."' }, 400)
  }

  // Determine target machine: use provided or auto-select best
  let machineId = targetMachineId
  if (!machineId) {
    const repoUser = c.get('user') as AuthUser | undefined
    const bestMachine = machineRegistry.findBestMachine(undefined, repoUser?.id)
    if (!bestMachine) {
      return c.json({ error: 'No connected machine available. Connect an agent runner to set up repositories.' }, 503)
    }
    machineId = bestMachine.machineId
  }

  try {
    const result = await requestRemoteRepoSetup(machineId, {
      projectId,
      projectName,
      projectDescription,
      workingDirectory,
      repository,
      baseBranch,
    })

    if (!result.success) {
      return c.json({ error: result.error || 'Remote repo setup failed' }, 500)
    }

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
 * Routes request to connected machine via relay.
 *
 * Input: { workingDirectory, projectId, projectName, projectDescription?, targetMachineId? }
 * Response: { workingDirectory, fileTree, source?, deliveryMode? }
 */
repoRoute.post('/git-init', async (c) => {
  const body = await c.req.json<{
    workingDirectory: string
    projectId: string
    projectName: string
    projectDescription?: string
    targetMachineId?: string
  }>()

  const { workingDirectory, projectId, projectName, projectDescription, targetMachineId } = body

  if (!workingDirectory) {
    return c.json({ error: 'workingDirectory is required' }, 400)
  }

  // Determine target machine: use provided or auto-select best
  let machineId = targetMachineId
  if (!machineId) {
    const repoUser = c.get('user') as AuthUser | undefined
    const bestMachine = machineRegistry.findBestMachine(undefined, repoUser?.id)
    if (!bestMachine) {
      return c.json({ error: 'No connected machine available. Connect an agent runner to initialize git.' }, 503)
    }
    machineId = bestMachine.machineId
  }

  try {
    const result = await requestRemoteGitInit(machineId, {
      workingDirectory,
      projectId,
      projectName,
      projectDescription,
    })

    if (!result.success) {
      return c.json({ error: result.error || 'Remote git init failed' }, 500)
    }

    // Invalidate detect cache — git status changed (was non-git, now is git)
    invalidateDetectCache(machineId, workingDirectory)

    return c.json(result)
  } catch (error) {
    const message = errorMessage(error)
    console.error('[repo] Git init failed:', message)
    return c.json({ error: `Git init failed: ${message}` }, 500)
  }
})

// File tree endpoint removed — file listing always goes through relay via /api/fs/files

export { repoRoute, requestRemoteRepoDetect }

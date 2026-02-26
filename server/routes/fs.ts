/**
 * File system routes - provides file listing for @-completion via relay
 * All file operations go through connected machines — backend never touches filesystem directly.
 */

import { Hono } from 'hono'
import { relayServer } from '../lib/relay-server.js'
import { requireAuth } from '../middleware/auth.js'

const MAX_RESULTS = 50

export const fsRoute = new Hono()

// All fs routes require authentication
fsRoute.use('/*', requireAuth)

/**
 * GET /files?projectId=xxx&machineId=yyy&q=prefix&workingDirectory=path
 *
 * Lists files for a project's working directory via relay to a connected machine.
 * Requires machineId — no local filesystem fallback.
 */
fsRoute.get('/files', async (c) => {
  const projectId = c.req.query('projectId')
  const query = c.req.query('q') || ''
  const machineId = c.req.query('machineId')
  const workingDirectory = c.req.query('workingDirectory')

  if (!projectId) {
    return c.json({ error: 'projectId is required' }, 400)
  }

  if (!machineId) {
    return c.json({ error: 'machineId is required' }, 400)
  }

  if (!workingDirectory) {
    return c.json({ files: [] })
  }

  try {
    const files = await requestRemoteFileList(machineId, workingDirectory, query)
    return c.json({ files })
  } catch (error) {
    console.error('[fs] Error listing files:', error)
    return c.json({ files: [] })
  }
})

/** Directory entry info for path browser */
interface DirectoryEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink?: boolean
}

/** Response type for directory listing */
interface DirectoryListResult {
  path: string
  entries: DirectoryEntry[]
  error?: string
  homeDirectory?: string
}

/**
 * GET /directories?machineId=yyy&path=/some/path
 *
 * Lists directories for remote path browsing via relay to a connected machine.
 * If path is empty or '~', returns the home directory listing.
 */
fsRoute.get('/directories', async (c) => {
  const machineId = c.req.query('machineId')
  const path = c.req.query('path') || '~'

  if (!machineId) {
    return c.json({ error: 'machineId is required' }, 400)
  }

  try {
    const result = await requestDirectoryList(machineId, path)
    return c.json(result)
  } catch (error) {
    console.error('[fs] Error listing directories:', error)
    return c.json({ path, entries: [], error: 'Failed to list directory' })
  }
})

/**
 * Request directory listing from a remote machine via relay
 */
async function requestDirectoryList(
  machineId: string,
  path: string,
): Promise<DirectoryListResult> {
  const correlationId = crypto.randomUUID()

  return new Promise<DirectoryListResult>((resolve) => {
    const timeout = setTimeout(() => {
      relayServer.removeListener('directory_list:response', handler)
      resolve({ path, entries: [], error: 'Request timed out' })
    }, 10000) // 10 second timeout for directory listing

    function handler(data: { correlationId: string; path: string; entries: DirectoryEntry[]; error?: string; homeDirectory?: string }) {
      if (data.correlationId !== correlationId) return
      clearTimeout(timeout)
      relayServer.removeListener('directory_list:response', handler)

      resolve({
        path: data.path,
        entries: data.entries || [],
        error: data.error,
        homeDirectory: data.homeDirectory,
      })
    }

    relayServer.on('directory_list:response', handler)

    const sent = relayServer.requestDirectoryList(machineId, path, correlationId)
    if (!sent) {
      clearTimeout(timeout)
      relayServer.removeListener('directory_list:response', handler)
      resolve({ path, entries: [], error: 'Machine not connected' })
    }
  })
}

/** Response type for create directory */
interface CreateDirectoryResult {
  success: boolean
  path?: string
  error?: string
}

/**
 * POST /directories
 *
 * Creates a new folder on a remote machine via relay.
 * Body: { machineId, path (parent), name }
 */
fsRoute.post('/directories', async (c) => {
  const body = await c.req.json<{ machineId?: string; path?: string; name?: string }>()
  const { machineId, path, name } = body

  if (!machineId) {
    return c.json({ error: 'machineId is required' }, 400)
  }

  if (!path) {
    return c.json({ error: 'path is required' }, 400)
  }

  if (!name || name.trim().length === 0) {
    return c.json({ error: 'name is required' }, 400)
  }

  // Validate folder name: no path separators or null bytes, not . or ..
  const trimmedName = name.trim()
  if (trimmedName === '.' || trimmedName === '..') {
    return c.json({ error: 'Invalid folder name' }, 400)
  }
  if (/[/\\\0]/.test(trimmedName)) {
    return c.json({ error: 'Folder name cannot contain path separators' }, 400)
  }

  try {
    const result = await requestCreateDirectory(machineId, path, trimmedName)
    return c.json(result, result.success ? 200 : 500)
  } catch (error) {
    console.error('[fs] Error creating directory:', error)
    return c.json({ success: false, error: 'Failed to create directory' }, 500)
  }
})

/**
 * Request directory creation on a remote machine via relay
 */
async function requestCreateDirectory(
  machineId: string,
  parentPath: string,
  name: string,
): Promise<CreateDirectoryResult> {
  const correlationId = crypto.randomUUID()

  return new Promise<CreateDirectoryResult>((resolve) => {
    const timeout = setTimeout(() => {
      relayServer.removeListener('create_directory:response', handler)
      resolve({ success: false, error: 'Request timed out' })
    }, 10000)

    function handler(data: { correlationId: string; success: boolean; path?: string; error?: string }) {
      if (data.correlationId !== correlationId) return
      clearTimeout(timeout)
      relayServer.removeListener('create_directory:response', handler)

      resolve({
        success: data.success,
        path: data.path,
        error: data.error,
      })
    }

    relayServer.on('create_directory:response', handler)

    const sent = relayServer.requestCreateDirectory(machineId, parentPath, name, correlationId)
    if (!sent) {
      clearTimeout(timeout)
      relayServer.removeListener('create_directory:response', handler)
      resolve({ success: false, error: 'Machine not connected' })
    }
  })
}

/**
 * Request file list from a remote machine via relay
 */
async function requestRemoteFileList(
  machineId: string,
  workingDirectory: string,
  query: string,
): Promise<string[]> {
  const correlationId = crypto.randomUUID()

  return new Promise<string[]>((resolve) => {
    const timeout = setTimeout(() => {
      relayServer.removeListener('file_list:response', handler)
      resolve([])
    }, 5000)

    function handler(data: { correlationId: string; files: string[] }) {
      if (data.correlationId !== correlationId) return
      clearTimeout(timeout)
      relayServer.removeListener('file_list:response', handler)

      let files = data.files
      if (query) {
        const lowerQuery = query.toLowerCase()
        files = files.filter((f) => f.toLowerCase().includes(lowerQuery))
      }
      resolve(files.slice(0, MAX_RESULTS))
    }

    relayServer.on('file_list:response', handler)

    const sent = relayServer.requestFileList(machineId, workingDirectory, correlationId)
    if (!sent) {
      clearTimeout(timeout)
      relayServer.removeListener('file_list:response', handler)
      resolve([])
    }
  })
}

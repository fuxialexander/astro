/**
 * File system routes - provides file listing for @-completion via relay
 * All file operations go through connected machines — backend never touches filesystem directly.
 *
 * Directory listings are cached in-memory (30s TTL) to avoid relay round-trips
 * for repeated navigations (parent dirs, re-opening the browser dialog).
 */

import { Hono } from 'hono'
import { relayServer } from '../lib/relay-server.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { getMachine, getTeamSharedMachineIds } from '../lib/registered-machines-store.js'
import { LOCAL_USER_ID } from '../lib/db/bootstrap-local.js'

const MAX_RESULTS = 50

// --- In-memory cache for directory listings (per-instance, best-effort) ---
// This is a read-through cache: misses always fall through to the relay.
// With 2 Fly.io instances (round-robin), hit rate is ~50% per instance.
// No correctness depends on the cache — it only reduces relay latency.
// Same pattern as machineRegistry (in-memory WebSocket handles).
const DIR_CACHE_TTL_MS = 30_000 // 30 seconds
const DIR_CACHE_MAX_ENTRIES = 200

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const dirCache = new Map<string, CacheEntry<DirectoryListResult>>()

// Scoped per-user so one user's cached listing never leaks to another
function dirCacheKey(userId: string, machineId: string, path: string): string {
  return `${userId}:${machineId}:${path}`
}

function getCachedDirList(userId: string, machineId: string, path: string): DirectoryListResult | null {
  const key = dirCacheKey(userId, machineId, path)
  const entry = dirCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    dirCache.delete(key)
    return null
  }
  return entry.data
}

function setCachedDirList(userId: string, machineId: string, path: string, data: DirectoryListResult): void {
  if (dirCache.size >= DIR_CACHE_MAX_ENTRIES) {
    // Evict expired entries first, then oldest by insertion if still over limit
    const now = Date.now()
    for (const [k, v] of dirCache) {
      if (v.expiresAt < now) dirCache.delete(k)
    }
    if (dirCache.size >= DIR_CACHE_MAX_ENTRIES) {
      const oldest = dirCache.keys().next().value
      if (oldest) dirCache.delete(oldest)
    }
  }
  dirCache.set(dirCacheKey(userId, machineId, path), {
    data,
    expiresAt: Date.now() + DIR_CACHE_TTL_MS,
  })
}

/**
 * Verify the authenticated user has access to the given machine.
 * Mirrors the ownership check in relay.ts.
 */
async function verifyMachineAccess(machineId: string, user: AuthUser): Promise<boolean> {
  const machine = await getMachine(machineId)
  if (!machine?.userId || machine.userId === LOCAL_USER_ID) return true
  if (machine.userId === user.id) return true
  const teamSharedIds = user.teamIds?.length ? await getTeamSharedMachineIds(user.teamIds) : new Set<string>()
  return teamSharedIds.has(machineId)
}

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
  const user = c.get('user') as AuthUser
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

  if (!await verifyMachineAccess(machineId, user)) {
    return c.json({ files: [] })
  }

  // Fast-fail for ghost machines
  const reachable = await relayServer.isMachineReachable(machineId)
  if (!reachable) {
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
  const user = c.get('user') as AuthUser
  const machineId = c.req.query('machineId')
  const path = c.req.query('path') || '~'
  const noCache = c.req.query('noCache') === '1'

  if (!machineId) {
    return c.json({ error: 'machineId is required' }, 400)
  }

  if (!await verifyMachineAccess(machineId, user)) {
    return c.json({ path, entries: [], error: 'Machine not found' })
  }

  // Check in-memory cache first (skip relay round-trip for repeated navigations)
  if (!noCache) {
    const cached = getCachedDirList(user.id, machineId, path)
    if (cached) {
      return c.json(cached)
    }
  }

  // Fast-fail for ghost machines — check if any instance actually owns the WebSocket
  const reachable = await relayServer.isMachineReachable(machineId)
  if (!reachable) {
    console.warn(`[fs] Machine ${machineId} not reachable (ghost or disconnected)`)
    return c.json({ path, entries: [], error: 'Machine not connected' })
  }

  try {
    const result = await requestDirectoryList(machineId, path)
    // Cache successful results (no error, has entries or is a valid empty dir)
    if (!result.error) {
      setCachedDirList(user.id, machineId, path, result)
    }
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
      console.warn(`[fs] directory_list TIMEOUT cid=${correlationId} machineId=${machineId} path=${path}`)
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
    console.log(`[fs] requestDirectoryList sent=${sent} cid=${correlationId} machineId=${machineId}`)
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
  const user = c.get('user') as AuthUser
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

  if (!await verifyMachineAccess(machineId, user)) {
    return c.json({ success: false, error: 'Machine not found' }, 404)
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

// ============================================================================
// File Content (Download / Preview)
// ============================================================================

/** Response type for file content */
interface FileContentResult {
  content: Buffer
  mimeType: string
  size: number
  error?: string
}

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

/**
 * Validate that a path is absolute (starts with / or drive letter on Windows)
 */
function validateAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path)
}

/**
 * GET /content?machineId=yyy&path=/some/file&download=true
 *
 * Reads file content from a remote machine via relay.
 * Supports inline preview (default) or download mode.
 * Supports Range header for partial content (e.g., PDF streaming).
 */
fsRoute.get('/content', async (c) => {
  const user = c.get('user') as AuthUser
  const machineId = c.req.query('machineId')
  const filePath = c.req.query('path')
  const download = c.req.query('download') === 'true'

  if (!machineId) {
    return c.json({ error: 'machineId is required' }, 400)
  }

  if (!filePath) {
    return c.json({ error: 'path is required' }, 400)
  }

  if (!validateAbsolutePath(filePath)) {
    return c.json({ error: 'path must be an absolute path' }, 400)
  }

  if (!await verifyMachineAccess(machineId, user)) {
    return c.json({ error: 'Machine not found' }, 404)
  }

  try {
    const result = await requestFileContent(machineId, filePath)

    if (result.error) {
      return c.json({ error: result.error }, result.error.includes('not found') ? 404 : 500)
    }

    // Sanitize filename to prevent Content-Disposition header injection
    const safeName = (filePath.split('/').pop() || 'file').replace(/["\r\n]/g, '_')
    const disposition = download ? `attachment; filename="${safeName}"` : 'inline'

    // Handle Range header for partial content
    const rangeHeader = c.req.header('Range')
    if (rangeHeader && result.content.length > 0) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
      if (match) {
        const start = parseInt(match[1], 10)
        const end = match[2] ? parseInt(match[2], 10) : result.content.length - 1
        const clampedEnd = Math.min(end, result.content.length - 1)

        if (start > clampedEnd || start >= result.content.length) {
          return new Response(null, {
            status: 416,
            headers: {
              'Content-Range': `bytes */${result.content.length}`,
            },
          })
        }

        const slice = result.content.subarray(start, clampedEnd + 1)
        return new Response(slice, {
          status: 206,
          headers: {
            'Content-Type': result.mimeType,
            'Content-Disposition': disposition,
            'Content-Length': String(slice.length),
            'Content-Range': `bytes ${start}-${clampedEnd}/${result.content.length}`,
            'Accept-Ranges': 'bytes',
          },
        })
      }
    }

    return new Response(result.content, {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Disposition': disposition,
        'Content-Length': String(result.content.length),
        'Accept-Ranges': 'bytes',
      },
    })
  } catch (error) {
    console.error('[fs] Error reading file content:', error)
    return c.json({ error: 'Failed to read file content' }, 500)
  }
})

/**
 * Request file content from a remote machine via relay.
 * Handles chunked responses — collects all chunks before returning.
 */
async function requestFileContent(
  machineId: string,
  path: string,
): Promise<FileContentResult> {
  const correlationId = crypto.randomUUID()

  return new Promise<FileContentResult>((resolve) => {
    const timeout = setTimeout(() => {
      relayServer.removeListener('file_content:response', handler)
      resolve({ content: Buffer.alloc(0), mimeType: 'application/octet-stream', size: 0, error: 'Request timed out' })
    }, 30000) // 30 second timeout for file transfer

    // Collect chunks for chunked transfers
    const chunks: Map<number, string> = new Map()
    let totalChunks = 1
    let encoding: string = 'utf-8'
    let mimeType: string = 'application/octet-stream'
    let totalSize: number = 0

    function handler(data: {
      correlationId: string
      path: string
      content?: string
      encoding?: string
      mimeType?: string
      size?: number
      chunked?: boolean
      chunkIndex?: number
      totalChunks?: number
      error?: string
    }) {
      if (data.correlationId !== correlationId) return

      // Error response
      if (data.error) {
        clearTimeout(timeout)
        relayServer.removeListener('file_content:response', handler)
        resolve({ content: Buffer.alloc(0), mimeType: 'application/octet-stream', size: 0, error: data.error })
        return
      }

      if (data.mimeType) mimeType = data.mimeType
      if (data.encoding) encoding = data.encoding
      if (data.size) totalSize = data.size

      if (data.chunked && data.totalChunks && data.totalChunks > 1) {
        // Chunked response
        totalChunks = data.totalChunks
        if (data.content && data.chunkIndex !== undefined) {
          chunks.set(data.chunkIndex, data.content)
        }

        // Check if all chunks received
        if (chunks.size >= totalChunks) {
          clearTimeout(timeout)
          relayServer.removeListener('file_content:response', handler)

          // Reassemble chunks in order
          const orderedContent = Array.from({ length: totalChunks }, (_, i) => chunks.get(i) || '').join('')
          const buffer = encoding === 'base64'
            ? Buffer.from(orderedContent, 'base64')
            : Buffer.from(orderedContent, 'utf-8')

          resolve({ content: buffer, mimeType, size: totalSize || buffer.length })
        }
      } else {
        // Single response (non-chunked)
        clearTimeout(timeout)
        relayServer.removeListener('file_content:response', handler)

        const buffer = data.content
          ? (encoding === 'base64' ? Buffer.from(data.content, 'base64') : Buffer.from(data.content, 'utf-8'))
          : Buffer.alloc(0)

        resolve({ content: buffer, mimeType, size: totalSize || buffer.length })
      }
    }

    relayServer.on('file_content:response', handler)

    const sent = relayServer.requestFileContent(machineId, path, correlationId)
    if (!sent) {
      clearTimeout(timeout)
      relayServer.removeListener('file_content:response', handler)
      resolve({ content: Buffer.alloc(0), mimeType: 'application/octet-stream', size: 0, error: 'Machine not connected' })
    }
  })
}

// ============================================================================
// File Upload
// ============================================================================

/** Response type for file upload */
interface FileUploadResult {
  success: boolean
  path?: string
  size?: number
  error?: string
  conflict?: boolean
}

const CHUNK_SIZE = 1024 * 1024 // 1MB chunks

/**
 * POST /content
 *
 * Uploads a file to a remote machine via relay.
 * Accepts multipart/form-data with fields: machineId, destinationPath, file, overwrite
 * Files are split into ~1MB chunks and sent sequentially.
 */
fsRoute.post('/content', async (c) => {
  try {
    const user = c.get('user') as AuthUser
    const body = await c.req.parseBody()
    const machineId = body['machineId'] as string | undefined
    const destinationPath = body['destinationPath'] as string | undefined
    const overwrite = body['overwrite'] === 'true'
    const file = body['file']

    if (!machineId) {
      return c.json({ error: 'machineId is required' }, 400)
    }

    if (!destinationPath) {
      return c.json({ error: 'destinationPath is required' }, 400)
    }

    if (!validateAbsolutePath(destinationPath)) {
      return c.json({ error: 'destinationPath must be an absolute path' }, 400)
    }

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'file is required (multipart form field)' }, 400)
    }

    if (!await verifyMachineAccess(machineId, user)) {
      return c.json({ error: 'Machine not found' }, 404)
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return c.json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB` }, 413)
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const fileName = file.name || 'upload'

    const result = await requestFileUpload(machineId, destinationPath, fileName, fileBuffer, overwrite)

    if (!result.success) {
      const status = result.conflict ? 409 : 500
      return c.json({ error: result.error, conflict: result.conflict }, status)
    }

    return c.json({ success: true, path: result.path, size: result.size })
  } catch (error) {
    console.error('[fs] Error uploading file:', error)
    return c.json({ error: 'Failed to upload file' }, 500)
  }
})

/**
 * Upload a file to a remote machine via relay.
 * Splits the file into chunks and sends them sequentially.
 */
async function requestFileUpload(
  machineId: string,
  destinationPath: string,
  fileName: string,
  fileBuffer: Buffer,
  overwrite: boolean,
): Promise<FileUploadResult> {
  const correlationId = crypto.randomUUID()
  const totalChunks = Math.max(1, Math.ceil(fileBuffer.length / CHUNK_SIZE))

  return new Promise<FileUploadResult>((resolve) => {
    const timeout = setTimeout(() => {
      relayServer.removeListener('file_upload:response', handler)
      resolve({ success: false, error: 'Upload timed out' })
    }, 60000) // 60 second timeout for uploads

    function handler(data: { correlationId: string; success: boolean; path?: string; error?: string }) {
      if (data.correlationId !== correlationId) return
      clearTimeout(timeout)
      relayServer.removeListener('file_upload:response', handler)

      if (!data.success) {
        const isConflict = data.error?.toLowerCase().includes('exists') || data.error?.toLowerCase().includes('conflict')
        resolve({ success: false, error: data.error, conflict: isConflict })
        return
      }

      resolve({ success: true, path: data.path, size: fileBuffer.length })
    }

    relayServer.on('file_upload:response', handler)

    // Step 1: Send the upload request
    const sent = relayServer.requestFileUpload(
      machineId,
      destinationPath,
      fileName,
      fileBuffer.length,
      totalChunks,
      overwrite,
      correlationId,
    )

    if (!sent) {
      clearTimeout(timeout)
      relayServer.removeListener('file_upload:response', handler)
      resolve({ success: false, error: 'Machine not connected' })
      return
    }

    // Step 2: Send chunks sequentially
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, fileBuffer.length)
      const chunk = fileBuffer.subarray(start, end)
      const base64Content = chunk.toString('base64')

      const chunkSent = relayServer.sendFileUploadChunk(
        machineId,
        correlationId,
        i,
        'base64',
        base64Content,
      )

      if (!chunkSent) {
        clearTimeout(timeout)
        relayServer.removeListener('file_upload:response', handler)
        resolve({ success: false, error: 'Lost connection during upload' })
        return
      }
    }
  })
}

// ============================================================================
// Content Search (ripgrep on remote machine via relay)
// ============================================================================

interface ContentSearchMatch {
  path: string
  lineNo: number
  line: string
  matchStart: number
  matchEnd: number
}

/**
 * GET /search?machineId=yyy&root=/path&pattern=query
 *
 * Full-text content search on a remote machine via relay (ripgrep).
 * Agent runner must handle content_search_request for this to return results.
 */
fsRoute.get('/search', async (c) => {
  const user = c.get('user') as AuthUser
  const machineId = c.req.query('machineId')
  const root = c.req.query('root')
  const pattern = c.req.query('pattern')

  if (!machineId || !root || !pattern) {
    return c.json({ matches: [], error: 'machineId, root, and pattern are required' }, 400)
  }

  if (root.includes('..') || !root.startsWith('/')) {
    return c.json({ matches: [], error: 'Invalid root path' }, 400)
  }

  if (!await verifyMachineAccess(machineId, user)) {
    return c.json({ matches: [], error: 'Machine not found' })
  }

  const reachable = await relayServer.isMachineReachable(machineId)
  if (!reachable) {
    return c.json({ matches: [], error: 'Machine not connected' })
  }

  try {
    const matches = await requestContentSearch(machineId, root, pattern)
    return c.json({ matches })
  } catch (error) {
    console.error('[fs] Content search error:', error)
    return c.json({ matches: [], error: 'Search failed' }, 500)
  }
})

async function requestContentSearch(
  machineId: string,
  root: string,
  pattern: string,
): Promise<ContentSearchMatch[]> {
  const correlationId = crypto.randomUUID()

  return new Promise<ContentSearchMatch[]>((resolve) => {
    const timeout = setTimeout(() => {
      relayServer.removeListener('content_search:response', handler)
      resolve([])
    }, 15000)

    function handler(data: { correlationId: string; matches: ContentSearchMatch[]; error?: string }) {
      if (data.correlationId !== correlationId) return
      clearTimeout(timeout)
      relayServer.removeListener('content_search:response', handler)
      resolve(data.matches ?? [])
    }

    relayServer.on('content_search:response', handler)

    const sent = relayServer.requestContentSearch(machineId, root, pattern, correlationId)
    if (!sent) {
      clearTimeout(timeout)
      relayServer.removeListener('content_search:response', handler)
      resolve([])
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

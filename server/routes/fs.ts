/**
 * File system routes - provides file listing for @-completion
 */

import { Hono } from 'hono'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { relayServer } from '../lib/relay-server.js'

const MAX_RESULTS = 50

/** Directories to exclude when falling back to find */
const FIND_EXCLUDES = [
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache',
  'target', '.gradle', '.idea', '.vscode', '.DS_Store',
]

export const fsRoute = new Hono()

/**
 * GET /files?projectId=xxx&q=prefix&machineId=optional&workingDirectory=path
 *
 * Lists files for a project's working directory.
 * - Local (no machineId): tries `git ls-files`, falls back to `find`
 * - Remote (machineId provided): sends file_list request via relay
 */
fsRoute.get('/files', async (c) => {
  const projectId = c.req.query('projectId')
  const query = c.req.query('q') || ''
  const machineId = c.req.query('machineId')
  const workingDirectory = c.req.query('workingDirectory')

  if (!projectId) {
    return c.json({ error: 'projectId is required' }, 400)
  }

  if (!workingDirectory && !machineId) {
    return c.json({ files: [] })
  }

  try {
    let files: string[]

    if (machineId) {
      files = await requestRemoteFileList(machineId, workingDirectory || '', query)
    } else {
      files = getLocalFiles(workingDirectory!, query)
    }

    return c.json({ files })
  } catch (error) {
    console.error('[fs] Error listing files:', error)
    return c.json({ files: [] })
  }
})

/**
 * Get files from a local directory.
 * Tries git ls-files first (fast, respects .gitignore).
 * Falls back to find with common exclusions.
 */
function getLocalFiles(workingDirectory: string, query: string): string[] {
  if (!existsSync(workingDirectory)) return []

  let files = tryGitLsFiles(workingDirectory)
  if (!files) {
    files = tryFind(workingDirectory)
  }
  if (!files) return []

  if (query) {
    const lowerQuery = query.toLowerCase()
    files = files.filter((f) => f.toLowerCase().includes(lowerQuery))
  }

  return files.slice(0, MAX_RESULTS)
}

function tryGitLsFiles(cwd: string): string[] | null {
  try {
    const output = execFileSync('git', ['ls-files'], {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    })
    const files = output.trim().split('\n').filter(Boolean)
    return files.length > 0 ? files : null
  } catch {
    return null
  }
}

function tryFind(cwd: string): string[] | null {
  try {
    const pruneArgs = FIND_EXCLUDES.flatMap((d) => ['-name', d, '-o']).slice(0, -1)
    const args = [
      '.', '(', ...pruneArgs, ')', '-prune', '-o',
      '-type', 'f', '-print',
    ]
    const output = execFileSync('find', args, {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    })
    // Strip leading './' from paths
    const files = output.trim().split('\n')
      .filter(Boolean)
      .map((f) => f.replace(/^\.\//, ''))
    return files.length > 0 ? files : null
  } catch {
    return null
  }
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

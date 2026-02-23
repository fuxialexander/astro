/**
 * File system routes - provides file listing for @-completion via relay
 * All file operations go through connected machines — backend never touches filesystem directly.
 */

import { Hono } from 'hono'
import { relayServer } from '../lib/relay-server.js'

const MAX_RESULTS = 50

export const fsRoute = new Hono()

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

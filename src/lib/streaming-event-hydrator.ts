/**
 * Streaming Event Hydrator
 *
 * Processes raw streaming events from the server (persisted in realtime stream tables)
 * and reconstructs structured task data including tool traces, file changes, and stdout.
 */

export interface StreamingEventRecord {
  seq: number
  executionId: string
  eventType: string
  data: unknown
  timestamp?: string
}

export interface HydratedStreamingData {
  stdout: string
  output?: string
  status?: string
  error?: string
  sessionId?: string
  model?: string
  progress?: number
  progressMessage?: string
  branchName?: string
  prUrl?: string
  prNumber?: number
  deliveryStatus?: string
  activityEvents: Array<unknown>
  toolTraces: Array<{
    toolName: string
    toolInput: unknown
    toolResult?: unknown
    success?: boolean
    duration?: number
    timestamp: Date
  }>
  fileChanges: Array<{
    path: string
    action: string
    linesAdded?: number
    linesRemoved?: number
    diff?: string
    timestamp: Date
  }>
}

/**
 * Hydrate streaming events into structured task data
 * Processes tool_use → tool_result pairs and file_change events
 */
export function hydrateStreamingEvents(events: StreamingEventRecord[]): HydratedStreamingData {
  const result: HydratedStreamingData = {
    stdout: '',
    activityEvents: [],
    toolTraces: [],
    fileChanges: [],
  }

  const toolUseMap = new Map<string, { input: unknown; timestamp: Date }>()

  for (const event of events) {
    const timestamp = event.timestamp ? new Date(event.timestamp) : new Date()

    switch (event.eventType) {
      case 'text':
      case 'stdout':
        if (typeof event.data === 'string') {
          result.stdout += event.data
        } else if (event.data && typeof event.data === 'object' && 'text' in event.data) {
          result.stdout += (event.data as { text: string }).text
        }
        break

      case 'session_init':
        if (event.data && typeof event.data === 'object') {
          const data = event.data as { sessionId?: string; model?: string }
          if (data.sessionId) result.sessionId = data.sessionId
          if (data.model) result.model = data.model
        }
        break

      case 'result':
        if (event.data && typeof event.data === 'object') {
          const data = event.data as { status?: string; output?: string; error?: string }
          if (data.status) result.status = data.status
          if (data.error) result.error = data.error
          if (data.output && typeof data.output === 'string') {
            result.stdout += data.output
          }
        }
        break

      case 'progress':
        if (event.data && typeof event.data === 'object') {
          const data = event.data as { progress?: number; message?: string }
          if (data.progress !== undefined) result.progress = data.progress
          if (data.message) result.progressMessage = data.message
        }
        break

      case 'tool_use':
        if (event.data && typeof event.data === 'object') {
          const data = event.data as { toolName?: string; input?: unknown }
          const toolName = data.toolName || 'unknown'
          toolUseMap.set(toolName, {
            input: data.input,
            timestamp,
          })
          result.activityEvents.push({
            type: 'tool_use',
            data: event.data,
            timestamp,
          })
        }
        break

      case 'tool_result':
        if (event.data && typeof event.data === 'object') {
          const data = event.data as { toolName?: string; result?: unknown; success?: boolean }
          const toolName = data.toolName || 'unknown'
          const toolUse = toolUseMap.get(toolName)

          result.toolTraces.push({
            toolName,
            toolInput: toolUse?.input,
            toolResult: data.result,
            success: data.success,
            timestamp: toolUse?.timestamp || timestamp,
          })

          result.activityEvents.push({
            type: 'tool_result',
            data: event.data,
            timestamp,
          })
        }
        break

      case 'file_change':
        if (event.data && typeof event.data === 'object') {
          const data = event.data as {
            path?: string
            action?: string
            linesAdded?: number
            linesRemoved?: number
            diff?: string
          }
          result.fileChanges.push({
            path: data.path || 'unknown',
            action: data.action || 'modified',
            linesAdded: data.linesAdded,
            linesRemoved: data.linesRemoved,
            diff: data.diff,
            timestamp,
          })

          result.activityEvents.push({
            type: 'file_change',
            data: event.data,
            timestamp,
          })
        }
        break

      case 'error':
        if (event.data && typeof event.data === 'object') {
          const data = event.data as { error?: string }
          if (data.error) result.error = data.error
        }
        result.activityEvents.push({
          type: 'error',
          data: event.data,
          timestamp,
        })
        break
    }
  }

  return result
}

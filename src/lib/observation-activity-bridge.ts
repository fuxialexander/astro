/**
 * Bridge utility: converts observation TraceTree data into
 * TaskActivityEvent[], ToolTrace[], and FileChange[] arrays.
 *
 * Used to reconstruct activity views from persisted observation data
 * after page refresh (when in-memory SSE events are lost).
 */

import type { TraceTree } from "@/types/observations"
import type { TaskActivityEvent, ToolTrace, FileChange } from "@/types"

export function reconstructActivityFromTrace(trace: TraceTree): {
  activityEvents: TaskActivityEvent[]
  toolTraces: ToolTrace[]
  fileChanges: FileChange[]
} {
  const activityEvents: TaskActivityEvent[] = []
  const toolTraces: ToolTrace[] = []
  const fileChanges: FileChange[] = []

  // Process each generation turn
  for (const turn of trace.turns) {
    const genTime = new Date(turn.generation.startTime)

    // Text output from generation
    if (turn.text) {
      activityEvents.push({
        type: 'text',
        content: turn.text,
        timestamp: genTime,
      })
    }

    // Tool calls within this turn
    for (const tc of turn.toolCalls) {
      const toolTime = new Date(tc.toolObs.startTime)
      const toolEndTime = tc.toolObs.endTime ? new Date(tc.toolObs.endTime) : toolTime
      const toolId = tc.toolObs.id

      // tool_use event
      activityEvents.push({
        type: 'tool_use',
        id: toolId,
        toolName: tc.name,
        toolInput: tc.input,
        timestamp: toolTime,
      })

      // tool_result event
      activityEvents.push({
        type: 'tool_result',
        id: toolId,
        toolName: tc.name,
        toolResult: tc.output,
        success: tc.success,
        duration: tc.durationMs ?? undefined,
        timestamp: toolEndTime,
      })

      // ToolTrace entry
      toolTraces.push({
        id: toolId,
        toolName: tc.name,
        toolInput: tc.input,
        toolResult: tc.output,
        success: tc.success,
        duration: tc.durationMs ?? undefined,
        timestamp: toolTime,
      })
    }
  }

  // Process events for file changes
  for (const event of trace.events) {
    if (event.name === 'file:change' || event.name === 'file_change') {
      const meta = (event.metadata || {}) as Record<string, unknown>
      const input = (event.input || {}) as Record<string, unknown>
      const path = (meta.path || input.path || '') as string
      const action = (meta.action || input.action || 'modify') as 'create' | 'modify' | 'delete'

      if (path) {
        const fc: FileChange = {
          path,
          action,
          linesAdded: (meta.linesAdded || input.linesAdded) as number | undefined,
          linesRemoved: (meta.linesRemoved || input.linesRemoved) as number | undefined,
          diff: (meta.diff || input.diff) as string | undefined,
          timestamp: new Date(event.startTime),
        }
        fileChanges.push(fc)

        activityEvents.push({
          type: 'file_change',
          path: fc.path,
          action: fc.action,
          diff: fc.diff,
          linesAdded: fc.linesAdded,
          linesRemoved: fc.linesRemoved,
          timestamp: fc.timestamp,
        })
      }
    }
  }

  // Also extract file changes from tool calls (e.g., Write, Edit tools)
  // when no explicit file:change event was emitted for that path
  const existingPaths = new Set(fileChanges.map(f => f.path))
  for (const turn of trace.turns) {
    for (const tc of turn.toolCalls) {
      if (tc.name === 'Write' || tc.name === 'Edit') {
        const input = (tc.input || {}) as Record<string, unknown>
        const path = (input.file_path || input.path || '') as string
        if (path && !existingPaths.has(path)) {
          existingPaths.add(path)
          const action = tc.name === 'Write' ? 'create' as const : 'modify' as const
          const timestamp = new Date(tc.toolObs.startTime)
          fileChanges.push({ path, action, timestamp })
          activityEvents.push({
            type: 'file_change',
            path,
            action,
            timestamp,
          })
        }
      }
    }
  }

  // Sort all events chronologically
  activityEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  return { activityEvents, toolTraces, fileChanges }
}

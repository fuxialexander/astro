/**
 * Execution output store. Ring buffers for streaming task output.
 * Tool calls are collapsed into compact dot-trails for readability.
 */
import { create } from 'zustand'

const MAX_LINES = 5000

export interface ExecutionOutput {
  executionId: string
  nodeId: string
  lines: string[]
  status: string
  startedAt: string | null
  /** Accumulator for consecutive tool calls — flushed as dots on next text */
  pendingToolCount: number
}

export interface ExecutionState {
  outputs: Map<string, ExecutionOutput>
  /** Currently watched execution ID (shown in output panel) */
  watchingId: string | null
}

export interface ExecutionActions {
  appendLine: (executionId: string, line: string) => void
  appendText: (executionId: string, text: string) => void
  appendToolCall: (executionId: string, toolName: string) => void
  appendFileChange: (executionId: string, path: string, action: string, added?: number, removed?: number) => void
  initExecution: (executionId: string, nodeId: string) => void
  setStatus: (executionId: string, status: string) => void
  setWatching: (executionId: string | null) => void
  clear: (executionId: string) => void
}

/** Flush pending tool dots into the lines array */
function flushToolDots(output: ExecutionOutput): string[] {
  if (output.pendingToolCount === 0) return output.lines
  const dots = '\u00B7'.repeat(output.pendingToolCount)
  const line = `[Tool Call] ${dots}`
  const lines = [...output.lines, line]
  output.pendingToolCount = 0
  return lines
}

function trimRingBuffer(lines: string[]): string[] {
  if (lines.length > MAX_LINES) {
    lines.splice(0, lines.length - MAX_LINES)
  }
  return lines
}

export const useExecutionStore = create<ExecutionState & ExecutionActions>((set, get) => ({
  outputs: new Map(),
  watchingId: null,

  initExecution: (executionId, nodeId) => {
    const { outputs } = get()
    const next = new Map(outputs)
    next.set(executionId, {
      executionId,
      nodeId,
      lines: [],
      status: 'running',
      startedAt: new Date().toISOString(),
      pendingToolCount: 0,
    })
    set({ outputs: next })
  },

  appendToolCall: (executionId) => {
    const { outputs } = get()
    const current = outputs.get(executionId)
    if (!current) return
    const next = new Map(outputs)
    next.set(executionId, { ...current, pendingToolCount: current.pendingToolCount + 1 })
    set({ outputs: next })
  },

  appendFileChange: (executionId, path, action, added, removed) => {
    const { outputs } = get()
    const current = outputs.get(executionId)
    if (!current) return
    // Flush any pending tool dots first
    const lines = flushToolDots({ ...current })
    const stats = [
      added != null && added > 0 ? `+${added}` : null,
      removed != null && removed > 0 ? `-${removed}` : null,
    ].filter(Boolean).join(' ')
    lines.push(`[${action}] ${path}${stats ? ` (${stats})` : ''}`)
    trimRingBuffer(lines)
    const next = new Map(outputs)
    next.set(executionId, { ...current, lines, pendingToolCount: 0 })
    set({ outputs: next })
  },

  appendLine: (executionId, line) => {
    const { outputs } = get()
    const current = outputs.get(executionId)
    if (!current) return
    // Flush any pending tool dots first
    const lines = flushToolDots({ ...current })
    lines.push(line)
    trimRingBuffer(lines)
    const next = new Map(outputs)
    next.set(executionId, { ...current, lines, pendingToolCount: 0 })
    set({ outputs: next })
  },

  appendText: (executionId, text) => {
    const { outputs } = get()
    const current = outputs.get(executionId)
    if (!current) return
    // Flush any pending tool dots first
    const lines = flushToolDots({ ...current })
    // Split by newlines and append
    const newLines = text.split('\n')
    if (lines.length > 0 && newLines.length > 0) {
      // Append first segment to last line
      lines[lines.length - 1] += newLines[0]
      for (let i = 1; i < newLines.length; i++) {
        lines.push(newLines[i])
      }
    } else {
      lines.push(...newLines)
    }
    trimRingBuffer(lines)
    const next = new Map(outputs)
    next.set(executionId, { ...current, lines, pendingToolCount: 0 })
    set({ outputs: next })
  },

  setStatus: (executionId, status) => {
    const { outputs } = get()
    const current = outputs.get(executionId)
    if (!current) return
    // Flush any remaining tool dots when execution completes
    const lines = flushToolDots({ ...current })
    const next = new Map(outputs)
    next.set(executionId, { ...current, lines, status, pendingToolCount: 0 })
    set({ outputs: next })
  },

  setWatching: (watchingId) => set({ watchingId }),

  clear: (executionId) => {
    const { outputs } = get()
    const next = new Map(outputs)
    next.delete(executionId)
    set({ outputs: next })
  },
}))

/**
 * Execution output store. Ring buffers for streaming task output.
 */
import { create } from 'zustand'

const MAX_LINES = 5000

export interface ExecutionOutput {
  executionId: string
  nodeId: string
  lines: string[]
  status: string
  startedAt: string | null
}

export interface ExecutionState {
  outputs: Map<string, ExecutionOutput>
  /** Currently watched execution ID (shown in output panel) */
  watchingId: string | null
}

export interface ExecutionActions {
  appendLine: (executionId: string, line: string) => void
  appendText: (executionId: string, text: string) => void
  initExecution: (executionId: string, nodeId: string) => void
  setStatus: (executionId: string, status: string) => void
  setWatching: (executionId: string | null) => void
  clear: (executionId: string) => void
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
    })
    set({ outputs: next })
  },

  appendLine: (executionId, line) => {
    const { outputs } = get()
    const current = outputs.get(executionId)
    if (!current) return
    const lines = [...current.lines, line]
    // Ring buffer
    if (lines.length > MAX_LINES) {
      lines.splice(0, lines.length - MAX_LINES)
    }
    const next = new Map(outputs)
    next.set(executionId, { ...current, lines })
    set({ outputs: next })
  },

  appendText: (executionId, text) => {
    const { outputs } = get()
    const current = outputs.get(executionId)
    if (!current) return
    // Split by newlines and append
    const newLines = text.split('\n')
    const lines = [...current.lines]
    if (lines.length > 0 && newLines.length > 0) {
      // Append first segment to last line
      lines[lines.length - 1] += newLines[0]
      for (let i = 1; i < newLines.length; i++) {
        lines.push(newLines[i])
      }
    } else {
      lines.push(...newLines)
    }
    // Ring buffer
    if (lines.length > MAX_LINES) {
      lines.splice(0, lines.length - MAX_LINES)
    }
    const next = new Map(outputs)
    next.set(executionId, { ...current, lines })
    set({ outputs: next })
  },

  setStatus: (executionId, status) => {
    const { outputs } = get()
    const current = outputs.get(executionId)
    if (!current) return
    const next = new Map(outputs)
    next.set(executionId, { ...current, status })
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

import { create } from "zustand"
import type { RawObservation, TraceTree, GenerationTurn, ToolCallWithResult } from "@/types/observations"
import { fetchTraceObservations } from "@/lib/api-client"

interface ObservationState {
  traces: Map<string, TraceTree>
  loading: Map<string, boolean>
  errors: Map<string, string>

  fetchTrace: (traceId: string) => Promise<void>
  getTrace: (traceId: string) => TraceTree | undefined
  isLoading: (traceId: string) => boolean
  clearTrace: (traceId: string) => void
}

/**
 * Build a TraceTree from a flat array of observations.
 *
 * 1. Separate by type (span, generation, tool, event)
 * 2. Find the context span (name === 'context')
 * 3. Sort generations by startTime — each is a "turn"
 * 4. For each generation, find tool observations where parentObservationId === generation.id
 * 5. Parse generation output for text content
 * 6. Parse tool input/output, compute durationMs
 * 7. Compute aggregate stats
 */
export function buildTraceTree(traceId: string, observations: RawObservation[]): TraceTree {
  const spans = observations.filter((o) => o.type === 'span')
  const generations = observations.filter((o) => o.type === 'generation')
  const tools = observations.filter((o) => o.type === 'tool')
  const events = observations.filter((o) => o.type === 'event')

  // Find context span
  const contextSpan = spans.find((s) => s.name === 'context') ?? null

  // Sort generations by startTime
  const sortedGenerations = [...generations].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  )

  // Build turns
  const turns: GenerationTurn[] = sortedGenerations.map((gen, index) => {
    // Find tools parented to this generation
    const genTools = tools.filter((t) => t.parentObservationId === gen.id)

    const toolCalls: ToolCallWithResult[] = genTools.map((t) => {
      const startMs = new Date(t.startTime).getTime()
      const endMs = t.endTime ? new Date(t.endTime).getTime() : null
      const durationMs = endMs !== null ? endMs - startMs : null

      // Parse success from metadata or level
      const success = t.level !== 'error' && (t.metadata as Record<string, unknown>)?.success !== false

      // The observation collector stores tool names as "tool:Bash", "tool:Read", etc.
      // Strip the "tool:" prefix for display.
      const displayName = t.name.startsWith('tool:') ? t.name.slice(5) : t.name

      return {
        toolObs: t,
        name: displayName,
        input: t.input,
        output: t.output,
        success,
        durationMs,
      }
    })

    // Extract text from generation output
    let text = ''
    if (typeof gen.output === 'string') {
      text = gen.output
    } else if (gen.output && typeof gen.output === 'object') {
      const out = gen.output as Record<string, unknown>
      if (typeof out.text === 'string') {
        text = out.text
      } else if (typeof out.content === 'string') {
        text = out.content
      }
    }

    return {
      generation: gen,
      turnIndex: index,
      text,
      toolCalls,
      model: gen.model,
      inputTokens: gen.inputTokens,
      outputTokens: gen.outputTokens,
    }
  })

  // Compute aggregate stats
  const totalTokens = generations.reduce(
    (sum, g) => sum + (g.inputTokens ?? 0) + (g.outputTokens ?? 0),
    0
  )
  const totalCost = observations.reduce(
    (sum, o) => sum + (o.estimatedCostUsd ?? 0),
    0
  )
  const model = generations.length > 0 ? generations[0].model : null

  // Duration from first to last observation
  let durationMs: number | null = null
  if (observations.length > 0) {
    const firstTime = new Date(observations[0].startTime).getTime()
    const lastObs = observations[observations.length - 1]
    const lastTime = lastObs.endTime
      ? new Date(lastObs.endTime).getTime()
      : new Date(lastObs.startTime).getTime()
    durationMs = lastTime - firstTime
  }

  const totalToolCalls = turns.reduce((sum, t) => sum + t.toolCalls.length, 0)

  return {
    traceId,
    contextSpan,
    turns,
    events,
    stats: {
      totalTurns: turns.length,
      totalToolCalls,
      totalTokens,
      totalCost,
      model,
      durationMs,
    },
  }
}

export const useObservationStore = create<ObservationState>((set, get) => ({
  traces: new Map(),
  loading: new Map(),
  errors: new Map(),

  fetchTrace: async (traceId: string) => {
    // Mark as loading
    set((state) => {
      const newLoading = new Map(state.loading)
      newLoading.set(traceId, true)
      const newErrors = new Map(state.errors)
      newErrors.delete(traceId)
      return { loading: newLoading, errors: newErrors }
    })

    try {
      const observations = await fetchTraceObservations(traceId)
      const tree = buildTraceTree(traceId, observations)

      set((state) => {
        const newTraces = new Map(state.traces)
        newTraces.set(traceId, tree)
        const newLoading = new Map(state.loading)
        newLoading.set(traceId, false)
        return { traces: newTraces, loading: newLoading }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch trace'
      set((state) => {
        const newLoading = new Map(state.loading)
        newLoading.set(traceId, false)
        const newErrors = new Map(state.errors)
        newErrors.set(traceId, message)
        return { loading: newLoading, errors: newErrors }
      })
    }
  },

  getTrace: (traceId: string) => {
    return get().traces.get(traceId)
  },

  isLoading: (traceId: string) => {
    return get().loading.get(traceId) ?? false
  },

  clearTrace: (traceId: string) => {
    set((state) => {
      const newTraces = new Map(state.traces)
      newTraces.delete(traceId)
      const newLoading = new Map(state.loading)
      newLoading.delete(traceId)
      const newErrors = new Map(state.errors)
      newErrors.delete(traceId)
      return { traces: newTraces, loading: newLoading, errors: newErrors }
    })
  },
}))

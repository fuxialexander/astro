/**
 * Observation types for the Trace Viewer.
 *
 * These types model the observation_events table rows returned by
 * GET /api/observations/:traceId and the derived structures built
 * client-side for the hierarchical turn-based view.
 */

// Raw observation from the API (matches observation_events DB row)
export interface RawObservation {
  id: string
  traceId: string
  parentObservationId: string | null
  type: 'span' | 'generation' | 'tool' | 'event'
  name: string
  startTime: string // ISO string from API
  endTime: string | null
  input: unknown
  output: unknown
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  estimatedCostUsd: number | null
  level: 'debug' | 'default' | 'warning' | 'error'
  metadata: Record<string, unknown> | null
  projectId: string
  nodeId: string | null
  statusMessage: string | null
}

// Stats from GET /api/observations/stats
export interface TraceStats {
  totalEvents: number
  totalSpans: number
  totalGenerations: number
  totalTools: number
  totalEventType: number
  errorCount: number
  warningCount: number
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
}

// A tool call paired with its result (built client-side from flat observations)
export interface ToolCallWithResult {
  toolObs: RawObservation // type: 'tool'
  name: string // e.g., 'Bash', 'Read', 'Edit'
  input: unknown
  output: unknown
  success: boolean
  durationMs: number | null
}

// A single LLM turn: generation text + tool calls made in that turn
export interface GenerationTurn {
  generation: RawObservation // type: 'generation'
  turnIndex: number
  text: string // output text from generation
  toolCalls: ToolCallWithResult[] // tools parented to this generation
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
}

// Complete trace tree (built client-side from flat API response)
export interface TraceTree {
  traceId: string
  contextSpan: RawObservation | null // type: 'span', name: 'context'
  turns: GenerationTurn[]
  events: RawObservation[] // lifecycle events (task:started, etc.)
  stats: {
    totalTurns: number
    totalToolCalls: number
    totalTokens: number
    totalCost: number
    model: string | null
    durationMs: number | null
  }
}

/**
 * Observability System - Type Definitions
 *
 * Langfuse-compatible observation types for structured tracing
 * of task executions across both lifecycle and streaming events.
 */

export type ObservationType = 'span' | 'generation' | 'tool' | 'event'
export type ObservationLevel = 'debug' | 'default' | 'warning' | 'error'

export interface ObservationEvent {
  /** Time-prefixed UUID for chronological ordering */
  id: string
  /** Root container ID (= executionId, like Langfuse's trace) */
  traceId: string
  /** Parent observation ID for nesting (e.g., tool within a span) */
  parentObservationId?: string
  /** Observation type classification */
  type: ObservationType
  /** Human-readable name, e.g. 'tool:Bash', 'generation', 'task:started' */
  name: string
  /** When this observation started */
  startTime: Date
  /** When this observation ended (filled on completion) */
  endTime?: Date
  /** JSONB - tool input, prompt text, etc. */
  input?: unknown
  /** JSONB - tool result, assistant text, etc. */
  output?: unknown
  /** Model used (e.g. 'claude-sonnet-4-20250514') */
  model?: string
  /** Input token count */
  inputTokens?: number
  /** Output token count */
  outputTokens?: number
  /** Estimated cost in USD */
  estimatedCostUsd?: number
  /** Severity level */
  level: ObservationLevel
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>
  /** Project this observation belongs to (null when trace is orphaned) */
  projectId: string | null
  /** Plan node ID if applicable */
  nodeId?: string
  /** Status message (e.g. error details) */
  statusMessage?: string
}

export interface SafetyRailsConfig {
  /** USD limit per execution - exceeding triggers a warning */
  maxCostPerExecution?: number
  /** Tools that are denied for this project */
  deniedTools?: string[]
}

export interface LangfuseExportConfig {
  enabled: boolean
  baseUrl: string
  publicKey: string
  secretKey: string
}

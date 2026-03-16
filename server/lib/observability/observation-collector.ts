/**
 * Observation Collector (Phase 2A — Turn-Based Generation Tracking)
 *
 * Core collector that bridges both the lifecycle event system (astroEventTransport)
 * and the streaming event system (executionEventBus) into a unified observation layer.
 *
 * Design:
 * - Dual subscription: EventHook on astroEventTransport + listener on executionEventBus
 * - Batch buffer: Accumulates events per trace, flushes on size/time/completion
 * - Turn tracking: Groups text + tool calls into discrete generation turns
 * - Tool correlation: Matches tool_use → tool_result pairs by toolUseId (with toolName fallback)
 * - Context capture: Records task title, description, and visionDoc on task start
 * - Markdown summary: Generated at execution end
 *
 * Turn model:
 *   A "turn" starts when text arrives after initialization or after tool results.
 *   Within a turn, the LLM produces text output and may invoke tool calls.
 *   When tool results come back and new text starts, a new turn begins.
 *
 *   Turn 0: [context] → assistant text + tool_calls
 *   Turn 1: [tool_results] → assistant text + tool_calls
 *   Turn 2: [tool_results] → final assistant text
 *
 *   Each turn produces a `generation` observation with:
 *   - input: { turnIndex, toolResults (from previous turn) }
 *   - output: { text, toolCalls }
 *   Tool observations are children of their parent generation (via parentObservationId).
 */

import { randomUUID } from 'crypto'
import { eq, and, asc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { observationEvents, taskExecutions, planNodes } from '../db/schema.js'
import { executionEventBus } from '../execution-event-bus.js'
import type { AstroEvent } from '../events/types.js'
import type { EventHook } from '../events/types.js'
import type { ObservationEvent } from './types.js'
import { safetyRails } from './safety-rails.js'

/** Generate a time-prefixed UUID for chronological ordering */
function timePrefixedId(): string {
  const now = Date.now().toString(36).padStart(9, '0')
  return `${now}-${randomUUID()}`
}

/** Max length for the `name` column (btree index limit is ~2704 bytes) */
const MAX_NAME_CHARS = 500

/** Truncate large JSONB values to prevent INSERT failures */
const MAX_JSONB_CHARS = 50_000
function truncateJsonb(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'string') return value.length > MAX_JSONB_CHARS ? value.slice(0, MAX_JSONB_CHARS) + '…[truncated]' : value
  // For objects/arrays, serialize to check size, truncate the string representation if too large
  try {
    const json = JSON.stringify(value)
    if (json.length <= MAX_JSONB_CHARS) return value
    return { _truncated: true, preview: json.slice(0, MAX_JSONB_CHARS) + '…[truncated]', originalLength: json.length }
  } catch {
    return { _truncated: true, error: 'Failed to serialize' }
  }
}

/** Max events per trace before auto-flush */
const BATCH_SIZE = 50

/** Flush interval in milliseconds */
const FLUSH_INTERVAL_MS = 5_000

/**
 * Represents a single LLM generation turn (text output + tool calls).
 */
interface GenerationTurn {
  /** Unique observation ID for this generation */
  id: string
  /** Turn index within the trace (0-based) */
  turnIndex: number
  /** When the first text chunk arrived for this turn */
  startTime: Date
  /** Accumulated text chunks for this turn */
  textChunks: string[]
  /** Tool calls made during this turn (by the LLM's decision) */
  toolCalls: Array<{
    toolUseId: string
    toolName: string
    toolInput: unknown
  }>
  /** Tool results from the previous turn that served as input to this turn */
  inputToolResults: Array<{
    toolUseId: string
    toolName: string
    result: unknown
    success: boolean
  }>
}

/**
 * Per-trace state tracked by the collector
 */
interface TraceState {
  projectId: string | null
  nodeId?: string
  model?: string
  sessionId?: string
  /** Buffered observations waiting to be flushed */
  buffer: ObservationEvent[]
  /** Pending tool calls: correlationKey → partial observation */
  pendingTools: Map<string, ObservationEvent>
  /** Current generation turn being accumulated */
  currentTurn: GenerationTurn | null
  /** Tool results collected since last turn was finalized (input for next turn) */
  pendingToolResults: Array<{
    toolUseId: string
    toolName: string
    result: unknown
    success: boolean
  }>
  /** Number of turns finalized so far */
  turnCount: number
  /** Timer handle for periodic flush */
  flushTimer?: ReturnType<typeof setInterval>
  /** Total estimated cost for this execution */
  totalCost: number
  /** Whether we are in "tool execution" phase (between tool_use and start of new text) */
  inToolPhase: boolean
}

export class ObservationCollector {
  private traces = new Map<string, TraceState>()
  private listeners: Array<() => void> = []
  private started = false

  /**
   * Subscribe to executionEventBus streaming events.
   * Lifecycle events are handled via the exported observabilityHook.
   */
  start(): void {
    if (this.started) return
    this.started = true

    const onSessionInit = (data: {
      taskId: string
      sessionId: string
      model: string
    }) => {
      this.handleSessionInit(data.taskId, data.sessionId, data.model)
    }

    const onToolTrace = (data: {
      taskId: string
      toolName: string
      toolInput?: unknown
      toolResult?: unknown
      success?: boolean
      toolUseId?: string
    }) => {
      if (data.toolInput !== undefined && data.toolResult === undefined) {
        // tool_use event
        this.handleToolUse(data.taskId, data.toolName, data.toolInput, data.toolUseId)
      } else if (data.toolResult !== undefined) {
        // tool_result event
        this.handleToolResult(data.taskId, data.toolName, data.toolResult, data.success ?? true, data.toolUseId)
      }
    }

    const onStdout = (data: { output: { taskId: string; data: string } }) => {
      this.handleText(data.output.taskId, data.output.data)
    }

    const onFileChange = (data: { taskId: string; path: string; action: string }) => {
      this.handleFileChange(data.taskId, data.path, data.action)
    }

    const onProgress = (data: { taskId: string; message: string; progress?: number }) => {
      this.handleProgress(data.taskId, data.message, data.progress)
    }

    executionEventBus.on('task:session_init', onSessionInit)
    executionEventBus.on('task:tool_trace', onToolTrace)
    executionEventBus.on('task:stdout', onStdout)
    executionEventBus.on('task:file_change', onFileChange)
    executionEventBus.on('task:progress', onProgress)

    this.listeners.push(
      () => executionEventBus.off('task:session_init', onSessionInit),
      () => executionEventBus.off('task:tool_trace', onToolTrace),
      () => executionEventBus.off('task:stdout', onStdout),
      () => executionEventBus.off('task:file_change', onFileChange),
      () => executionEventBus.off('task:progress', onProgress),
    )

    console.log('[observability] Observation collector started')
  }

  /**
   * Flush all buffers and unsubscribe from events.
   */
  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false

    // Unsubscribe from all events
    for (const unsub of this.listeners) {
      unsub()
    }
    this.listeners = []

    // Flush all remaining traces
    const flushPromises: Promise<void>[] = []
    for (const [traceId, state] of this.traces) {
      if (state.flushTimer) clearInterval(state.flushTimer)
      flushPromises.push(this.flush(traceId))
    }
    await Promise.allSettled(flushPromises)
    this.traces.clear()

    console.log('[observability] Observation collector stopped')
  }

  /**
   * Handle lifecycle events from astroEventTransport.
   */
  handleLifecycleEvent(event: AstroEvent): void {
    switch (event.type) {
      case 'task.started':
        this.initTrace(event.executionId, event.projectId, event.nodeId)

        // Emit task:started event observation
        this.addObservation(event.executionId, {
          id: timePrefixedId(),
          traceId: event.executionId,
          type: 'event',
          name: 'task:started',
          startTime: event.timestamp,
          level: 'default',
          projectId: event.projectId,
          nodeId: event.nodeId,
          metadata: {
            taskId: event.taskId,
            nodeTitle: event.node?.title,
          },
        })

        // Capture initial context as a 'context' span observation
        this.captureInitialContext(event)
        break

      case 'task.completed': {
        const state = this.traces.get(event.executionId)
        // Finalize the current generation turn
        this.finalizeCurrentTurn(event.executionId, event.result?.metrics?.model)

        // Record completion event
        this.addObservation(event.executionId, {
          id: timePrefixedId(),
          traceId: event.executionId,
          type: 'event',
          name: 'task:completed',
          startTime: event.timestamp,
          level: 'default',
          projectId: event.projectId,
          nodeId: event.nodeId,
          metadata: {
            taskId: event.taskId,
            status: event.result?.status,
          },
          model: event.result?.metrics?.model,
          inputTokens: event.result?.metrics?.inputTokens,
          outputTokens: event.result?.metrics?.outputTokens,
          estimatedCostUsd: event.result?.metrics?.estimatedCostUsd,
        })

        // Track cost in safety rails
        if (event.result?.metrics?.estimatedCostUsd && state) {
          safetyRails.trackCost(event.executionId, event.result.metrics.estimatedCostUsd)
        }

        // Generate markdown summary and flush
        this.finishTrace(event.executionId).catch((err) => {
          console.error('[observability] Error finishing trace:', err)
        })
        break
      }

      case 'task.failed': {
        this.finalizeCurrentTurn(event.executionId)
        this.addObservation(event.executionId, {
          id: timePrefixedId(),
          traceId: event.executionId,
          type: 'event',
          name: 'task:failed',
          startTime: event.timestamp,
          level: 'error',
          projectId: event.projectId,
          nodeId: event.nodeId,
          statusMessage: event.error,
          metadata: { taskId: event.taskId },
        })
        this.finishTrace(event.executionId).catch((err) => {
          console.error('[observability] Error finishing trace:', err)
        })
        break
      }

      case 'task.cancelled':
        this.finalizeCurrentTurn(event.executionId)
        this.addObservation(event.executionId, {
          id: timePrefixedId(),
          traceId: event.executionId,
          type: 'event',
          name: 'task:cancelled',
          startTime: event.timestamp,
          level: 'warning',
          projectId: event.projectId,
          metadata: {
            taskId: event.taskId,
            reason: event.reason,
          },
        })
        this.finishTrace(event.executionId).catch((err) => {
          console.error('[observability] Error finishing trace:', err)
        })
        break

      case 'task.progress':
        // Progress events are also captured via executionEventBus; skip duplicates
        break

      case 'approval.requested':
        this.addObservation(event.executionId, {
          id: timePrefixedId(),
          traceId: event.executionId,
          type: 'event',
          name: 'approval:requested',
          startTime: event.timestamp,
          level: 'warning',
          projectId: event.projectId,
          nodeId: event.nodeId,
          metadata: {
            approvalId: event.approvalId,
            message: event.message,
            options: event.options,
          },
        })
        break

      case 'approval.responded':
        this.addObservation(event.executionId, {
          id: timePrefixedId(),
          traceId: event.executionId,
          type: 'event',
          name: 'approval:responded',
          startTime: event.timestamp,
          level: 'default',
          projectId: event.projectId,
          nodeId: event.nodeId,
          metadata: {
            approvalId: event.approvalId,
            approved: event.approved,
            selectedOption: event.selectedOption,
          },
        })
        break
    }
  }

  // ── Streaming event handlers ────────────────────────────────────────

  private handleSessionInit(traceId: string, sessionId: string, model: string): void {
    const state = this.traces.get(traceId)
    if (!state) {
      // Trace might not be initialized yet — create it
      this.initTrace(traceId, null)
      const newState = this.traces.get(traceId)!
      newState.sessionId = sessionId
      newState.model = model
      return
    }
    state.sessionId = sessionId
    state.model = model
  }

  private handleToolUse(traceId: string, rawToolName: string, toolInput: unknown, toolUseId?: string): void {
    const state = this.traces.get(traceId)
    if (!state) return
    // Truncate tool names that exceed index limits (e.g., malformed agent events)
    const toolName = rawToolName.length > 200 ? rawToolName.slice(0, 200) : rawToolName

    // Check tool allowlist
    safetyRails.isToolAllowed(state.projectId, toolName)

    // A tool_use during the current turn means the LLM decided to call a tool
    // Record the tool call in the current turn's toolCalls list
    const currentTurn = state.currentTurn
    const resolvedToolUseId = toolUseId ?? `${toolName}-${Date.now()}`

    if (currentTurn) {
      currentTurn.toolCalls.push({
        toolUseId: resolvedToolUseId,
        toolName,
        toolInput,
      })
    }

    // Enter tool phase — no longer receiving text for this turn
    state.inToolPhase = true

    const obs: ObservationEvent = {
      id: timePrefixedId(),
      traceId,
      type: 'tool',
      name: `tool:${toolName}`,
      startTime: new Date(),
      input: truncateJsonb(toolInput),
      level: 'default',
      projectId: state.projectId,
      nodeId: state.nodeId,
      // Set parent to current generation turn if one exists
      parentObservationId: currentTurn?.id,
      metadata: { toolUseId: resolvedToolUseId, turnIndex: state.turnCount },
    }

    // Track pending tool by toolUseId (or fallback to toolName)
    const correlationKey = toolUseId ?? toolName
    state.pendingTools.set(correlationKey, obs)
  }

  private handleToolResult(traceId: string, rawToolName: string, result: unknown, success: boolean, toolUseId?: string): void {
    const state = this.traces.get(traceId)
    if (!state) return
    const toolName = rawToolName.length > 200 ? rawToolName.slice(0, 200) : rawToolName

    // Find pending tool by toolUseId first, then fall back to toolName
    const correlationKey = toolUseId ?? toolName
    const pending = state.pendingTools.get(correlationKey)

    if (pending) {
      // Complete the pending tool observation
      pending.endTime = new Date()
      pending.output = truncateJsonb(result)
      pending.level = success ? 'default' : 'error'
      if (!success) {
        pending.statusMessage = typeof result === 'string' ? result.slice(0, 500) : 'Tool execution failed'
      }
      state.pendingTools.delete(correlationKey)
      this.addObservation(traceId, pending)
    } else {
      // No matching tool_use; create a standalone tool observation
      this.addObservation(traceId, {
        id: timePrefixedId(),
        traceId,
        type: 'tool',
        name: `tool:${toolName}`,
        startTime: new Date(),
        endTime: new Date(),
        output: truncateJsonb(result),
        level: success ? 'default' : 'error',
        projectId: state.projectId,
        nodeId: state.nodeId,
        parentObservationId: state.currentTurn?.id,
        statusMessage: success ? undefined : 'Tool execution failed',
        metadata: { toolUseId: correlationKey, turnIndex: state.turnCount },
      })
    }

    // Collect tool result for next turn's input context
    state.pendingToolResults.push({
      toolUseId: correlationKey,
      toolName,
      result,
      success,
    })
  }

  private handleText(traceId: string, text: string): void {
    const state = this.traces.get(traceId)
    if (!state) return

    // If we're in tool phase and new text arrives, that means a new turn is starting
    // Finalize the current turn and start a new one
    if (state.inToolPhase && state.currentTurn) {
      this.finalizeCurrentTurn(traceId)
    }

    // Start a new turn if there isn't one active
    if (!state.currentTurn) {
      state.currentTurn = {
        id: timePrefixedId(),
        turnIndex: state.turnCount,
        startTime: new Date(),
        textChunks: [],
        toolCalls: [],
        inputToolResults: [...state.pendingToolResults],
      }
      // Clear pending tool results since they're now captured as input for this turn
      state.pendingToolResults = []
      state.inToolPhase = false
    }

    state.currentTurn.textChunks.push(text)
  }

  private handleFileChange(traceId: string, path: string, action: string): void {
    const state = this.traces.get(traceId)
    if (!state) return

    this.addObservation(traceId, {
      id: timePrefixedId(),
      traceId,
      type: 'event',
      name: 'file:change',
      startTime: new Date(),
      level: 'default',
      projectId: state.projectId,
      nodeId: state.nodeId,
      metadata: { path, action },
    })
  }

  private handleProgress(traceId: string, message: string, percentage?: number): void {
    const state = this.traces.get(traceId)
    if (!state) return

    this.addObservation(traceId, {
      id: timePrefixedId(),
      traceId,
      type: 'event',
      name: 'task:progress',
      startTime: new Date(),
      level: 'debug',
      projectId: state.projectId,
      nodeId: state.nodeId,
      metadata: { message, percentage },
    })
  }

  // ── Context capture ─────────────────────────────────────────────────

  /**
   * Capture the initial task context (title, description, visionDoc) as a span observation.
   * This provides the "input" to the first generation turn.
   */
  private captureInitialContext(event: AstroEvent & { type: 'task.started' }): void {
    const contextInput: Record<string, unknown> = {}
    if (event.node?.title) contextInput.taskTitle = event.node.title
    if (event.node?.description) contextInput.taskDescription = event.node.description
    if (event.project?.visionDoc) contextInput.visionDoc = event.project.visionDoc.slice(0, 5000)

    // Only create a context span if there's meaningful context
    if (Object.keys(contextInput).length === 0) return

    this.addObservation(event.executionId, {
      id: timePrefixedId(),
      traceId: event.executionId,
      type: 'span',
      name: 'context',
      startTime: event.timestamp,
      endTime: event.timestamp,
      input: contextInput,
      level: 'default',
      projectId: event.projectId,
      nodeId: event.nodeId,
    })
  }

  // ── Internal helpers ────────────────────────────────────────────────

  private initTrace(traceId: string, projectId: string | null, nodeId?: string): void {
    const existing = this.traces.get(traceId)
    if (existing) {
      // Backfill projectId/nodeId if they were unknown at initial creation
      if (!existing.projectId && projectId) {
        existing.projectId = projectId
        // Also patch any buffered observations that have null projectId
        for (const obs of existing.buffer) {
          if (!obs.projectId) obs.projectId = projectId
        }
      }
      if (!existing.nodeId && nodeId) existing.nodeId = nodeId
      return
    }

    const state: TraceState = {
      projectId: projectId ?? null,
      nodeId,
      buffer: [],
      pendingTools: new Map(),
      currentTurn: null,
      pendingToolResults: [],
      turnCount: 0,
      totalCost: 0,
      inToolPhase: false,
    }

    // Set up periodic flush
    state.flushTimer = setInterval(() => {
      if (state.buffer.length > 0) {
        this.flush(traceId).catch((err) => {
          console.error(`[observability] Periodic flush failed for trace ${traceId}:`, err)
        })
      }
    }, FLUSH_INTERVAL_MS)

    this.traces.set(traceId, state)
  }

  private addObservation(traceId: string, obs: ObservationEvent): void {
    const state = this.traces.get(traceId)
    if (!state) {
      // Trace not initialized (e.g., streaming event arrived before lifecycle event)
      // Buffer orphan observations in a new trace state
      this.initTrace(traceId, obs.projectId, obs.nodeId)
      const newState = this.traces.get(traceId)!
      newState.buffer.push(obs)
      return
    }

    state.buffer.push(obs)

    // Auto-flush when buffer reaches threshold
    if (state.buffer.length >= BATCH_SIZE) {
      this.flush(traceId).catch((err) => {
        console.error(`[observability] Auto-flush failed for trace ${traceId}:`, err)
      })
    }
  }

  /**
   * Finalize the current generation turn into an observation.
   * This creates a `generation` observation with structured input/output.
   */
  private finalizeCurrentTurn(traceId: string, model?: string): void {
    const state = this.traces.get(traceId)
    if (!state || !state.currentTurn) return

    const turn = state.currentTurn
    const fullText = turn.textChunks.join('')

    // Build structured input (what the LLM received for this turn)
    const input: Record<string, unknown> = {
      turnIndex: turn.turnIndex,
    }
    if (turn.inputToolResults.length > 0) {
      input.toolResults = turn.inputToolResults.map((tr) => ({
        toolUseId: tr.toolUseId,
        toolName: tr.toolName,
        result: truncateJsonb(tr.result),
        success: tr.success,
      }))
    }

    // Build structured output (what the LLM produced in this turn)
    const output: Record<string, unknown> = {
      text: fullText.slice(0, 100000),
    }
    if (turn.toolCalls.length > 0) {
      output.toolCalls = turn.toolCalls.map((tc) => ({
        toolUseId: tc.toolUseId,
        toolName: tc.toolName,
        toolInput: truncateJsonb(tc.toolInput),
      }))
    }

    this.addObservation(traceId, {
      id: turn.id,
      traceId,
      type: 'generation',
      name: `generation:turn-${turn.turnIndex}`,
      startTime: turn.startTime,
      endTime: new Date(),
      input,
      output,
      model: model ?? state.model,
      level: 'default',
      projectId: state.projectId,
      nodeId: state.nodeId,
      metadata: {
        turnIndex: turn.turnIndex,
        toolCallCount: turn.toolCalls.length,
        sessionId: state.sessionId,
      },
    })

    // Also flush any pending tools that never got a result
    for (const [, pendingObs] of state.pendingTools) {
      pendingObs.endTime = new Date()
      pendingObs.level = 'warning'
      pendingObs.statusMessage = 'Tool call never received result'
      state.buffer.push(pendingObs)
    }
    state.pendingTools.clear()

    // Advance turn counter
    state.turnCount++
    state.currentTurn = null
    state.inToolPhase = false
  }

  /**
   * Batch-write buffered observations to the database.
   */
  async flush(traceId?: string): Promise<void> {
    const traceIds = traceId ? [traceId] : Array.from(this.traces.keys())

    for (const tid of traceIds) {
      const state = this.traces.get(tid)
      if (!state || state.buffer.length === 0) continue

      const events = state.buffer.splice(0)
      const rows = events.map((obs) => ({
        id: obs.id,
        traceId: obs.traceId,
        parentObservationId: obs.parentObservationId ?? null,
        type: obs.type,
        name: obs.name.length > MAX_NAME_CHARS ? obs.name.slice(0, MAX_NAME_CHARS) : obs.name,
        startTime: obs.startTime,
        endTime: obs.endTime ?? null,
        input: obs.input ?? null,
        output: obs.output ?? null,
        model: obs.model ?? null,
        inputTokens: obs.inputTokens ?? null,
        outputTokens: obs.outputTokens ?? null,
        estimatedCostUsd: obs.estimatedCostUsd ?? null,
        level: obs.level,
        metadata: obs.metadata ?? null,
        projectId: obs.projectId,
        nodeId: obs.nodeId ?? null,
        statusMessage: obs.statusMessage ?? null,
      }))

      try {
        await db.insert(observationEvents).values(rows)
        console.log(`[observability] Flushed ${rows.length} observations for trace ${tid}`)
      } catch (err) {
        const errObj = err as { code?: string; cause?: unknown }
        const cause = errObj?.cause
        const pgCode = (cause as { code?: string })?.code ?? errObj?.code
        // Don't retry on persistent DB errors (e.g., index size exceeded, constraint violations)
        // Code 54000 = program_limit_exceeded (btree index row too large)
        // Code 23505 = unique_violation
        const nonRetryable = pgCode === '54000' || pgCode === '23505'
        if (nonRetryable) {
          console.warn(`[observability] Dropping ${events.length} observations for trace ${tid} (non-retryable DB error: ${pgCode})`)
        } else {
          console.error(`[observability] Failed to flush observations for trace ${tid}:`, cause ?? err)
          // Re-add failed events to buffer for retry (only for transient errors)
          state.buffer.unshift(...events)
        }
      }
    }
  }

  /**
   * Generate a markdown summary from collected observations for a trace.
   */
  generateMarkdownSummary(traceId: string): string {
    const state = this.traces.get(traceId)
    if (!state) return ''

    // Collect all observations (buffer + already flushed aren't available in memory,
    // so we work from the current buffer only — this is called before final flush)
    const allObs = [...state.buffer]

    const tools = allObs.filter((o) => o.type === 'tool')
    const events = allObs.filter((o) => o.type === 'event')
    const generations = allObs.filter((o) => o.type === 'generation')
    const errors = allObs.filter((o) => o.level === 'error')
    const fileChanges = events.filter((o) => o.name === 'file:change')

    const startEvent = events.find((o) => o.name === 'task:started')
    const endEvent = events.find((o) => o.name === 'task:completed' || o.name === 'task:failed' || o.name === 'task:cancelled')

    let durationStr = ''
    if (startEvent && endEvent) {
      const durationMs = endEvent.startTime.getTime() - startEvent.startTime.getTime()
      const durationS = (durationMs / 1000).toFixed(1)
      durationStr = `${durationS}s`
    }

    const totalCost = allObs.reduce((sum, o) => sum + (o.estimatedCostUsd ?? 0), 0)
    const totalInputTokens = allObs.reduce((sum, o) => sum + (o.inputTokens ?? 0), 0)
    const totalOutputTokens = allObs.reduce((sum, o) => sum + (o.outputTokens ?? 0), 0)

    const toolSuccessCount = tools.filter((t) => t.level !== 'error').length
    const toolFailCount = tools.filter((t) => t.level === 'error').length

    const lines: string[] = [
      '# Execution Summary',
      '',
      `**Trace ID:** \`${traceId}\``,
    ]

    if (state.model) lines.push(`**Model:** ${state.model}`)
    if (durationStr) lines.push(`**Duration:** ${durationStr}`)
    if (endEvent) lines.push(`**Status:** ${endEvent.name.replace('task:', '')}`)
    lines.push(`**Turns:** ${state.turnCount}`)

    lines.push('')
    lines.push('## Metrics')
    lines.push('')
    lines.push(`| Metric | Value |`)
    lines.push(`|--------|-------|`)
    lines.push(`| Tools called | ${tools.length} (${toolSuccessCount} ok, ${toolFailCount} failed) |`)
    lines.push(`| Generations | ${generations.length} |`)
    lines.push(`| File changes | ${fileChanges.length} |`)
    if (totalInputTokens || totalOutputTokens) {
      lines.push(`| Input tokens | ${totalInputTokens.toLocaleString()} |`)
      lines.push(`| Output tokens | ${totalOutputTokens.toLocaleString()} |`)
    }
    if (totalCost > 0) {
      lines.push(`| Estimated cost | $${totalCost.toFixed(4)} |`)
    }

    if (tools.length > 0) {
      lines.push('')
      lines.push('## Tool Calls')
      lines.push('')

      // Group by tool name
      const toolGroups = new Map<string, { count: number; failures: number }>()
      for (const t of tools) {
        const name = t.name.replace('tool:', '')
        const entry = toolGroups.get(name) || { count: 0, failures: 0 }
        entry.count++
        if (t.level === 'error') entry.failures++
        toolGroups.set(name, entry)
      }

      lines.push(`| Tool | Calls | Failures |`)
      lines.push(`|------|-------|----------|`)
      for (const [name, stats] of toolGroups) {
        lines.push(`| ${name} | ${stats.count} | ${stats.failures} |`)
      }
    }

    if (fileChanges.length > 0) {
      lines.push('')
      lines.push('## File Changes')
      lines.push('')
      for (const fc of fileChanges) {
        const meta = fc.metadata as { path?: string; action?: string } | undefined
        if (meta) {
          lines.push(`- \`${meta.path}\` (${meta.action})`)
        }
      }
    }

    if (errors.length > 0) {
      lines.push('')
      lines.push('## Errors')
      lines.push('')
      for (const err of errors) {
        lines.push(`- **${err.name}**: ${err.statusMessage ?? 'Unknown error'}`)
      }
    }

    return lines.join('\n')
  }

  /**
   * Flush remaining events, generate summary, and clean up trace state.
   */
  private async finishTrace(traceId: string): Promise<void> {
    const state = this.traces.get(traceId)
    if (!state) return

    // Generate markdown summary before flushing (so we have all observations in buffer)
    const summary = this.generateMarkdownSummary(traceId)

    // Clear the flush timer
    if (state.flushTimer) clearInterval(state.flushTimer)

    // Flush remaining observations
    await this.flush(traceId)

    // Update plan node with execution timestamps from observability data
    if (state.projectId && state.nodeId) {
      try {
        // Query observability events to find first startTime and last endTime
        const events = await db
          .select({
            startTime: observationEvents.startTime,
            endTime: observationEvents.endTime,
          })
          .from(observationEvents)
          .where(eq(observationEvents.traceId, traceId))
          .orderBy(asc(observationEvents.startTime))

        if (events.length > 0) {
          const firstStartTime = events[0].startTime
          // Find the last non-null endTime
          const lastEndTime = events
            .filter((e) => e.endTime !== null)
            .map((e) => e.endTime!)
            .sort((a, b) => b.getTime() - a.getTime())[0]

          if (firstStartTime) {
            // Update plan node with precise execution timestamps from observability data
            // Both executionStartedAt/executionCompletedAt (legacy) and actualStartDate/actualEndDate (new)
            await db
              .update(planNodes)
              .set({
                executionStartedAt: firstStartTime,
                executionCompletedAt: lastEndTime || null,
                actualStartDate: firstStartTime,
                actualEndDate: lastEndTime || null,
              })
              .where(
                and(
                  eq(planNodes.projectId, state.projectId),
                  eq(planNodes.clientId, state.nodeId)
                )
              )
          }
        }
      } catch (err) {
        console.error(`[observability] Failed to update plan node timestamps for ${traceId}:`, err)
      }
    }

    // Write markdown summary and model to taskExecutions
    if (summary || state.model) {
      try {
        const updateFields: Record<string, unknown> = {}
        if (summary) updateFields.markdownSummary = summary
        if (state.model) updateFields.model = state.model
        await db
          .update(taskExecutions)
          .set(updateFields)
          .where(eq(taskExecutions.executionId, traceId))
      } catch (err) {
        console.error(`[observability] Failed to write markdown summary/model for ${traceId}:`, err)
      }
    }

    // Clean up safety rails state
    safetyRails.resetExecution(traceId)

    // Remove trace state
    this.traces.delete(traceId)
  }

  // ── Test helpers ────────────────────────────────────────────────────

  /** Expose trace state for testing purposes */
  _getTraceState(traceId: string): TraceState | undefined {
    return this.traces.get(traceId)
  }

  /** Expose trace count for testing */
  _getTraceCount(): number {
    return this.traces.size
  }
}

/** Singleton instance */
export const observationCollector = new ObservationCollector()

/** EventHook for astroEventTransport */
export const observabilityHook: EventHook = (event) => {
  observationCollector.handleLifecycleEvent(event)
}

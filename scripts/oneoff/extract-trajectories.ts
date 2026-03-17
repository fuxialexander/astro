#!/usr/bin/env npx tsx
/**
 * Extract multi-turn LLM trajectories from Astro's PGlite database.
 * Outputs JSONL suitable for SFT training.
 *
 * Usage:
 *   npx tsx scripts/extract-trajectories.ts [--trace-id <id>] [--out <file>]
 *
 * Each line is a complete trajectory:
 *   { traceId, model, projectId, nodeId, turns: [...], outcome, metrics }
 *
 * Each turn contains:
 *   { turnIndex, assistantText, toolCalls: [{ name, input, result, success }], tokens }
 */

import { homedir } from 'os'
import { join } from 'path'
import { writeFileSync } from 'fs'

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
let filterTraceId: string | null = null
let outFile = 'trajectories.jsonl'

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--trace-id' && args[i + 1]) filterTraceId = args[++i]
  if (args[i] === '--out' && args[i + 1]) outFile = args[++i]
}

// ── Connect to PGlite ────────────────────────────────────────────────────────

async function main() {
  const { PGlite } = await import('@electric-sql/pglite')
  const dataDir = process.env.PGLITE_DATA_DIR || join(homedir(), '.astro', 'pglite')
  console.log(`[extract] Opening PGlite at ${dataDir}`)

  const pg = new PGlite(dataDir)

  // ── Query all observations ────────────────────────────────────────────────

  const traceFilter = filterTraceId
    ? `WHERE trace_id = '${filterTraceId}'`
    : ''

  const { rows: observations } = await pg.query<{
    id: string
    trace_id: string
    parent_observation_id: string | null
    type: string
    name: string
    start_time: string
    end_time: string | null
    input: unknown
    output: unknown
    model: string | null
    input_tokens: number | null
    output_tokens: number | null
    estimated_cost_usd: number | null
    level: string
    metadata: Record<string, unknown> | null
    project_id: string | null
    node_id: string | null
  }>(`SELECT * FROM observation_events ${traceFilter} ORDER BY start_time ASC`)

  console.log(`[extract] Found ${observations.length} observations`)

  // ── Group by trace ────────────────────────────────────────────────────────

  const traces = new Map<string, typeof observations>()
  for (const obs of observations) {
    const list = traces.get(obs.trace_id) || []
    list.push(obs)
    traces.set(obs.trace_id, list)
  }

  console.log(`[extract] Found ${traces.size} distinct traces`)

  // ── Also query task_executions for outcome metadata ─────────────────────

  const { rows: executions } = await pg.query<{
    execution_id: string
    node_client_id: string
    project_id: string
    status: string
    model: string | null
    input_tokens: number | null
    output_tokens: number | null
    turns_used: number | null
    duration_ms: number | null
    markdown_summary: string | null
  }>(`SELECT execution_id, node_client_id, project_id, status, model,
      input_tokens, output_tokens, turns_used, duration_ms, markdown_summary
      FROM task_executions`)

  // Key by UUID portion of execution_id for matching against trace IDs
  // execution_id format: exec-{uuid}-{timestamp}
  const uuidFromExecId = (id: string) => id.match(/^exec-([0-9a-f-]{36})-/)?.[1] ?? id
  const execMap = new Map(executions.map(e => [uuidFromExecId(e.execution_id), e]))

  // ── Build trajectories ──────────────────────────────────────────────────

  interface ToolCall {
    name: string
    input: unknown
    result: unknown
    success: boolean | null
  }

  interface Turn {
    turnIndex: number
    assistantText: string
    toolCalls: ToolCall[]
    inputTokens: number | null
    outputTokens: number | null
    model: string | null
  }

  interface Trajectory {
    traceId: string
    model: string | null
    projectId: string | null
    nodeId: string | null
    context: {
      taskTitle?: string
      taskDescription?: string
      visionDoc?: string
    } | null
    turns: Turn[]
    outcome: {
      status: string
      summary: string | null
      durationMs: number | null
    } | null
    metrics: {
      totalTurns: number
      totalToolCalls: number
      totalInputTokens: number
      totalOutputTokens: number
      estimatedCostUsd: number
    }
  }

  const trajectories: Trajectory[] = []

  for (const [traceId, obss] of traces) {
    // Separate by type
    const generations = obss
      .filter(o => o.type === 'generation')
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())

    const toolObs = obss.filter(o => o.type === 'tool')
    const contextSpan = obss.find(o => o.type === 'span' && o.name === 'context')

    // Skip traces with no generations (just progress events)
    if (generations.length === 0) continue

    // Build tool lookup: parentObservationId → tool observations
    const toolsByParent = new Map<string, typeof toolObs>()
    for (const t of toolObs) {
      if (t.parent_observation_id) {
        const list = toolsByParent.get(t.parent_observation_id) || []
        list.push(t)
        toolsByParent.set(t.parent_observation_id, list)
      }
    }

    // Extract context
    const ctx = contextSpan?.input as Record<string, unknown> | null
    const context = ctx ? {
      taskTitle: ctx.taskTitle as string | undefined,
      taskDescription: ctx.taskDescription as string | undefined,
      visionDoc: ctx.visionDoc as string | undefined,
    } : null

    // Build turns from generations
    const turns: Turn[] = []
    let primaryModel: string | null = null

    // First pass: collect generations and their tool results from the NEXT turn's input
    type GenParsed = {
      gen: typeof generations[0]
      output: { text?: string; toolCalls?: Array<{ toolName: string; toolInput: unknown; toolUseId?: string }> } | null
      input: { turnIndex?: number; toolResults?: Array<{ toolName?: string; toolUseId?: string; result: unknown; success?: boolean }> } | null
    }
    const parsed: GenParsed[] = generations.map(gen => ({
      gen,
      output: gen.output as GenParsed['output'],
      input: gen.input as GenParsed['input'],
    }))

    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i]
      const nextInput = parsed[i + 1]?.input

      if (!primaryModel && p.gen.model) primaryModel = p.gen.model

      const assistantText = p.output?.text || ''
      const genToolCalls = p.output?.toolCalls || []
      const childTools = toolsByParent.get(p.gen.id) || []

      // Tool results come from three sources (in priority order):
      // 1. Child tool observations (matched by parent)
      // 2. Next generation's input.toolResults (the relay captures results here)
      // 3. Standalone tool observations matched by name
      const nextToolResults = nextInput?.toolResults || []

      const toolCallsWithResults: ToolCall[] = genToolCalls.map((tc, idx) => {
        // Source 1: child tool observation
        const childMatch = childTools.find(t =>
          t.name === `tool:${tc.toolName}` || t.name === tc.toolName
        )

        // Source 2: next turn's tool results (positional match by index)
        const nextResult = nextToolResults[idx]

        const result = childMatch?.output ?? nextResult?.result ?? null
        const success = childMatch
          ? childMatch.level !== 'error'
          : nextResult?.success ?? null

        return { name: tc.toolName, input: tc.toolInput, result, success }
      })

      turns.push({
        turnIndex: p.input?.turnIndex ?? turns.length,
        assistantText,
        toolCalls: toolCallsWithResults,
        inputTokens: p.gen.input_tokens,
        outputTokens: p.gen.output_tokens,
        model: p.gen.model,
      })
    }

    // Match to execution for outcome
    // Both traceId and execution_id share format: exec-{uuid}-{timestamp}
    // but timestamps differ, so match by UUID portion only
    const traceUuid = traceId.match(/^exec-([0-9a-f-]{36})-/)?.[1]
    const exec = traceUuid ? execMap.get(traceUuid) : undefined

    const outcome = exec ? {
      status: exec.status,
      summary: exec.markdown_summary,
      durationMs: exec.duration_ms,
    } : null

    // Compute metrics
    const totalInputTokens = turns.reduce((s, t) => s + (t.inputTokens || 0), 0)
    const totalOutputTokens = turns.reduce((s, t) => s + (t.outputTokens || 0), 0)
    const totalToolCalls = turns.reduce((s, t) => s + t.toolCalls.length, 0)
    const estimatedCostUsd = obss.reduce((s, o) => s + (o.estimated_cost_usd || 0), 0)

    trajectories.push({
      traceId,
      model: primaryModel,
      projectId: obss[0]?.project_id || exec?.project_id || null,
      nodeId: obss[0]?.node_id || exec?.node_client_id || null,
      context,
      turns,
      outcome,
      metrics: {
        totalTurns: turns.length,
        totalToolCalls,
        totalInputTokens,
        totalOutputTokens,
        estimatedCostUsd,
      },
    })
  }

  // ── Write JSONL ───────────────────────────────────────────────────────────

  const lines = trajectories.map(t => JSON.stringify(t))
  writeFileSync(outFile, lines.join('\n') + '\n')

  console.log(`[extract] Wrote ${trajectories.length} trajectories to ${outFile}`)

  // ── Print summary ─────────────────────────────────────────────────────────

  console.log('\n=== Extraction Summary ===')
  for (const t of trajectories) {
    const turnInfo = t.turns.map(turn =>
      `T${turn.turnIndex}(${turn.toolCalls.length} tools)`
    ).join(' → ')
    console.log(`  ${t.traceId.slice(0, 50)}`)
    console.log(`    Model: ${t.model || '?'}`)
    console.log(`    Turns: ${t.metrics.totalTurns}, Tools: ${t.metrics.totalToolCalls}`)
    console.log(`    Flow: ${turnInfo.slice(0, 100)}${turnInfo.length > 100 ? '...' : ''}`)
    console.log(`    Outcome: ${t.outcome?.status || 'unknown'}`)
    console.log()
  }

  await pg.close()
}

main().catch(err => {
  console.error('[extract] Fatal:', err)
  process.exit(1)
})

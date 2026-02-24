import type { Command } from 'commander'
import chalk from 'chalk'
import { getClient } from '../client.js'
import type { ToolTrace, FileChange, ObservationEvent, Execution } from '../client.js'
import { print, parseDateFilter, type ColumnDef } from '../output.js'

function formatTime(date: Date | string | null | undefined): string {
  if (!date) return '\u2014'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatTraceDuration(ms: number | null | undefined): string {
  if (ms == null) return '\u2014'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

const traceColumns: ColumnDef[] = [
  { key: 'time', label: 'TIME', width: 12, format: (v) => formatTime(v as string) },
  { key: 'tool', label: 'TOOL', width: 24 },
  { key: 'duration', label: 'DURATION', width: 12, format: (v) => formatTraceDuration(v as number) },
  { key: 'status', label: 'STATUS', width: 8, format: (v) => v ? chalk.green('\u2713') : chalk.red('\u2717') },
]

export function registerTraceCommands(program: Command): void {
  const cmd = program.command('trace').description('View execution traces')

  cmd
    .command('list')
    .description('List tool traces for an execution')
    .requiredOption('--execution-id <id>', 'Execution ID')
    .option('--since <date>', 'Show traces after date (e.g. 2d, 1h, today, ISO)')
    .option('--until <date>', 'Show traces before date (e.g. 2d, 1h, yesterday, ISO)')
    .action(async (opts) => {
      const client = getClient(program.opts().serverUrl)
      const json = program.opts().json
      const executionId = opts.executionId

      let traces: ToolTrace[]
      let changes: FileChange[]
      let execution: Execution | null
      try {
        // If date filters are used, use filtered observation API
        if (opts.since || opts.until) {
          const params: { executionId: string; startAfter?: string; startBefore?: string } = { executionId }
          if (opts.since) params.startAfter = parseDateFilter(opts.since).toISOString()
          if (opts.until) params.startBefore = parseDateFilter(opts.until).toISOString()
          // Still use regular traces but apply client-side filter
        }

        // Fetch tool traces
        traces = await client.listToolTraces(executionId)

        // Apply client-side date filters
        if (opts.since) {
          const since = parseDateFilter(opts.since)
          traces = traces.filter(t => t.timestamp && new Date(t.timestamp) >= since)
        }
        if (opts.until) {
          const until = parseDateFilter(opts.until)
          traces = traces.filter(t => t.timestamp && new Date(t.timestamp) <= until)
        }

        // Fetch file changes for summary
        changes = await client.listFileChanges(executionId)

        // Fetch execution for token summary — find matching execution from the map
        const executionsMap = await client.getExecutions()
        execution = Object.values(executionsMap).find(
          (e) => e.executionId === executionId
        ) ?? null
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exitCode = 1
        return
      }

      const formatted = traces.map((t) => ({
        time: t.timestamp,
        tool: t.toolName,
        duration: t.duration,
        status: t.success,
      }))

      if (json) {
        print({
          traces,
          fileChanges: changes,
          execution,
          summary: {
            totalToolCalls: traces.length,
            totalDurationMs: traces.reduce((sum: number, t) => sum + (t.duration ?? 0), 0),
            filesChanged: changes.length,
            totalTokens: execution ? (execution.inputTokens ?? 0) + (execution.outputTokens ?? 0) : 0,
          },
        }, { json: true })
        return
      }

      // Human output
      print(formatted, { columns: traceColumns })

      // File change summary
      if (changes.length > 0) {
        const actionCounts: Record<string, number> = {}
        for (const c of changes) {
          actionCounts[c.action] = (actionCounts[c.action] || 0) + 1
        }
        const parts = Object.entries(actionCounts).map(([action, count]) => `${count} ${action}d`)
        console.log(`\n${chalk.bold('Files changed:')} ${changes.length} (${parts.join(', ')})`)
      } else {
        console.log(`\n${chalk.bold('Files changed:')} 0`)
      }

      // Totals summary
      const totalCalls = traces.length
      const totalDurationMs = traces.reduce((sum: number, t) => sum + (t.duration ?? 0), 0)
      const totalTokens = execution ? (execution.inputTokens ?? 0) + (execution.outputTokens ?? 0) : 0

      console.log(
        `${chalk.bold('Total:')} ${totalCalls} tool calls, ${formatTraceDuration(totalDurationMs)}, ${formatTokens(totalTokens)} tokens`
      )
    })

  cmd
    .command('show')
    .description('Show full trace details for an execution')
    .requiredOption('--execution-id <id>', 'Execution ID')
    .action(async (opts) => {
      const client = getClient(program.opts().serverUrl)
      const json = program.opts().json
      const executionId = opts.executionId

      let observations: ObservationEvent[]
      try {
        // Fetch observation events
        const result = await client.listObservations(executionId)
        observations = result.data
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exitCode = 1
        return
      }

      if (json) {
        print(observations, { json: true })
        return
      }

      // Human-readable output: summary per observation
      if (observations.length === 0) {
        console.log(chalk.dim('  No observation events found for this execution.'))
        return
      }

      console.log(chalk.bold(`Trace: ${executionId}\n`))
      console.log(chalk.bold('NAME'.padEnd(30) + '  TYPE'.padEnd(14) + '  MODEL'.padEnd(22) + '  TOKENS'.padEnd(12) + '  COST'))
      console.log(chalk.dim('\u2500'.repeat(90)))

      for (const obs of observations) {
        const name = (obs.name ?? '\u2014').slice(0, 28).padEnd(30)
        const type = (obs.type ?? '\u2014').padEnd(12)
        const model = (obs.model ?? '\u2014').slice(0, 20).padEnd(22)
        const tokens = obs.inputTokens != null || obs.outputTokens != null
          ? formatTokens((obs.inputTokens ?? 0) + (obs.outputTokens ?? 0)).padEnd(12)
          : '\u2014'.padEnd(12)
        const cost = obs.estimatedCostUsd != null
          ? `$${obs.estimatedCostUsd.toFixed(4)}`
          : '\u2014'

        console.log(`${name}${type}${model}${tokens}${cost}`)
      }

      // Summary line
      const totalTokens = observations.reduce(
        (sum: number, o) => sum + (o.inputTokens ?? 0) + (o.outputTokens ?? 0),
        0
      )
      const totalCost = observations.reduce(
        (sum: number, o) => sum + (o.estimatedCostUsd ?? 0),
        0
      )
      console.log(chalk.dim('\u2500'.repeat(90)))
      console.log(
        chalk.bold(`Total: ${observations.length} events, ${formatTokens(totalTokens)} tokens, $${totalCost.toFixed(4)}`)
      )
    })

  // ── trace summary ─────────────────────────────────────────────────
  cmd
    .command('summary')
    .description('Show markdown summary for an execution')
    .requiredOption('--execution-id <id>', 'Execution ID')
    .action(async (opts) => {
      const client = getClient(program.opts().serverUrl)
      const json = program.opts().json
      const executionId = opts.executionId

      try {
        const summary = await client.getTraceSummary(executionId)

        if (json) {
          print({ executionId, summary }, { json: true })
        } else {
          console.log(summary)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (json) {
          print({ error: msg }, { json: true })
        } else {
          console.error(chalk.red(`Failed to get summary: ${msg}`))
        }
        process.exitCode = 1
      }
    })

  // ── trace stats ───────────────────────────────────────────────────
  cmd
    .command('stats')
    .description('Show observation statistics for an execution')
    .requiredOption('--execution-id <id>', 'Execution ID')
    .action(async (opts) => {
      const client = getClient(program.opts().serverUrl)
      const json = program.opts().json
      const executionId = opts.executionId

      try {
        const stats = await client.getObservationStats(executionId)

        if (json) {
          print(stats, { json: true })
          return
        }

        console.log()
        console.log(chalk.bold('  Observation Statistics'))
        console.log(chalk.dim('  ' + '\u2500'.repeat(40)))
        console.log(`  ${chalk.dim('Total Events:')}       ${stats.totalEvents}`)
        console.log(`  ${chalk.dim('Total Spans:')}        ${stats.totalSpans}`)
        console.log(`  ${chalk.dim('Total Generations:')}  ${stats.totalGenerations}`)
        console.log(`  ${chalk.dim('Total Tools:')}        ${stats.totalTools}`)
        console.log(`  ${chalk.dim('Errors:')}             ${stats.errorCount > 0 ? chalk.red(String(stats.errorCount)) : '0'}`)
        console.log(`  ${chalk.dim('Warnings:')}           ${stats.warningCount > 0 ? chalk.yellow(String(stats.warningCount)) : '0'}`)
        console.log(`  ${chalk.dim('Input Tokens:')}       ${formatTokens(stats.totalInputTokens)}`)
        console.log(`  ${chalk.dim('Output Tokens:')}      ${formatTokens(stats.totalOutputTokens)}`)
        console.log(`  ${chalk.dim('Total Cost:')}         $${stats.totalCostUsd.toFixed(4)}`)
        console.log()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (json) {
          print({ error: msg }, { json: true })
        } else {
          console.error(chalk.red(`Failed to get stats: ${msg}`))
        }
        process.exitCode = 1
      }
    })
}

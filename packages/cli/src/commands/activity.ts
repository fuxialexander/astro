import type { Command } from 'commander'
import chalk from 'chalk'
import { getClient } from '../client.js'
import { print, formatRelativeTime, parseDateFilter, formatDuration, type ColumnDef } from '../output.js'

const activityColumns: ColumnDef[] = [
  { key: 'time', label: 'TIME', width: 12, format: (v) => formatRelativeTime(v as string) },
  { key: 'type', label: 'TYPE', width: 20 },
  { key: 'title', label: 'TITLE', width: 40 },
  { key: 'projectId', label: 'PROJECT_ID', width: 12, format: (v) => v ? String(v).slice(0, 8) : '\u2014' },
  { key: 'nodeId', label: 'NODE_ID', width: 12, format: (v) => v ? String(v).slice(0, 8) : '\u2014' },
]

export function registerActivityCommands(program: Command): void {
  const cmd = program.command('activity').description('View activity feed')

  cmd
    .command('list')
    .description('List recent activity')
    .option('--project <id>', 'Filter by project')
    .option('--limit <n>', 'Number of entries', '20')
    .option('--type <type>', 'Filter by event type')
    .option('--since <date>', 'Show events after date (e.g. 2d, 1h, today, ISO)')
    .option('--until <date>', 'Show events before date (e.g. 2d, 1h, yesterday, ISO)')
    .action(async (opts) => {
      const client = getClient(program.opts().serverUrl)
      const json = program.opts().json

      let rows
      try {
        rows = await client.listActivities({
          projectId: opts.project,
          limit: opts.limit,
        })
      } catch (err) {
        console.error((err as Error).message)
        process.exitCode = 1
        return
      }

      // Client-side filters
      if (opts.type) {
        rows = rows.filter((r) => r.type === opts.type)
      }
      if (opts.since) {
        const since = parseDateFilter(opts.since)
        rows = rows.filter((r) => r.createdAt && new Date(r.createdAt) >= since)
      }
      if (opts.until) {
        const until = parseDateFilter(opts.until)
        rows = rows.filter((r) => r.createdAt && new Date(r.createdAt) <= until)
      }

      const formatted = rows.map((r) => ({
        time: r.createdAt,
        type: r.type,
        title: r.title,
        projectId: r.projectId,
        nodeId: r.nodeId,
        description: r.description,
        metadata: r.metadata,
        id: r.id,
      }))

      print(formatted, { json, columns: activityColumns })
    })

  // ── activity watch ──────────────────────────────────────────────────
  cmd
    .command('watch')
    .description('Watch real-time activity events via SSE')
    .option('--project <id>', 'Filter by project')
    .option('--type <type>', 'Filter by event type')
    .action(async (opts: { project?: string; type?: string }) => {
      const client = getClient(program.opts().serverUrl)
      const isJson = program.opts().json

      try {
        const response = await client.streamEvents({ projectId: opts.project })
        if (!response.body) {
          console.error(chalk.red('No stream body received'))
          process.exitCode = 1
          return
        }

        if (!isJson) {
          console.log(chalk.dim('Watching activity events... (Ctrl+C to stop)'))
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6)) as {
                type: string
                taskId?: string
                status?: string
                message?: string
                duration?: number
                name?: string
                [key: string]: unknown
              }

              // Skip heartbeats
              if (event.type === 'heartbeat') continue

              // Filter by type if specified
              if (opts.type && event.type !== opts.type) continue

              if (isJson) {
                console.log(JSON.stringify(event))
                continue
              }

              const time = new Date().toLocaleTimeString('en-US', { hour12: false })
              const taskStr = event.taskId ? chalk.dim(` ${event.taskId.slice(0, 12)}`) : ''
              const statusStr = event.status ? ` ${event.status}` : ''
              const durationStr = event.duration != null ? chalk.dim(` (${formatDuration(event.duration)})`) : ''
              const msgStr = event.message ? ` ${event.message}` : ''

              console.log(`[${chalk.dim(time)}] ${chalk.bold(event.type)}${taskStr}${statusStr}${durationStr}${msgStr}`)
            } catch {
              // Skip non-JSON lines
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (isJson) {
          print({ error: msg }, { json: true })
        } else {
          console.error(chalk.red(`Watch failed: ${msg}`))
        }
        process.exitCode = 1
      }
    })
}

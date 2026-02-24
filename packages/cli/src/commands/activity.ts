import type { Command } from 'commander'
import { getClient } from '../client.js'
import { print, formatRelativeTime, type ColumnDef } from '../output.js'

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
}

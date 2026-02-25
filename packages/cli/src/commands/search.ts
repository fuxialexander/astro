import type { Command } from 'commander'
import chalk from 'chalk'
import { getClient } from '../client.js'
import type { Project, PlanNode, Execution } from '../client.js'
import { print, formatStatus, parseDateFilter, type ColumnDef } from '../output.js'

export function registerSearchCommands(program: Command): void {
  program
    .command('search <query>')
    .description('Search across projects, tasks, and executions')
    .option('--type <type>', 'Filter by type: projects, tasks, executions')
    .option('--since <date>', 'Show results updated after date (e.g. 2d, 1h, today, ISO)')
    .option('--until <date>', 'Show results updated before date (e.g. 2d, 1h, yesterday, ISO)')
    .action(async (query: string, cmdOpts: { type?: string; since?: string; until?: string }) => {
      const client = getClient(program.opts().serverUrl)
      const isJson = program.opts().json

      let projectResults: Project[], taskResults: Array<PlanNode & { projectName?: string }>, executionResults: Execution[]
      try {
        const results = await client.search(query)
        projectResults = results.projects
        taskResults = results.tasks
        executionResults = results.executions
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exitCode = 1
        return
      }

      // Apply date filters (client-side)
      if (cmdOpts.since) {
        const since = parseDateFilter(cmdOpts.since)
        projectResults = projectResults.filter(p => p.updatedAt && new Date(p.updatedAt) >= since)
        taskResults = taskResults.filter(t => t.updatedAt && new Date(t.updatedAt) >= since)
        executionResults = executionResults.filter(e => e.startedAt && new Date(e.startedAt) >= since)
      }
      if (cmdOpts.until) {
        const until = parseDateFilter(cmdOpts.until)
        projectResults = projectResults.filter(p => p.updatedAt && new Date(p.updatedAt) <= until)
        taskResults = taskResults.filter(t => t.updatedAt && new Date(t.updatedAt) <= until)
        executionResults = executionResults.filter(e => e.startedAt && new Date(e.startedAt) <= until)
      }

      // Apply type filter
      if (cmdOpts.type) {
        if (cmdOpts.type !== 'projects') projectResults = []
        if (cmdOpts.type !== 'tasks') taskResults = []
        if (cmdOpts.type !== 'executions') executionResults = []
      }

      if (isJson) {
        print(
          {
            projects: projectResults,
            tasks: taskResults,
            executions: executionResults,
          },
          { json: true },
        )
        return
      }

      // Human-friendly grouped output
      const totalMatches = projectResults.length + taskResults.length + executionResults.length
      if (totalMatches === 0) {
        console.log(chalk.dim(`No results for "${query}"`))
        return
      }

      // Projects
      if (projectResults.length > 0) {
        console.log()
        console.log(chalk.bold(`Projects (${projectResults.length} match${projectResults.length === 1 ? '' : 'es'}):`))

        const projectCols: ColumnDef[] = [
          { key: 'id', label: 'ID', width: 8, format: (v) => String(v ?? '').slice(0, 8) },
          { key: 'name', label: 'NAME', width: 30 },
          { key: 'status', label: 'STATUS', width: 12, format: (v) => formatStatus(String(v ?? '')) },
          { key: 'workingDirectory', label: 'DIRECTORY', width: 40, format: (v) => String(v ?? '') },
        ]
        print(projectResults, { columns: projectCols })
      }

      // Tasks
      if (taskResults.length > 0) {
        console.log()
        console.log(chalk.bold(`Tasks (${taskResults.length} match${taskResults.length === 1 ? '' : 'es'}):`))

        const taskCols: ColumnDef[] = [
          { key: 'clientId', label: 'CLIENT_ID', width: 12 },
          { key: 'title', label: 'TITLE', width: 35 },
          { key: 'status', label: 'STATUS', width: 18, format: (v) => formatStatus(String(v ?? '')) },
          { key: 'projectName', label: 'PROJECT', width: 20, format: (v) => String(v ?? '') },
        ]
        print(taskResults, { columns: taskCols })
      }

      // Executions
      if (executionResults.length > 0) {
        console.log()
        console.log(chalk.bold(`Executions (${executionResults.length} match${executionResults.length === 1 ? '' : 'es'}):`))

        const execCols: ColumnDef[] = [
          { key: 'executionId', label: 'EXECUTION_ID', width: 20 },
          { key: 'nodeClientId', label: 'NODE_ID', width: 12 },
          { key: 'status', label: 'STATUS', width: 12, format: (v) => formatStatus(String(v ?? '')) },
          {
            key: 'startedAt',
            label: 'STARTED',
            width: 20,
            format: (v) => {
              if (!v) return ''
              const d = v instanceof Date ? v : new Date(String(v))
              return d.toLocaleString()
            },
          },
        ]
        print(executionResults, { columns: execCols })
      }

      console.log()
    })
}

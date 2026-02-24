import type { Command } from 'commander'
import chalk from 'chalk'
import { getClient, streamDispatchToStdout } from '../client.js'
import type { PlanNode } from '../client.js'
import { print, formatRelativeTime, formatStatus, type ColumnDef } from '../output.js'

export function registerTaskCommands(program: Command): void {
  const cmd = program.command('task').description('Manage tasks')

  cmd
    .command('list')
    .description('List tasks across projects')
    .option('--project <id>', 'Filter by project ID')
    .option('--status <status>', 'Filter by status (planned, in_progress, completed, etc.)')
    .action(async (opts: { project?: string; status?: string }) => {
      const client = getClient()
      const isJson = program.opts().json

      let nodes
      try {
        // Fetch nodes: scoped to project or all
        const result = opts.project
          ? await client.getPlan(opts.project)
          : await client.getFullPlan()
        nodes = result.nodes
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exitCode = 1
        return
      }

      // Filter out deleted and apply status filter
      let filtered = nodes.filter((n: PlanNode) => !n.deletedAt)
      if (opts.status) {
        filtered = filtered.filter((n: PlanNode) => n.status === opts.status)
      }

      // Sort by updatedAt descending
      filtered.sort((a: PlanNode, b: PlanNode) => {
        const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
        const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
        return db - da
      })

      // Build projectId → name lookup
      const projects = await client.listProjects()
      const projectMap = new Map(projects.map(p => [p.id, p.name]))

      // Build display rows
      const rows = filtered.map((n: PlanNode) => ({
        id: n.id,
        title: n.title,
        status: n.status,
        projectName: projectMap.get(n.projectId) ?? n.projectId,
        updatedAt: n.updatedAt,
      }))

      if (isJson) {
        print(rows, { json: true })
        return
      }

      const columns: ColumnDef[] = [
        { key: 'id', label: 'ID', width: 12 },
        { key: 'title', label: 'TITLE', width: 40 },
        { key: 'status', label: 'STATUS', width: 18, format: (v) => formatStatus(String(v ?? '')) },
        { key: 'projectName', label: 'PROJECT', width: 20 },
        { key: 'updatedAt', label: 'UPDATED', width: 12, format: (v) => formatRelativeTime(v as string | Date | null) },
      ]

      print(rows, { columns })
    })

  cmd
    .command('show <id>')
    .description('Show task details')
    .action(async (clientId: string) => {
      const client = getClient()
      const isJson = program.opts().json

      let nodes
      try {
        // Find the plan node by clientId across all projects
        const result = await client.getFullPlan()
        nodes = result.nodes
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exitCode = 1
        return
      }
      const node = nodes.find((n: PlanNode) => n.id === clientId && !n.deletedAt)

      if (!node) {
        console.error(chalk.red(`Task not found: ${clientId}`))
        process.exitCode = 1
        return
      }

      let projectName: string
      let latestExecution: Awaited<ReturnType<typeof client.getExecutions>>[string] | null
      let changes: Array<{
        id: string
        executionId: string
        path: string
        action: string
        linesAdded: number | null
        linesRemoved: number | null
        timestamp: string
      }> = []
      try {
        // Get project name
        const projects = await client.listProjects()
        const project = projects.find(p => p.id === node.projectId)
        projectName = project?.name ?? node.projectId

        // Get execution for this node
        const executionMap = await client.getExecutions()
        latestExecution = executionMap[node.id] ?? null

        // Get file changes if execution exists
        if (latestExecution?.executionId) {
          changes = await client.listFileChanges(latestExecution.executionId)
        }
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exitCode = 1
        return
      }

      if (isJson) {
        print({ ...node, projectName, execution: latestExecution, fileChanges: changes }, { json: true })
        return
      }

      // Human-friendly output
      console.log()
      console.log(chalk.bold(node.title))
      console.log(chalk.dim('\u2500'.repeat(60)))
      console.log(`  ${chalk.dim('ID:')}           ${node.id}`)
      console.log(`  ${chalk.dim('Type:')}         ${node.type}`)
      console.log(`  ${chalk.dim('Status:')}       ${formatStatus(node.status)}`)
      console.log(`  ${chalk.dim('Project:')}      ${projectName}`)
      if (node.priority) {
        console.log(`  ${chalk.dim('Priority:')}     ${node.priority}`)
      }
      if (node.estimate) {
        console.log(`  ${chalk.dim('Estimate:')}     ${node.estimate}`)
      }
      if (node.startDate) {
        console.log(`  ${chalk.dim('Start Date:')}   ${node.startDate}`)
      }
      if (node.endDate) {
        console.log(`  ${chalk.dim('End Date:')}     ${node.endDate}`)
      }
      if (node.dueDate) {
        console.log(`  ${chalk.dim('Due Date:')}     ${node.dueDate}`)
      }
      if (node.branchName) {
        console.log(`  ${chalk.dim('Branch:')}       ${node.branchName}`)
      }
      if (node.prUrl) {
        console.log(`  ${chalk.dim('PR:')}           ${node.prUrl}`)
      }
      if (node.description) {
        console.log()
        console.log(chalk.dim('  Description:'))
        console.log(`  ${node.description}`)
      }
      console.log()
      console.log(`  ${chalk.dim('Created:')}      ${formatRelativeTime(node.createdAt)}`)
      console.log(`  ${chalk.dim('Updated:')}      ${formatRelativeTime(node.updatedAt)}`)

      // Latest execution
      if (latestExecution) {
        console.log()
        console.log(chalk.bold('  Latest Execution'))
        console.log(chalk.dim('  ' + '\u2500'.repeat(56)))
        console.log(`    ${chalk.dim('Execution ID:')}  ${latestExecution.executionId}`)
        console.log(`    ${chalk.dim('Status:')}        ${formatStatus(latestExecution.status)}`)
        if (latestExecution.providerName) {
          console.log(`    ${chalk.dim('Provider:')}      ${latestExecution.providerName}`)
        }
        if (latestExecution.model) {
          console.log(`    ${chalk.dim('Model:')}         ${latestExecution.model}`)
        }
        if (latestExecution.machineId) {
          console.log(`    ${chalk.dim('Machine:')}       ${latestExecution.machineId}`)
        }
        console.log(`    ${chalk.dim('Started:')}       ${formatRelativeTime(latestExecution.startedAt)}`)
        if (latestExecution.completedAt) {
          console.log(`    ${chalk.dim('Completed:')}     ${formatRelativeTime(latestExecution.completedAt)}`)
        }
        if (latestExecution.durationMs != null) {
          const secs = (latestExecution.durationMs / 1000).toFixed(1)
          console.log(`    ${chalk.dim('Duration:')}      ${secs}s`)
        }
        if (latestExecution.tokensUsed != null) {
          console.log(`    ${chalk.dim('Tokens:')}        ${latestExecution.tokensUsed.toLocaleString()}`)
        }
        if (latestExecution.estimatedCostUsd != null) {
          console.log(`    ${chalk.dim('Cost:')}          $${latestExecution.estimatedCostUsd.toFixed(4)}`)
        }
        if (latestExecution.error) {
          console.log(`    ${chalk.red('Error:')}         ${latestExecution.error}`)
        }
        if (latestExecution.markdownSummary) {
          console.log()
          console.log(chalk.dim('    Summary:'))
          console.log(`    ${latestExecution.markdownSummary}`)
        }
      }

      // File changes
      if (changes.length > 0) {
        console.log()
        console.log(chalk.bold('  File Changes'))
        console.log(chalk.dim('  ' + '\u2500'.repeat(56)))
        for (const fc of changes) {
          const actionColor = fc.action === 'create' ? chalk.green : fc.action === 'delete' ? chalk.red : chalk.yellow
          const stats = []
          if (fc.linesAdded != null && fc.linesAdded > 0) stats.push(chalk.green(`+${fc.linesAdded}`))
          if (fc.linesRemoved != null && fc.linesRemoved > 0) stats.push(chalk.red(`-${fc.linesRemoved}`))
          const statsStr = stats.length > 0 ? ` (${stats.join(', ')})` : ''
          console.log(`    ${actionColor(fc.action.padEnd(8))} ${fc.path}${statsStr}`)
        }
      }

      console.log()
    })

  cmd
    .command('dispatch <id>')
    .description('Dispatch a task for execution')
    .requiredOption('--project-id <id>', 'Project ID')
    .option('--force', 'Force re-dispatch even if already running')
    .option('--server-url <url>', 'Override server URL')
    .action(async (nodeId: string, opts: { projectId: string; force?: boolean; serverUrl?: string }) => {
      const client = getClient(opts.serverUrl)

      console.log(chalk.dim(`Dispatching task ${chalk.bold(nodeId)} to server...`))
      console.log()

      try {
        const response = await client.dispatchTask({
          nodeId,
          projectId: opts.projectId,
          force: opts.force ?? false,
        })
        await streamDispatchToStdout(response)
        console.log()
        console.log(chalk.green('Task dispatch complete.'))
      } catch (err) {
        console.error(chalk.red(`Dispatch failed: ${err instanceof Error ? err.message : String(err)}`))
        process.exitCode = 1
      }
    })
}

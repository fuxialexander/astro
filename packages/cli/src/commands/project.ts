import type { Command } from 'commander'
import { getClient } from '../client.js'
import type { Project } from '../client.js'
import { print, formatRelativeTime, formatStatus, type ColumnDef } from '../output.js'
import chalk from 'chalk'

const projectColumns: ColumnDef[] = [
  { key: 'id', label: 'ID', width: 8, format: (v) => String(v ?? '').slice(0, 8) },
  { key: 'name', label: 'NAME', width: 30 },
  { key: 'status', label: 'STATUS', width: 12, format: (v) => formatStatus(String(v ?? '')) },
  { key: 'workingDirectory', label: 'WORK DIR', width: 30, format: (v) => v ? String(v) : chalk.dim('\u2014') },
  { key: 'updatedAt', label: 'UPDATED', width: 12, format: (v) => formatRelativeTime(v as Date | string | null) },
]

export function registerProjectCommands(program: Command): void {
  const project = program.command('project').description('Manage projects')

  // ── project list ──────────────────────────────────────────────────
  project
    .command('list')
    .description('List all projects')
    .action(async () => {
      const opts = program.opts()
      const client = getClient(opts.serverUrl)

      const rows = await client.listProjects()

      print(rows, { json: opts.json, columns: projectColumns })
    })

  // ── project show <id> ─────────────────────────────────────────────
  project
    .command('show <id>')
    .description('Show project details')
    .action(async (id: string) => {
      const opts = program.opts()
      const client = getClient(opts.serverUrl)

      let p: Project
      try {
        p = await client.resolveProject(id)
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exit(1)
      }

      if (opts.json) {
        print(p, { json: true })
        return
      }

      // Human-readable key-value display
      const fields: [string, unknown][] = [
        ['ID', p.id],
        ['Name', p.name],
        ['Status', formatStatus(p.status)],
        ['Description', p.description || chalk.dim('\u2014')],
        ['Working Directory', p.workingDirectory || chalk.dim('\u2014')],
        ['Source Directory', p.sourceDirectory || chalk.dim('\u2014')],
        ['Repository', p.repository || chalk.dim('\u2014')],
        ['Delivery Mode', p.deliveryMode || chalk.dim('\u2014')],
        ['Health', p.health || chalk.dim('\u2014')],
        ['Progress', `${p.progress ?? 0}%`],
        ['Start Date', p.startDate || chalk.dim('\u2014')],
        ['Target Date', p.targetDate || chalk.dim('\u2014')],
        ['Lead', p.lead || chalk.dim('\u2014')],
        ['Default Environment', p.defaultEnvironment || chalk.dim('\u2014')],
        ['Default Machine ID', p.defaultMachineId || chalk.dim('\u2014')],
        ['Created', formatRelativeTime(p.createdAt)],
        ['Updated', formatRelativeTime(p.updatedAt)],
      ]

      const maxKeyLen = Math.max(...fields.map(([k]) => k.length))
      for (const [key, value] of fields) {
        console.log(`  ${chalk.bold(key.padEnd(maxKeyLen))}  ${value}`)
      }

      if (p.visionDoc) {
        console.log()
        console.log(chalk.bold('  Vision Document:'))
        console.log(`  ${p.visionDoc.slice(0, 500)}${p.visionDoc.length > 500 ? '...' : ''}`)
      }
    })

  // ── project create ────────────────────────────────────────────────
  project
    .command('create')
    .description('Create a new project')
    .requiredOption('--name <name>', 'Project name')
    .option('--description <desc>', 'Project description', '')
    .option('--dir <path>', 'Working directory')
    .action(async (cmdOpts: { name: string; description: string; dir?: string }) => {
      const opts = program.opts()
      const client = getClient(opts.serverUrl)

      const created = await client.createProject({
        name: cmdOpts.name,
        description: cmdOpts.description,
        workingDirectory: cmdOpts.dir,
      })

      if (opts.json) {
        print(created, { json: true })
      } else {
        console.log(chalk.green('Project created:'))
        console.log(`  ${chalk.bold('ID')}    ${created.id}`)
        console.log(`  ${chalk.bold('Name')}  ${created.name}`)
        if (created.workingDirectory) {
          console.log(`  ${chalk.bold('Dir')}   ${created.workingDirectory}`)
        }
      }
    })

  // ── project update <id> ───────────────────────────────────────────
  project
    .command('update <id>')
    .description('Update a project')
    .option('--name <name>', 'New project name')
    .option('--description <desc>', 'New description')
    .option('--status <status>', 'New status')
    .option('--dir <path>', 'New working directory')
    .option('--vision-doc <text>', 'Update vision document')
    .action(async (id: string, cmdOpts: {
      name?: string
      description?: string
      status?: string
      dir?: string
      visionDoc?: string
    }) => {
      const opts = program.opts()
      const client = getClient(opts.serverUrl)

      let p: Project
      try {
        p = await client.resolveProject(id)
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exitCode = 1
        return
      }

      const patch: Record<string, unknown> = {}
      if (cmdOpts.name !== undefined) patch.name = cmdOpts.name
      if (cmdOpts.description !== undefined) patch.description = cmdOpts.description
      if (cmdOpts.status !== undefined) patch.status = cmdOpts.status
      if (cmdOpts.dir !== undefined) patch.workingDirectory = cmdOpts.dir
      if (cmdOpts.visionDoc !== undefined) patch.visionDoc = cmdOpts.visionDoc

      if (Object.keys(patch).length === 0) {
        console.error(chalk.red('No update fields provided. Use --name, --description, --status, --dir, or --vision-doc.'))
        process.exitCode = 1
        return
      }

      try {
        const updated = await client.updateProject(p.id, patch)

        if (opts.json) {
          print(updated, { json: true })
        } else {
          console.log(chalk.green(`Project "${updated.name}" updated: ${Object.keys(patch).join(', ')}`))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (opts.json) {
          print({ error: msg }, { json: true })
        } else {
          console.error(chalk.red(`Update failed: ${msg}`))
        }
        process.exitCode = 1
      }
    })

  // ── project stats <id> ────────────────────────────────────────────
  project
    .command('stats <id>')
    .description('Show project statistics')
    .action(async (id: string) => {
      const opts = program.opts()
      const client = getClient(opts.serverUrl)

      let p: Project
      try {
        p = await client.resolveProject(id)
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exitCode = 1
        return
      }

      try {
        const { nodes, edges } = await client.getPlan(p.id)
        const active = nodes.filter(n => !n.deletedAt)
        const executions = await client.getExecutions()

        // Status counts
        const statusCounts: Record<string, number> = {}
        for (const n of active) {
          statusCounts[n.status] = (statusCounts[n.status] || 0) + 1
        }

        // Execution stats for this project
        const projectExecs = Object.values(executions).filter(e => e.projectId === p.id)
        const successCount = projectExecs.filter(e => e.status === 'success').length
        const totalTokens = projectExecs.reduce((sum, e) => sum + (e.tokensUsed ?? 0), 0)
        const totalCost = projectExecs.reduce((sum, e) => sum + (e.estimatedCostUsd ?? 0), 0)

        const stats = {
          project: { id: p.id, name: p.name, status: p.status },
          plan: {
            totalNodes: active.length,
            totalEdges: edges.length,
            statusCounts,
          },
          executions: {
            total: projectExecs.length,
            successRate: projectExecs.length > 0 ? `${Math.round(successCount / projectExecs.length * 100)}%` : '\u2014',
            totalTokens,
            totalCost: `$${totalCost.toFixed(4)}`,
          },
        }

        if (opts.json) {
          print(stats, { json: true })
          return
        }

        console.log()
        console.log(chalk.bold(`  Project: ${p.name}`))
        console.log(chalk.dim('  ' + '\u2500'.repeat(50)))
        console.log(`  ${chalk.dim('Status:')}          ${formatStatus(p.status)}`)
        console.log(`  ${chalk.dim('Progress:')}        ${p.progress ?? 0}%`)
        console.log()
        console.log(chalk.bold('  Plan'))
        console.log(`    ${chalk.dim('Nodes:')}  ${active.length}`)
        console.log(`    ${chalk.dim('Edges:')}  ${edges.length}`)
        for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
          console.log(`    ${formatStatus(status).padEnd(25)} ${count}`)
        }
        console.log()
        console.log(chalk.bold('  Executions'))
        console.log(`    ${chalk.dim('Total:')}        ${projectExecs.length}`)
        console.log(`    ${chalk.dim('Success Rate:')} ${stats.executions.successRate}`)
        console.log(`    ${chalk.dim('Tokens:')}       ${totalTokens.toLocaleString()}`)
        console.log(`    ${chalk.dim('Cost:')}         ${stats.executions.totalCost}`)
        console.log()
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exitCode = 1
      }
    })

  // ── project delete <id> ───────────────────────────────────────────
  project
    .command('delete <id>')
    .description('Delete a project')
    .action(async (id: string) => {
      const opts = program.opts()
      const client = getClient(opts.serverUrl)

      let p: Project
      try {
        p = await client.resolveProject(id)
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exit(1)
      }

      console.log(chalk.yellow(`Deleting project: ${p.name} (${p.id})`))

      await client.deleteProject(p.id)

      if (opts.json) {
        print({ deleted: true, id: p.id, name: p.name }, { json: true })
      } else {
        console.log(chalk.green('Project deleted.'))
      }
    })
}

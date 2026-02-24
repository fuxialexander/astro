import type { Command } from 'commander'
import { getClient } from '../client.js'
import { print, formatRelativeTime, formatStatus, type ColumnDef } from '../output.js'
import chalk from 'chalk'

const nodeColumns: ColumnDef[] = [
  { key: 'id', label: 'ID', width: 20 },
  { key: 'title', label: 'TITLE', width: 40 },
  { key: 'type', label: 'TYPE', width: 10 },
  { key: 'status', label: 'STATUS', width: 18, format: (v) => formatStatus(String(v ?? '')) },
  { key: 'startDate', label: 'START', width: 12, format: (v) => v ? String(v) : chalk.dim('\u2014') },
  { key: 'endDate', label: 'END', width: 12, format: (v) => v ? String(v) : chalk.dim('\u2014') },
]

// ── Tree rendering helpers ────────────────────────────────────────────

interface TreeNode {
  id: string
  title: string
  status: string
  type: string
  children: TreeNode[]
}

function buildTree(
  nodes: Array<{ id: string; title: string; status: string; type: string }>,
  edges: Array<{ source: string; target: string }>
): TreeNode[] {
  const adj = new Map<string, string[]>()
  const hasParent = new Set<string>()

  for (const edge of edges) {
    const children = adj.get(edge.source) ?? []
    children.push(edge.target)
    adj.set(edge.source, children)
    hasParent.add(edge.target)
  }

  const lookup = new Map<string, { id: string; title: string; status: string; type: string }>()
  for (const node of nodes) {
    lookup.set(node.id, node)
  }

  function buildSubtree(nodeId: string): TreeNode | null {
    const node = lookup.get(nodeId)
    if (!node) return null
    const childIds = adj.get(nodeId) ?? []
    const children: TreeNode[] = []
    for (const childId of childIds) {
      const child = buildSubtree(childId)
      if (child) children.push(child)
    }
    return { ...node, children }
  }

  const roots: TreeNode[] = []
  for (const node of nodes) {
    if (!hasParent.has(node.id)) {
      const tree = buildSubtree(node.id)
      if (tree) roots.push(tree)
    }
  }

  return roots
}

function renderTreeLines(roots: TreeNode[]): string[] {
  const lines: string[] = []

  function walk(node: TreeNode, prefix: string, isLast: boolean) {
    const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 '
    const statusStr = formatStatus(node.status)
    const typeTag = chalk.dim(`[${node.type}]`)
    lines.push(`${prefix}${connector}${chalk.bold(node.id)}: ${node.title} ${typeTag} ${statusStr}`)

    const childPrefix = prefix + (isLast ? '    ' : '\u2502   ')
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i], childPrefix, i === node.children.length - 1)
    }
  }

  for (let i = 0; i < roots.length; i++) {
    walk(roots[i], '', i === roots.length - 1)
  }

  return lines
}

// ── Command registration ──────────────────────────────────────────────

export function registerPlanCommands(program: Command): void {
  const plan = program.command('plan').description('Manage plans')

  // ── plan list ─────────────────────────────────────────────────────
  plan
    .command('list')
    .description('List plan nodes for a project')
    .requiredOption('--project-id <id>', 'Project ID')
    .action(async (cmdOpts: { projectId: string }) => {
      const opts = program.opts()
      const client = getClient(opts.serverUrl)

      try {
        const { nodes } = await client.getPlan(cmdOpts.projectId)
        print(nodes, { json: opts.json, columns: nodeColumns })
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exitCode = 1
      }
    })

  // ── plan show <nodeId> ────────────────────────────────────────────
  plan
    .command('show <nodeId>')
    .description('Show plan node details')
    .option('--project-id <id>', 'Project ID (narrows search)')
    .action(async (nodeId: string, cmdOpts: { projectId?: string }) => {
      const opts = program.opts()
      const client = getClient(opts.serverUrl)

      let nodes
      try {
        const result = cmdOpts.projectId
          ? await client.getPlan(cmdOpts.projectId)
          : await client.getFullPlan()
        nodes = result.nodes
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exitCode = 1
        return
      }

      const node = nodes.find(n => n.id === nodeId)

      if (!node) {
        console.error(chalk.red(`No plan node found with ID "${nodeId}"`))
        process.exitCode = 1
        return
      }

      if (opts.json) {
        print(node, { json: true })
        return
      }

      const fields: [string, unknown][] = [
        ['ID', node.id],
        ['Title', node.title],
        ['Type', node.type],
        ['Status', formatStatus(node.status)],
        ['Description', node.description || chalk.dim('\u2014')],
        ['Project ID', node.projectId],
        ['Parent ID', node.parentId || chalk.dim('\u2014')],
        ['Priority', node.priority || chalk.dim('\u2014')],
        ['Estimate', node.estimate || chalk.dim('\u2014')],
        ['Start Date', node.startDate || chalk.dim('\u2014')],
        ['End Date', node.endDate || chalk.dim('\u2014')],
        ['Due Date', node.dueDate || chalk.dim('\u2014')],
        ['Milestone ID', (node as Record<string, unknown>).milestoneId || chalk.dim('\u2014')],
        ['Verification', (node as Record<string, unknown>).verification ?? chalk.dim('\u2014')],
        ['Branch Name', node.branchName || chalk.dim('\u2014')],
        ['PR URL', node.prUrl || chalk.dim('\u2014')],
        ['Execution ID', node.executionId || chalk.dim('\u2014')],
        ['Execution Started', node.executionStartedAt ? formatRelativeTime(node.executionStartedAt) : chalk.dim('\u2014')],
        ['Execution Completed', node.executionCompletedAt ? formatRelativeTime(node.executionCompletedAt) : chalk.dim('\u2014')],
        ['Created', formatRelativeTime(node.createdAt)],
        ['Updated', formatRelativeTime(node.updatedAt)],
      ]

      const maxKeyLen = Math.max(...fields.map(([k]) => k.length))
      for (const [key, value] of fields) {
        console.log(`  ${chalk.bold(key.padEnd(maxKeyLen))}  ${value}`)
      }

      if (node.executionOutput) {
        console.log()
        console.log(chalk.bold('  Execution Output:'))
        const output = node.executionOutput.slice(0, 500)
        console.log(`  ${output}${node.executionOutput.length > 500 ? '...' : ''}`)
      }

      if (node.executionError) {
        console.log()
        console.log(chalk.bold.red('  Execution Error:'))
        console.log(`  ${node.executionError}`)
      }
    })

  // ── plan tree ─────────────────────────────────────────────────────
  plan
    .command('tree')
    .description('Show ASCII dependency tree for a project')
    .requiredOption('--project-id <id>', 'Project ID')
    .action(async (cmdOpts: { projectId: string }) => {
      const opts = program.opts()
      const client = getClient(opts.serverUrl)

      let nodes, edges
      try {
        const result = await client.getPlan(cmdOpts.projectId)
        nodes = result.nodes
        edges = result.edges
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exitCode = 1
        return
      }

      if (nodes.length === 0) {
        console.log(chalk.dim('  No plan nodes found.'))
        return
      }

      if (opts.json) {
        const tree = buildTree(nodes, edges)
        print(tree, { json: true })
        return
      }

      const tree = buildTree(nodes, edges)
      const lines = renderTreeLines(tree)

      if (lines.length === 0) {
        console.log(chalk.dim('  No plan nodes found.'))
        return
      }

      console.log()
      console.log(chalk.bold(`  Plan tree (${nodes.length} nodes, ${edges.length} edges):`))
      console.log()
      for (const line of lines) {
        console.log(`  ${line}`)
      }
      console.log()
    })

  // ── plan create-node ──────────────────────────────────────────────
  plan
    .command('create-node')
    .description('Create a new plan node')
    .requiredOption('--project-id <id>', 'Project ID')
    .requiredOption('--title <title>', 'Node title')
    .option('--type <type>', 'Node type: task, milestone, decision', 'task')
    .option('--description <desc>', 'Node description')
    .option('--status <status>', 'Initial status', 'planned')
    .option('--parent-id <id>', 'Parent node ID')
    .option('--priority <priority>', 'Priority: critical, high, normal, low')
    .action(async (cmdOpts: {
      projectId: string
      title: string
      type: string
      description?: string
      status: string
      parentId?: string
      priority?: string
    }) => {
      const opts = program.opts()
      const client = getClient(opts.serverUrl)

      // Generate a client ID
      const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      try {
        await client.createPlanNode({
          id,
          projectId: cmdOpts.projectId,
          title: cmdOpts.title,
          type: cmdOpts.type,
          description: cmdOpts.description,
          status: cmdOpts.status,
          parentId: cmdOpts.parentId ?? null,
          priority: cmdOpts.priority ?? null,
        })

        if (opts.json) {
          print({ ok: true, id, projectId: cmdOpts.projectId, title: cmdOpts.title }, { json: true })
        } else {
          console.log(chalk.green('Node created:'))
          console.log(`  ${chalk.bold('ID')}     ${id}`)
          console.log(`  ${chalk.bold('Title')}  ${cmdOpts.title}`)
          console.log(`  ${chalk.bold('Type')}   ${cmdOpts.type}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (opts.json) {
          print({ error: msg }, { json: true })
        } else {
          console.error(chalk.red(`Create failed: ${msg}`))
        }
        process.exitCode = 1
      }
    })

  // ── plan update-node ──────────────────────────────────────────────
  plan
    .command('update-node <nodeId>')
    .description('Update a plan node')
    .option('--title <title>', 'New title')
    .option('--status <status>', 'New status')
    .option('--description <desc>', 'New description')
    .option('--priority <priority>', 'New priority: critical, high, normal, low')
    .option('--type <type>', 'New type: task, milestone, decision')
    .action(async (nodeId: string, cmdOpts: {
      title?: string
      status?: string
      description?: string
      priority?: string
      type?: string
    }) => {
      const opts = program.opts()
      const client = getClient(opts.serverUrl)

      const patch: Record<string, unknown> = {}
      if (cmdOpts.title !== undefined) patch.title = cmdOpts.title
      if (cmdOpts.status !== undefined) patch.status = cmdOpts.status
      if (cmdOpts.description !== undefined) patch.description = cmdOpts.description
      if (cmdOpts.priority !== undefined) patch.priority = cmdOpts.priority
      if (cmdOpts.type !== undefined) patch.type = cmdOpts.type

      if (Object.keys(patch).length === 0) {
        console.error(chalk.red('No update fields provided. Use --title, --status, --description, --priority, or --type.'))
        process.exitCode = 1
        return
      }

      try {
        const result = await client.updatePlanNode(nodeId, patch)

        if (opts.json) {
          print({ ...result, nodeId, updated: Object.keys(patch) }, { json: true })
        } else {
          console.log(chalk.green(`Node ${nodeId} updated: ${Object.keys(patch).join(', ')}`))
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

  // ── plan delete-node ──────────────────────────────────────────────
  plan
    .command('delete-node <nodeId>')
    .description('Delete a plan node')
    .action(async (nodeId: string) => {
      const opts = program.opts()
      const client = getClient(opts.serverUrl)

      try {
        const result = await client.deletePlanNode(nodeId)

        if (opts.json) {
          print({ ...result, nodeId }, { json: true })
        } else {
          console.log(chalk.green(`Node ${nodeId} deleted.`))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (opts.json) {
          print({ error: msg }, { json: true })
        } else {
          console.error(chalk.red(`Delete failed: ${msg}`))
        }
        process.exitCode = 1
      }
    })

  // ── plan stats ────────────────────────────────────────────────────
  plan
    .command('stats')
    .description('Show plan statistics for a project')
    .requiredOption('--project-id <id>', 'Project ID')
    .action(async (cmdOpts: { projectId: string }) => {
      const opts = program.opts()
      const client = getClient(opts.serverUrl)

      try {
        const { nodes, edges } = await client.getPlan(cmdOpts.projectId)
        const active = nodes.filter(n => !n.deletedAt)

        // Status counts
        const statusCounts: Record<string, number> = {}
        for (const n of active) {
          statusCounts[n.status] = (statusCounts[n.status] || 0) + 1
        }

        // Execution coverage
        const withExecution = active.filter(n => n.executionId).length

        // Date range
        const dates = active
          .flatMap(n => [n.startDate, n.endDate].filter(Boolean) as string[])
          .map(d => new Date(d).getTime())
          .filter(d => !isNaN(d))
        const minDate = dates.length > 0 ? new Date(Math.min(...dates)).toISOString().split('T')[0] : null
        const maxDate = dates.length > 0 ? new Date(Math.max(...dates)).toISOString().split('T')[0] : null

        const stats = {
          totalNodes: active.length,
          totalEdges: edges.length,
          statusCounts,
          executionCoverage: active.length > 0 ? `${withExecution}/${active.length} (${Math.round(withExecution / active.length * 100)}%)` : '0/0',
          dateRange: minDate && maxDate ? `${minDate} \u2192 ${maxDate}` : '\u2014',
        }

        if (opts.json) {
          print(stats, { json: true })
          return
        }

        console.log()
        console.log(chalk.bold('  Plan Statistics'))
        console.log(chalk.dim('  ' + '\u2500'.repeat(40)))
        console.log(`  ${chalk.dim('Total Nodes:')}       ${stats.totalNodes}`)
        console.log(`  ${chalk.dim('Total Edges:')}       ${stats.totalEdges}`)
        console.log(`  ${chalk.dim('Execution Coverage:')} ${stats.executionCoverage}`)
        console.log(`  ${chalk.dim('Date Range:')}        ${stats.dateRange}`)
        console.log()
        console.log(chalk.bold('  Status Breakdown'))
        for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
          console.log(`    ${formatStatus(status).padEnd(25)} ${count}`)
        }
        console.log()
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exitCode = 1
      }
    })

  // ── plan export ───────────────────────────────────────────────────
  plan
    .command('export')
    .description('Export plan in various formats')
    .requiredOption('--project-id <id>', 'Project ID')
    .option('--format <fmt>', 'Output format: json, dot, mermaid', 'json')
    .action(async (cmdOpts: { projectId: string; format: string }) => {
      const opts = program.opts()
      const client = getClient(opts.serverUrl)

      let nodes, edges
      try {
        const result = await client.getPlan(cmdOpts.projectId)
        nodes = result.nodes.filter(n => !n.deletedAt)
        edges = result.edges
      } catch (err) {
        console.error(chalk.red((err as Error).message))
        process.exitCode = 1
        return
      }

      switch (cmdOpts.format) {
        case 'json':
          console.log(JSON.stringify({ nodes, edges }, null, 2))
          break

        case 'dot': {
          const lines = ['digraph plan {', '  rankdir=LR;', '  node [shape=box];']
          for (const n of nodes) {
            const label = n.title.replace(/"/g, '\\"')
            lines.push(`  "${n.id}" [label="${label}\\n[${n.status}]"];`)
          }
          for (const e of edges) {
            lines.push(`  "${e.source}" -> "${e.target}";`)
          }
          lines.push('}')
          console.log(lines.join('\n'))
          break
        }

        case 'mermaid': {
          const lines = ['graph LR']
          for (const n of nodes) {
            const label = n.title.replace(/"/g, "'")
            lines.push(`  ${n.id}["${label}<br/>${n.status}"]`)
          }
          for (const e of edges) {
            lines.push(`  ${e.source} --> ${e.target}`)
          }
          console.log(lines.join('\n'))
          break
        }

        default:
          console.error(chalk.red(`Unknown format "${cmdOpts.format}". Use json, dot, or mermaid.`))
          process.exitCode = 1
      }
    })
}

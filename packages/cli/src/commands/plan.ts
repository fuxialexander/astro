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
}

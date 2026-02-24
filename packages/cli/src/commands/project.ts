/**
 * Project management commands.
 *
 * Commands:
 *   project list              - List all projects
 *   project show <id>         - Show project details
 *   project create            - Create a new project
 *   project delete <id>       - Delete a project
 */

import { Command } from 'commander'
// Note: Using relative imports for workspace package runtime compatibility
// TypeScript paths in tsconfig.json map @astro/core/* for type-checking
import { db } from '../../../core/src/db/index.js'
import { projects, planNodes, planEdges, taskExecutions } from '../../../core/src/db/schema.js'
import { LOCAL_TEAM_ID, LOCAL_USER_ID } from '../../../core/src/db/bootstrap-local.js'
import { eq, desc, and, isNull } from 'drizzle-orm'
import { ensureDb } from '../db.js'
import {
  print,
  formatRelativeTime,
  formatStatus,
  truncate,
  printError,
  printSuccess,
  type ColumnDef,
} from '../output.js'

// Column definitions for project list
const projectListColumns: ColumnDef[] = [
  {
    key: 'id',
    label: 'ID',
    width: 10,
    format: (v) => truncate(String(v ?? ''), 10),
  },
  {
    key: 'name',
    label: 'NAME',
    width: 30,
    format: (v) => truncate(String(v ?? ''), 30),
  },
  {
    key: 'status',
    label: 'STATUS',
    width: 10,
    format: (v) => formatStatus(String(v ?? '')),
  },
  {
    key: 'workingDirectory',
    label: 'WORK DIR',
    width: 30,
    format: (v) => truncate(String(v ?? ''), 30),
  },
  {
    key: 'updatedAt',
    label: 'UPDATED',
    width: 15,
    format: (v) => formatRelativeTime(v as string | null),
  },
]

/**
 * List all projects.
 */
async function listProjects(options: { json?: boolean }): Promise<void> {
  await ensureDb()

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      workingDirectory: projects.workingDirectory,
      sourceDirectory: projects.sourceDirectory,
      repository: projects.repository,
      deliveryMode: projects.deliveryMode,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.teamId, LOCAL_TEAM_ID))
    .orderBy(desc(projects.updatedAt))

  print(rows, { json: options.json, columns: projectListColumns })
}

/**
 * Show details for a specific project.
 */
async function showProject(
  projectId: string,
  options: { json?: boolean }
): Promise<void> {
  await ensureDb()

  // Fetch project
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.teamId, LOCAL_TEAM_ID)
      )
    )

  if (!project) {
    printError(`Project not found: ${projectId}`)
    process.exit(1)
  }

  // Fetch node count
  const nodes = await db
    .select()
    .from(planNodes)
    .where(
      and(
        eq(planNodes.projectId, projectId),
        isNull(planNodes.deletedAt)
      )
    )
  const nodeCount = nodes.length

  // Fetch edge count
  const edges = await db
    .select()
    .from(planEdges)
    .where(
      and(
        eq(planEdges.projectId, projectId),
        isNull(planEdges.deletedAt)
      )
    )
  const edgeCount = edges.length

  // Fetch execution count
  const executions = await db
    .select()
    .from(taskExecutions)
    .where(eq(taskExecutions.projectId, projectId))
  const executionCount = executions.length

  const result = {
    ...project,
    stats: {
      nodes: nodeCount,
      edges: edgeCount,
      executions: executionCount,
    },
  }

  if (options.json) {
    print(result, { json: true })
  } else {
    // Pretty print for humans
    console.log('')
    console.log(`  ID:              ${project.id}`)
    console.log(`  Name:            ${project.name}`)
    console.log(`  Status:          ${formatStatus(project.status)}`)
    console.log(`  Description:     ${project.description || '(none)'}`)
    console.log(`  Working Dir:     ${project.workingDirectory || '(none)'}`)
    console.log(`  Source Dir:      ${project.sourceDirectory || '(none)'}`)
    console.log(`  Repository:      ${project.repository || '(none)'}`)
    console.log(`  Delivery Mode:   ${project.deliveryMode || '(default)'}`)
    console.log(`  Vision Doc:      ${project.visionDoc ? `${project.visionDoc.length} chars` : '(none)'}`)
    console.log('')
    console.log(`  Plan Nodes:      ${nodeCount}`)
    console.log(`  Plan Edges:      ${edgeCount}`)
    console.log(`  Executions:      ${executionCount}`)
    console.log('')
    console.log(`  Created:         ${formatRelativeTime(project.createdAt)}`)
    console.log(`  Updated:         ${formatRelativeTime(project.updatedAt)}`)
    console.log('')
  }
}

/**
 * Create a new project.
 */
async function createProject(options: {
  name: string
  description?: string
  dir?: string
  json?: boolean
}): Promise<void> {
  await ensureDb()

  const newProject = {
    name: options.name,
    description: options.description || '',
    workingDirectory: options.dir || null,
    ownerId: LOCAL_USER_ID,
    teamId: LOCAL_TEAM_ID,
    status: 'active' as const,
  }

  const [created] = await db
    .insert(projects)
    .values(newProject)
    .returning()

  if (options.json) {
    print(created, { json: true })
  } else {
    printSuccess(`Created project: ${created.name} (${created.id})`)
  }
}

/**
 * Delete a project and all associated data.
 */
async function deleteProject(
  projectId: string,
  options: { json?: boolean; force?: boolean }
): Promise<void> {
  await ensureDb()

  // Check project exists
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.teamId, LOCAL_TEAM_ID)
      )
    )

  if (!project) {
    printError(`Project not found: ${projectId}`)
    process.exit(1)
  }

  // Delete in order: executions, edges, nodes, project
  // (cascading deletes should handle this, but being explicit)
  await db.delete(taskExecutions).where(eq(taskExecutions.projectId, projectId))
  await db.delete(planEdges).where(eq(planEdges.projectId, projectId))
  await db.delete(planNodes).where(eq(planNodes.projectId, projectId))
  await db.delete(projects).where(eq(projects.id, projectId))

  if (options.json) {
    print({ deleted: true, id: projectId, name: project.name }, { json: true })
  } else {
    printSuccess(`Deleted project: ${project.name} (${projectId})`)
  }
}

/**
 * Create the project command with subcommands.
 */
export function createProjectCommand(): Command {
  const cmd = new Command('project')
    .description('Project management commands')

  cmd
    .command('list')
    .description('List all projects')
    .action(async function (this: Command) {
      const parentOpts = this.parent?.parent?.opts() ?? {}
      await listProjects({ json: parentOpts.json })
    })

  cmd
    .command('show <id>')
    .description('Show project details')
    .action(async function (this: Command, id: string) {
      const parentOpts = this.parent?.parent?.opts() ?? {}
      await showProject(id, { json: parentOpts.json })
    })

  cmd
    .command('create')
    .description('Create a new project')
    .requiredOption('-n, --name <name>', 'Project name')
    .option('-d, --description <description>', 'Project description')
    .option('--dir <path>', 'Working directory path')
    .action(async function (this: Command, options: { name: string; description?: string; dir?: string }) {
      const parentOpts = this.parent?.parent?.opts() ?? {}
      await createProject({ ...options, json: parentOpts.json })
    })

  cmd
    .command('delete <id>')
    .description('Delete a project and all associated data')
    .option('-f, --force', 'Skip confirmation')
    .action(async function (this: Command, id: string, options: { force?: boolean }) {
      const parentOpts = this.parent?.parent?.opts() ?? {}
      await deleteProject(id, { ...options, json: parentOpts.json })
    })

  return cmd
}

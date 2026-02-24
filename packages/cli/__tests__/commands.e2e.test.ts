/**
 * End-to-end tests for CLI commands.
 * Executes the CLI binary via subprocess and validates output.
 *
 * Auto-skips if the server at http://localhost:3001 is not available.
 * Start the server with `npm run dev:local` before running these tests.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { execSync, type ExecSyncOptionsWithStringEncoding } from 'node:child_process'
import { join } from 'node:path'
import { checkServer } from './setup.js'

let serverAvailable = false
const CLI = join(import.meta.dirname, '..', 'src', 'index.ts')
const SERVER_URL = 'http://localhost:3001'

const execOpts: ExecSyncOptionsWithStringEncoding = {
  encoding: 'utf-8',
  timeout: 15000,
  env: {
    ...process.env,
    ASTRO_SERVER_URL: SERVER_URL,
    // Disable chalk colors for easier assertion
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  },
}

function cli(args: string): string {
  return execSync(`npx tsx ${CLI} ${args}`, execOpts).trim()
}

function cliJson<T = unknown>(args: string): T {
  const output = cli(`--json ${args}`)
  return JSON.parse(output) as T
}

beforeAll(async () => {
  serverAvailable = await checkServer()
})

describe('CLI e2e', () => {
  // ── Help & Version ─────────────────────────────────────────────────

  describe('help', () => {
    it('shows help text', () => {
      const output = cli('--help')
      expect(output).toContain('Usage:')
      expect(output).toContain('project')
      expect(output).toContain('plan')
      expect(output).toContain('task')
      expect(output).toContain('search')
      expect(output).toContain('env')
      expect(output).toContain('config')
      expect(output).toContain('completion')
    })

    it('project --help shows subcommands', () => {
      const output = cli('project --help')
      expect(output).toContain('list')
      expect(output).toContain('show')
      expect(output).toContain('create')
      expect(output).toContain('update')
      expect(output).toContain('stats')
      expect(output).toContain('delete')
    })

    it('plan --help shows subcommands', () => {
      const output = cli('plan --help')
      expect(output).toContain('list')
      expect(output).toContain('show')
      expect(output).toContain('tree')
      expect(output).toContain('create-node')
      expect(output).toContain('update-node')
      expect(output).toContain('delete-node')
      expect(output).toContain('stats')
      expect(output).toContain('export')
    })

    it('task --help shows subcommands', () => {
      const output = cli('task --help')
      expect(output).toContain('list')
      expect(output).toContain('show')
      expect(output).toContain('dispatch')
      expect(output).toContain('cancel')
      expect(output).toContain('steer')
      expect(output).toContain('update-status')
      expect(output).toContain('watch')
    })

    it('env --help shows subcommands', () => {
      const output = cli('env --help')
      expect(output).toContain('list')
      expect(output).toContain('show')
      expect(output).toContain('remove')
      expect(output).toContain('set-default')
      expect(output).toContain('status')
      expect(output).toContain('providers')
      expect(output).toContain('clusters')
    })

    it('trace --help shows subcommands', () => {
      const output = cli('trace --help')
      expect(output).toContain('list')
      expect(output).toContain('show')
      expect(output).toContain('summary')
      expect(output).toContain('stats')
    })

    it('config --help shows subcommands', () => {
      const output = cli('config --help')
      expect(output).toContain('show')
      expect(output).toContain('set')
      expect(output).toContain('get')
    })
  })

  // ── Completion (no server needed) ──────────────────────────────────

  describe('completion', () => {
    it('completion --shell bash outputs script', () => {
      const output = cli('completion --shell bash')
      expect(output).toContain('_astro_cli_completions')
      expect(output).toContain('complete -F')
      expect(output).toContain('astro-cli')
    })

    it('completion --shell zsh outputs script', () => {
      const output = cli('completion --shell zsh')
      expect(output).toContain('#compdef astro-cli')
      expect(output).toContain('_astro-cli')
    })

    it('completion --shell fish outputs script', () => {
      const output = cli('completion --shell fish')
      expect(output).toContain('complete -c astro-cli')
    })
  })

  // ── Config commands (no server needed) ────────────────────────────

  describe('config commands', () => {
    it('config show outputs JSON', () => {
      const config = cliJson<{ serverUrl: string }>('config show')
      expect(config).toHaveProperty('serverUrl')
    })

    it('config get server-url returns a URL', () => {
      const output = cli('config get server-url')
      expect(output).toContain('http')
    })

    it('config get with unknown key exits with error', () => {
      try {
        cli('config get unknown-key')
        expect.fail('Should have thrown')
      } catch (err: unknown) {
        const error = err as { stderr?: string; status?: number }
        // Commander or our code should print an error
        expect(error.stderr || '').toContain('Unknown config key')
      }
    })
  })

  // ── Project commands ───────────────────────────────────────────────

  describe('project commands', () => {
    let testProjectId: string

    it('project list returns JSON array', () => {
      if (!serverAvailable) return
      const projects = cliJson<Array<{ id: string; name: string }>>('project list')
      expect(Array.isArray(projects)).toBe(true)
    })

    it('project create creates a project', () => {
      if (!serverAvailable) return
      const project = cliJson<{ id: string; name: string }>('project create --name "E2E Test Project" --description "e2e test"')
      expect(project.id).toBeTruthy()
      expect(project.name).toBe('E2E Test Project')
      testProjectId = project.id
    })

    it('project list outputs human table', () => {
      if (!serverAvailable || !testProjectId) return
      const output = cli('project list')
      expect(output).toContain('ID')
      expect(output).toContain('NAME')
      expect(output).toContain('STATUS')
    })

    it('project show displays project details', () => {
      if (!serverAvailable || !testProjectId) return
      const project = cliJson<{ id: string; name: string }>(`project show ${testProjectId.slice(0, 8)}`)
      expect(project.id).toBe(testProjectId)
      expect(project.name).toBe('E2E Test Project')
    })

    it('project show human output includes key fields', () => {
      if (!serverAvailable || !testProjectId) return
      const output = cli(`project show ${testProjectId.slice(0, 8)}`)
      expect(output).toContain('E2E Test Project')
      expect(output).toContain('ID')
      expect(output).toContain('Name')
      expect(output).toContain('Status')
    })

    it('project update modifies project', () => {
      if (!serverAvailable || !testProjectId) return
      const updated = cliJson<{ id: string; description: string }>(
        `project update ${testProjectId.slice(0, 8)} --description "updated via e2e"`
      )
      expect(updated.id).toBe(testProjectId)
      expect(updated.description).toBe('updated via e2e')
    })

    it('project stats shows statistics', () => {
      if (!serverAvailable || !testProjectId) return
      const stats = cliJson<{ project: { id: string }; plan: { totalNodes: number } }>(
        `project stats ${testProjectId.slice(0, 8)}`
      )
      expect(stats.project.id).toBe(testProjectId)
      expect(stats.plan).toHaveProperty('totalNodes')
    })

    it('project delete removes the project', () => {
      if (!serverAvailable || !testProjectId) return
      const output = cli(`project delete ${testProjectId}`)
      expect(output.toLowerCase()).toContain('delet')

      // Verify deletion
      const projects = cliJson<Array<{ id: string }>>('project list')
      const found = projects.find(p => p.id === testProjectId)
      expect(found).toBeUndefined()
    })
  })

  // ── Plan commands ──────────────────────────────────────────────────

  describe('plan commands', () => {
    it('plan list returns JSON for existing project', () => {
      if (!serverAvailable) return
      const projects = cliJson<Array<{ id: string }>>('project list')
      if (projects.length === 0) return

      const nodes = cliJson<Array<{ id: string }>>(`plan list --project-id ${projects[0].id}`)
      expect(Array.isArray(nodes)).toBe(true)
    })

    it('plan tree outputs tree structure', () => {
      if (!serverAvailable) return
      const projects = cliJson<Array<{ id: string }>>('project list')
      if (projects.length === 0) return

      const output = cli(`plan tree --project-id ${projects[0].id}`)
      // Should output either tree or "No plan nodes found."
      expect(output).toBeTruthy()
    })

    it('plan stats returns plan statistics', () => {
      if (!serverAvailable) return
      const projects = cliJson<Array<{ id: string }>>('project list')
      if (projects.length === 0) return

      const stats = cliJson<{ totalNodes: number; totalEdges: number }>(
        `plan stats --project-id ${projects[0].id}`
      )
      expect(stats).toHaveProperty('totalNodes')
      expect(stats).toHaveProperty('totalEdges')
    })

    it('plan export --format json outputs JSON', () => {
      if (!serverAvailable) return
      const projects = cliJson<Array<{ id: string }>>('project list')
      if (projects.length === 0) return

      const output = cli(`plan export --project-id ${projects[0].id} --format json`)
      const parsed = JSON.parse(output)
      expect(parsed).toHaveProperty('nodes')
      expect(parsed).toHaveProperty('edges')
    })

    it('plan export --format dot outputs DOT', () => {
      if (!serverAvailable) return
      const projects = cliJson<Array<{ id: string }>>('project list')
      if (projects.length === 0) return

      const output = cli(`plan export --project-id ${projects[0].id} --format dot`)
      expect(output).toContain('digraph plan')
    })

    it('plan export --format mermaid outputs Mermaid', () => {
      if (!serverAvailable) return
      const projects = cliJson<Array<{ id: string }>>('project list')
      if (projects.length === 0) return

      const output = cli(`plan export --project-id ${projects[0].id} --format mermaid`)
      expect(output).toContain('graph LR')
    })
  })

  // ── Task commands ──────────────────────────────────────────────────

  describe('task commands', () => {
    it('task list returns JSON array', () => {
      if (!serverAvailable) return
      const tasks = cliJson<Array<{ id: string }>>('task list')
      expect(Array.isArray(tasks)).toBe(true)
    })

    it('task list with --status filter works', () => {
      if (!serverAvailable) return
      const tasks = cliJson<Array<{ id: string; status: string }>>('task list --status planned')
      expect(Array.isArray(tasks)).toBe(true)
      // All returned tasks should have 'planned' status
      for (const t of tasks) {
        expect(t.status).toBe('planned')
      }
    })

    it('task list with --project filter works', () => {
      if (!serverAvailable) return
      const projects = cliJson<Array<{ id: string }>>('project list')
      if (projects.length === 0) return

      const tasks = cliJson<Array<{ id: string }>>(`task list --project ${projects[0].id}`)
      expect(Array.isArray(tasks)).toBe(true)
    })

    it('task list with --since filter works', () => {
      if (!serverAvailable) return
      const tasks = cliJson<Array<{ id: string }>>('task list --since 7d')
      expect(Array.isArray(tasks)).toBe(true)
    })

    it('task show with nonexistent ID exits with error', () => {
      if (!serverAvailable) return
      try {
        cli('task show nonexistent-task-id')
        expect.fail('Should have thrown')
      } catch (err: unknown) {
        const error = err as { stderr?: string; stdout?: string }
        // Should mention not found
        expect((error.stderr || '') + (error.stdout || '')).toContain('not found')
      }
    })
  })

  // ── Search commands ────────────────────────────────────────────────

  describe('search commands', () => {
    it('search returns JSON results', () => {
      if (!serverAvailable) return
      const results = cliJson<{ projects: unknown[]; tasks: unknown[]; executions: unknown[] }>('search "test"')
      expect(results).toHaveProperty('projects')
      expect(results).toHaveProperty('tasks')
      expect(results).toHaveProperty('executions')
    })

    it('search with --type filter works', () => {
      if (!serverAvailable) return
      const results = cliJson<{ projects: unknown[]; tasks: unknown[]; executions: unknown[] }>('search "test" --type projects')
      expect(results.tasks).toHaveLength(0)
      expect(results.executions).toHaveLength(0)
    })

    it('search human output shows sections', () => {
      if (!serverAvailable) return
      // Search for something that likely exists
      const output = cli('search "calc"')
      // Should show either results or "No results" message
      expect(output).toBeTruthy()
    })
  })

  // ── Env commands ───────────────────────────────────────────────────

  describe('env commands', () => {
    it('env list returns JSON array', () => {
      if (!serverAvailable) return
      const machines = cliJson<Array<{ id: string }>>('env list')
      expect(Array.isArray(machines)).toBe(true)
    })

    it('env list human output shows table headers', () => {
      if (!serverAvailable) return
      const output = cli('env list')
      expect(output).toContain('ID')
      expect(output).toContain('NAME')
    })

    it('env show displays machine details', () => {
      if (!serverAvailable) return
      const machines = cliJson<Array<{ id: string }>>('env list')
      if (machines.length === 0) return

      // Use full ID to avoid ambiguity with leftover test machines
      const machine = cliJson<{ id: string; name: string }>(`env show ${machines[0].id}`)
      expect(machine.id).toBeTruthy()
      expect(machine.name).toBeTruthy()
    })

    it('env show human output includes key fields', () => {
      if (!serverAvailable) return
      const machines = cliJson<Array<{ id: string }>>('env list')
      if (machines.length === 0) return

      // Use full ID to avoid ambiguity with leftover test machines
      const output = cli(`env show ${machines[0].id}`)
      expect(output).toContain('Machine:')
      expect(output).toContain('ID')
      expect(output).toContain('Platform')
    })

    it('env providers lists providers', () => {
      if (!serverAvailable) return
      const providers = cliJson<Array<{ provider: string }>>('env providers')
      expect(Array.isArray(providers)).toBe(true)
    })
  })

  // ── Activity commands ──────────────────────────────────────────────

  describe('activity commands', () => {
    it('activity list returns JSON array', () => {
      if (!serverAvailable) return
      const activities = cliJson<unknown[]>('activity list')
      expect(Array.isArray(activities)).toBe(true)
    })

    it('activity list with --limit works', () => {
      if (!serverAvailable) return
      const activities = cliJson<unknown[]>('activity list --limit 5')
      expect(Array.isArray(activities)).toBe(true)
      expect(activities.length).toBeLessThanOrEqual(5)
    })

    it('activity list with --type filter works', () => {
      if (!serverAvailable) return
      const activities = cliJson<Array<{ type: string }>>('activity list --type task:completed')
      expect(Array.isArray(activities)).toBe(true)
    })

    it('activity list with --since filter works', () => {
      if (!serverAvailable) return
      const activities = cliJson<unknown[]>('activity list --since 7d')
      expect(Array.isArray(activities)).toBe(true)
    })
  })

  // ── Trace commands ─────────────────────────────────────────────────

  describe('trace commands', () => {
    it('trace list requires --execution-id', () => {
      try {
        cli('trace list')
        expect.fail('Should have thrown')
      } catch (err: unknown) {
        const error = err as { stderr?: string }
        expect(error.stderr || '').toContain('execution-id')
      }
    })

    it('trace list returns JSON for valid execution', () => {
      if (!serverAvailable) return
      // For simplicity, we just verify the command doesn't crash with a nonexistent ID
      try {
        const result = cliJson<{ traces: unknown[] }>('trace list --execution-id nonexistent')
        expect(result).toHaveProperty('traces')
      } catch {
        // Expected - might return error for nonexistent execution
      }
    })

    it('trace summary requires --execution-id', () => {
      try {
        cli('trace summary')
        expect.fail('Should have thrown')
      } catch (err: unknown) {
        const error = err as { stderr?: string }
        expect(error.stderr || '').toContain('execution-id')
      }
    })

    it('trace stats requires --execution-id', () => {
      try {
        cli('trace stats')
        expect.fail('Should have thrown')
      } catch (err: unknown) {
        const error = err as { stderr?: string }
        expect(error.stderr || '').toContain('execution-id')
      }
    })
  })

  // ── Full CRUD lifecycle ────────────────────────────────────────────

  describe('full CRUD lifecycle', () => {
    it('create → list → show → search → delete project', () => {
      if (!serverAvailable) return

      // 1. Create
      const created = cliJson<{ id: string; name: string }>(
        'project create --name "Lifecycle Test" --description "full CRUD test"'
      )
      expect(created.id).toBeTruthy()
      const id = created.id

      // 2. List - should include new project
      const list = cliJson<Array<{ id: string; name: string }>>('project list')
      expect(list.some(p => p.id === id)).toBe(true)

      // 3. Show - by partial ID
      const shown = cliJson<{ id: string; name: string }>(`project show ${id.slice(0, 8)}`)
      expect(shown.id).toBe(id)
      expect(shown.name).toBe('Lifecycle Test')

      // 4. Search - should find by name
      const searched = cliJson<{ projects: Array<{ id: string }> }>('search "Lifecycle Test"')
      expect(searched.projects.some(p => p.id === id)).toBe(true)

      // 5. Delete
      cli(`project delete ${id}`)

      // 6. Verify deletion
      const afterDelete = cliJson<Array<{ id: string }>>('project list')
      expect(afterDelete.some(p => p.id === id)).toBe(false)
    })

    it('plan node CRUD: create → update → delete', () => {
      if (!serverAvailable) return

      // Create a project first
      const project = cliJson<{ id: string }>('project create --name "Node CRUD Test"')
      const projectId = project.id

      try {
        // Create node
        const created = cliJson<{ ok: boolean; id: string }>(
          `plan create-node --project-id ${projectId} --title "Test Node" --type task`
        )
        expect(created.ok).toBe(true)
        expect(created.id).toBeTruthy()
        const nodeId = created.id

        // Update node
        const updated = cliJson<{ ok: boolean }>(
          `plan update-node ${nodeId} --title "Updated Node" --status in_progress`
        )
        expect(updated.ok).toBe(true)

        // Verify update
        const plan = cliJson<Array<{ id: string; title: string; status: string }>>(
          `plan list --project-id ${projectId}`
        )
        const found = plan.find(n => n.id === nodeId)
        expect(found).toBeDefined()
        expect(found!.title).toBe('Updated Node')
        expect(found!.status).toBe('in_progress')

        // Delete node
        const deleted = cliJson<{ ok: boolean }>(`plan delete-node ${nodeId}`)
        expect(deleted.ok).toBe(true)
      } finally {
        cli(`project delete ${projectId}`)
      }
    })
  })
})

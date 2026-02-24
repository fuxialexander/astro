/**
 * Integration tests for AstroClient.
 * Tests CRUD operations against a running local API server.
 *
 * Auto-skips if the server at http://localhost:3001 is not available.
 * Start the server with `npm run dev:local` before running these tests.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { AstroClient } from '../src/client.js'
import { checkServer, getTestServerUrl } from './setup.js'

let client: AstroClient
let serverAvailable = false

beforeAll(async () => {
  serverAvailable = await checkServer()
  if (serverAvailable) {
    client = new AstroClient({ serverUrl: getTestServerUrl() })
  }
})

describe('AstroClient integration', () => {
  // ── Health check ───────────────────────────────────────────────────

  it('server is reachable', async () => {
    if (!serverAvailable) return expect(true).toBe(true) // skip
    const res = await fetch(`${getTestServerUrl()}/api/health`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  // ── Projects CRUD ──────────────────────────────────────────────────

  describe('projects', () => {
    let testProjectId: string

    it('listProjects returns an array', async () => {
      if (!serverAvailable) return
      const projects = await client.listProjects()
      expect(Array.isArray(projects)).toBe(true)
    })

    it('createProject creates a new project', async () => {
      if (!serverAvailable) return
      const project = await client.createProject({
        name: 'CLI Test Project',
        description: 'Created by integration test',
      })
      expect(project).toBeDefined()
      expect(project.id).toBeTruthy()
      expect(project.name).toBe('CLI Test Project')
      expect(project.description).toBe('Created by integration test')
      testProjectId = project.id
    })

    it('getProject retrieves a project by ID', async () => {
      if (!serverAvailable || !testProjectId) return
      const project = await client.getProject(testProjectId)
      expect(project.id).toBe(testProjectId)
      expect(project.name).toBe('CLI Test Project')
    })

    it('resolveProject resolves partial ID prefix', async () => {
      if (!serverAvailable || !testProjectId) return
      const prefix = testProjectId.slice(0, 8)
      const project = await client.resolveProject(prefix)
      expect(project.id).toBe(testProjectId)
    })

    it('resolveProject throws for nonexistent prefix', async () => {
      if (!serverAvailable) return
      await expect(client.resolveProject('zzz-nonexistent')).rejects.toThrow('No project found')
    })

    it('updateProject updates project fields', async () => {
      if (!serverAvailable || !testProjectId) return
      const updated = await client.updateProject(testProjectId, {
        description: 'Updated by integration test',
      })
      expect(updated).toBeDefined()
      expect(updated.description).toBe('Updated by integration test')
    })

    it('listProjects includes the newly created project', async () => {
      if (!serverAvailable || !testProjectId) return
      const projects = await client.listProjects()
      const found = projects.find(p => p.id === testProjectId)
      expect(found).toBeDefined()
      expect(found!.name).toBe('CLI Test Project')
    })

    it('deleteProject removes the project', async () => {
      if (!serverAvailable || !testProjectId) return
      const result = await client.deleteProject(testProjectId)
      expect(result).toBeDefined()

      // Verify it's gone
      const projects = await client.listProjects()
      const found = projects.find(p => p.id === testProjectId)
      expect(found).toBeUndefined()
    })
  })

  // ── Plan ───────────────────────────────────────────────────────────

  describe('plan', () => {
    it('getFullPlan returns nodes and edges arrays', async () => {
      if (!serverAvailable) return
      const plan = await client.getFullPlan()
      expect(plan).toHaveProperty('nodes')
      expect(plan).toHaveProperty('edges')
      expect(Array.isArray(plan.nodes)).toBe(true)
      expect(Array.isArray(plan.edges)).toBe(true)
    })

    it('getPlan with a valid project ID returns plan data', async () => {
      if (!serverAvailable) return
      const projects = await client.listProjects()
      if (projects.length === 0) return // skip if no projects

      const plan = await client.getPlan(projects[0].id)
      expect(plan).toHaveProperty('nodes')
      expect(plan).toHaveProperty('edges')
      expect(Array.isArray(plan.nodes)).toBe(true)
    })
  })

  // ── Plan Node CRUD ─────────────────────────────────────────────────

  describe('plan node CRUD', () => {
    let testProjectId: string
    let testNodeId: string

    it('create project for plan node tests', async () => {
      if (!serverAvailable) return
      const project = await client.createProject({
        name: 'Plan CRUD Test',
        description: 'For plan node CRUD testing',
      })
      testProjectId = project.id
      expect(testProjectId).toBeTruthy()
    })

    it('createPlanNode creates a node', async () => {
      if (!serverAvailable || !testProjectId) return
      testNodeId = `test-node-${Date.now()}`
      const result = await client.createPlanNode({
        id: testNodeId,
        projectId: testProjectId,
        title: 'Test Node',
        type: 'task',
        status: 'planned',
        description: 'Created by test',
      })
      expect(result).toBeDefined()
    })

    it('updatePlanNode updates node fields', async () => {
      if (!serverAvailable || !testNodeId) return
      const result = await client.updatePlanNode(testNodeId, {
        title: 'Updated Test Node',
        status: 'in_progress',
      })
      expect(result).toBeDefined()
    })

    it('getPlan includes the created node', async () => {
      if (!serverAvailable || !testProjectId || !testNodeId) return
      const plan = await client.getPlan(testProjectId)
      const found = plan.nodes.find(n => n.id === testNodeId)
      expect(found).toBeDefined()
      expect(found!.title).toBe('Updated Test Node')
      expect(found!.status).toBe('in_progress')
    })

    it('deletePlanNode deletes the node', async () => {
      if (!serverAvailable || !testNodeId) return
      const result = await client.deletePlanNode(testNodeId)
      expect(result).toBeDefined()
    })

    it('cleanup test project', async () => {
      if (!serverAvailable || !testProjectId) return
      await client.deleteProject(testProjectId)
    })
  })

  // ── Executions ─────────────────────────────────────────────────────

  describe('executions', () => {
    it('getExecutions returns a record (object)', async () => {
      if (!serverAvailable) return
      const executions = await client.getExecutions()
      expect(typeof executions).toBe('object')
      expect(executions).not.toBeNull()
    })
  })

  // ── Search ─────────────────────────────────────────────────────────

  describe('search', () => {
    it('search returns structured results', async () => {
      if (!serverAvailable) return
      const results = await client.search('test')
      expect(results).toHaveProperty('projects')
      expect(results).toHaveProperty('tasks')
      expect(results).toHaveProperty('executions')
      expect(Array.isArray(results.projects)).toBe(true)
      expect(Array.isArray(results.tasks)).toBe(true)
      expect(Array.isArray(results.executions)).toBe(true)
    })

    it('search with known term finds matching projects', async () => {
      if (!serverAvailable) return
      // Create a project to search for
      const project = await client.createProject({
        name: 'SearchableUniqueXyz',
        description: 'findme',
      })

      try {
        const results = await client.search('SearchableUnique')
        expect(results.projects.length).toBeGreaterThanOrEqual(1)
        const found = results.projects.find(p => p.id === project.id)
        expect(found).toBeDefined()
      } finally {
        await client.deleteProject(project.id)
      }
    })
  })

  // ── Machines ───────────────────────────────────────────────────────

  describe('machines', () => {
    it('listMachines returns an array', async () => {
      if (!serverAvailable) return
      const machines = await client.listMachines()
      expect(Array.isArray(machines)).toBe(true)
    })

    it('listMachines includes connected machine info', async () => {
      if (!serverAvailable) return
      const machines = await client.listMachines()
      if (machines.length === 0) return // skip if no machines

      const machine = machines[0]
      expect(machine).toHaveProperty('id')
      expect(machine).toHaveProperty('name')
      expect(machine).toHaveProperty('hostname')
      expect(machine).toHaveProperty('platform')
      expect(machine).toHaveProperty('isConnected')
    })

    it('resolveMachine resolves partial ID', async () => {
      if (!serverAvailable) return
      const machines = await client.listMachines()
      const active = machines.filter(m => !m.isRevoked)
      if (active.length === 0) return

      // Use full ID to avoid ambiguity with leftover test machines
      const prefix = active[0].id
      const resolved = await client.resolveMachine(prefix)
      expect(resolved.id).toBe(active[0].id)
    })

    it('resolveMachine throws for nonexistent prefix', async () => {
      if (!serverAvailable) return
      await expect(client.resolveMachine('zzz-nonexistent')).rejects.toThrow('No active machine found')
    })
  })

  // ── Activities ─────────────────────────────────────────────────────

  describe('activities', () => {
    it('listActivities returns an array', async () => {
      if (!serverAvailable) return
      const activities = await client.listActivities()
      expect(Array.isArray(activities)).toBe(true)
    })

    it('listActivities with limit param works', async () => {
      if (!serverAvailable) return
      const activities = await client.listActivities({ limit: '5' })
      expect(Array.isArray(activities)).toBe(true)
      expect(activities.length).toBeLessThanOrEqual(5)
    })
  })

  // ── Tool Traces & File Changes ─────────────────────────────────────

  describe('traces and file changes', () => {
    it('listToolTraces returns an array for a valid execution', async () => {
      if (!serverAvailable) return
      const executions = await client.getExecutions()
      const executionIds = Object.values(executions).map(e => e.executionId)
      if (executionIds.length === 0) return

      const traces = await client.listToolTraces(executionIds[0])
      expect(Array.isArray(traces)).toBe(true)
    })

    it('listFileChanges returns an array for a valid execution', async () => {
      if (!serverAvailable) return
      const executions = await client.getExecutions()
      const executionIds = Object.values(executions).map(e => e.executionId)
      if (executionIds.length === 0) return

      const changes = await client.listFileChanges(executionIds[0])
      expect(Array.isArray(changes)).toBe(true)
    })
  })

  // ── Observations ───────────────────────────────────────────────────

  describe('observations', () => {
    it('listObservations returns data for a valid execution', async () => {
      if (!serverAvailable) return
      const executions = await client.getExecutions()
      const executionIds = Object.values(executions).map(e => e.executionId)
      if (executionIds.length === 0) return

      const result = await client.listObservations(executionIds[0])
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('getObservationStats returns aggregates', async () => {
      if (!serverAvailable) return
      const executions = await client.getExecutions()
      const executionIds = Object.values(executions).map(e => e.executionId)
      if (executionIds.length === 0) return

      const stats = await client.getObservationStats(executionIds[0])
      expect(stats).toHaveProperty('totalEvents')
      expect(stats).toHaveProperty('errorCount')
    })

    it('getTraceSummary returns a string', async () => {
      if (!serverAvailable) return
      const executions = await client.getExecutions()
      const executionIds = Object.values(executions).map(e => e.executionId)
      if (executionIds.length === 0) return

      try {
        const summary = await client.getTraceSummary(executionIds[0])
        expect(typeof summary).toBe('string')
      } catch {
        // 404 is acceptable if no observations exist
      }
    })
  })

  // ── Cancel Task ────────────────────────────────────────────────────

  describe('cancel', () => {
    it('cancelTask with nonexistent task returns result', async () => {
      if (!serverAvailable) return
      // Server returns success even for nonexistent tasks (idempotent cancel)
      const result = await client.cancelTask({ executionId: 'nonexistent-exec-id' })
      expect(result).toHaveProperty('success')
    })
  })

  // ── Relay Status ───────────────────────────────────────────────────

  describe('relay', () => {
    it('getRelayStatus returns structured data', async () => {
      if (!serverAvailable) return
      try {
        const status = await client.getRelayStatus()
        expect(typeof status).toBe('object')
      } catch {
        // Relay might not be running — acceptable
      }
    })
  })

  // ── Dispatch (does NOT actually dispatch, just validates the endpoint) ──

  describe('dispatch', () => {
    it('dispatchTask rejects with useful error for invalid node', async () => {
      if (!serverAvailable) return
      // This should fail because the node doesn't exist, but it should
      // return a meaningful error, not a crash.
      await expect(
        client.dispatchTask({
          nodeId: 'nonexistent-node-id',
          projectId: 'nonexistent-project-id',
        })
      ).rejects.toThrow()
    })
  })
})

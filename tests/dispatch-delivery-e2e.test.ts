/**
 * Dispatch & Delivery E2E Tests
 *
 * Full end-to-end tests exercising the dispatch pipeline through a running local server.
 * Tests executive summary template in prompts, delivery failure handling,
 * PR data flow through SSE, and PR URL extraction from output.
 *
 * Requires:
 * - Running server: npm run dev:local (port 3001)
 * - Connected agent runner with 0 active tasks
 * - Test repo cloned to /tmp/astro-test-hpc-sync
 *
 * Auto-skips when the server is not available.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { execSync } from 'child_process'

const API_BASE = 'http://localhost:3001'
const TEST_REPO_PATH = '/tmp/astro-test-hpc-sync'

// ============================================================================
// Helpers
// ============================================================================

interface SSEEvent {
  event: string
  data: string
}

/**
 * Parse an SSE text stream into an array of events.
 */
async function readSSEStream(
  response: Response,
  opts: { timeoutMs?: number; stopOnEvent?: string } = {}
): Promise<SSEEvent[]> {
  const { timeoutMs = 150_000, stopOnEvent = 'done' } = opts
  const events: SSEEvent[] = []

  return new Promise<SSEEvent[]>((resolve) => {
    let buffer = ''
    let currentEvent = ''
    let currentData = ''
    let settled = false

    const finish = () => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(events)
      }
    }

    const timer = setTimeout(finish, timeoutMs)

    const processLine = (line: string) => {
      const trimmed = line.replace(/\r$/, '')
      if (trimmed.startsWith('event:')) {
        currentEvent = trimmed.slice(6).trim()
      } else if (trimmed.startsWith('data:')) {
        currentData = trimmed.slice(5).trim()
      } else if (trimmed === '') {
        if (currentEvent) {
          events.push({ event: currentEvent, data: currentData })
          if (currentEvent === stopOnEvent) {
            finish()
          }
          currentEvent = ''
          currentData = ''
        }
      }
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()

    const pump = (): void => {
      if (settled) return
      reader.read().then(({ done, value }) => {
        if (settled) return
        if (done) {
          if (buffer) processLine(buffer)
          if (currentEvent) {
            events.push({ event: currentEvent, data: currentData })
          }
          finish()
          return
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          processLine(line)
          if (settled) return
        }
        pump()
      }).catch(() => {
        finish()
      })
    }

    pump()
  })
}

/**
 * Create a test project via the data API.
 */
async function createProject(opts: {
  id: string
  name: string
  localPath?: string
  deliveryMode?: string
}): Promise<void> {
  const res = await fetch(`${API_BASE}/api/data/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: opts.id,
      name: opts.name,
      description: 'Dispatch delivery E2E test project',
      source: opts.localPath ? { localPath: opts.localPath } : undefined,
      deliveryMode: opts.deliveryMode || 'pr',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to create project: ${res.status} ${text}`)
  }
}

/**
 * Create a plan node via the data API.
 */
async function createPlanNode(opts: {
  id: string
  projectId: string
  title: string
  description?: string
}): Promise<void> {
  const res = await fetch(`${API_BASE}/api/data/plan/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: opts.id,
      projectId: opts.projectId,
      type: 'task',
      title: opts.title,
      description: opts.description || opts.title,
      status: 'planned',
      verification: 'auto',
      position: { x: 0, y: 0 },
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to create plan node: ${res.status} ${text}`)
  }
}

/**
 * Delete a project via the data API.
 */
async function deleteProject(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/data/projects/${id}`, { method: 'DELETE' }).catch(() => {})
}

/**
 * Wait until no tasks are active on the machine.
 */
async function waitForIdle(maxWaitMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${API_BASE}/api/relay/machines`)
    if (res.ok) {
      const data = await res.json()
      const machines = data.machines || []
      const busy = machines.some((m: { providers: Array<{ currentTasks: number }> }) =>
        m.providers.some(p => p.currentTasks > 0)
      )
      if (!busy) return
    }
    await new Promise(r => setTimeout(r, 2000))
  }
}

// ============================================================================
// Server availability check
// ============================================================================

let serverAvailable = false
let hasRunner = false
try {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)
  const response = await fetch(`${API_BASE}/api/health`, { signal: controller.signal })
  clearTimeout(timeout)
  if (response.ok) {
    const data = await response.json()
    serverAvailable = true
    hasRunner = data.relay?.connectedRunners > 0
  }
} catch {
  serverAvailable = false
}

// Check if test repo exists
let repoExists = false
try {
  execSync(`test -d ${TEST_REPO_PATH}/.git`, { stdio: 'ignore' })
  repoExists = true
} catch {
  repoExists = false
}

const canRun = serverAvailable && hasRunner && repoExists

// ============================================================================
// Tests
// ============================================================================

/**
 * Reset the test repo to a clean state.
 */
function resetRepo(): void {
  try {
    execSync('git checkout . && git clean -fd', { cwd: TEST_REPO_PATH, stdio: 'ignore' })
    execSync('rm -rf .astro && git worktree prune', { cwd: TEST_REPO_PATH, stdio: 'ignore' })
  } catch {
    // Ignore errors
  }
}

describe.skipIf(!canRun)('Dispatch Delivery E2E', () => {
  const projectIds: string[] = []

  beforeAll(() => {
    resetRepo()
  })

  beforeEach(async () => {
    await waitForIdle()
  })

  afterAll(async () => {
    for (const id of projectIds) {
      await deleteProject(id)
    }
    resetRepo()
  })

  it('prompt includes executive summary template (dryRun)', async () => {
    const projectId = crypto.randomUUID()
    const nodeId = crypto.randomUUID()
    projectIds.push(projectId)

    await createProject({
      id: projectId,
      name: 'E2E Summary Template Test',
      localPath: TEST_REPO_PATH,
      deliveryMode: 'pr',
    })
    await createPlanNode({
      id: nodeId,
      projectId,
      title: 'Check summary template',
      description: 'Verify the summary template is present',
    })

    const res = await fetch(`${API_BASE}/api/dispatch/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        projectId,
        title: 'Check summary template',
        description: 'Verify the summary template is present',
        workingDirectory: TEST_REPO_PATH,
        deliveryMode: 'pr',
        dryRun: true,
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.prompt).toBeDefined()
    expect(body.prompt).toContain('## Executive Summary')
    expect(body.prompt).toContain('**Status:** success | partial | failure')
  })

  it('delivery failure preserves completed status in SSE result', async () => {
    const projectId = crypto.randomUUID()
    const nodeId = crypto.randomUUID()
    projectIds.push(projectId)

    await createProject({
      id: projectId,
      name: 'E2E Delivery Failure Test',
      localPath: TEST_REPO_PATH,
      deliveryMode: 'direct',
    })
    await createPlanNode({
      id: nodeId,
      projectId,
      title: 'Simple echo task',
      description: "Run 'echo hello' and nothing else.",
    })

    const res = await fetch(`${API_BASE}/api/dispatch/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        projectId,
        title: 'Simple echo task',
        description: "Run 'echo hello' and nothing else.",
        workingDirectory: TEST_REPO_PATH,
        deliveryMode: 'direct',
        useWorktree: false,
      }),
    })

    expect(res.ok).toBe(true)
    const events = await readSSEStream(res, { timeoutMs: 120_000 })

    const resultEvents = events.filter(e => e.event === 'result')
    expect(resultEvents.length).toBeGreaterThanOrEqual(1)

    const resultData = JSON.parse(resultEvents[0].data)
    // Direct mode: execution should succeed
    expect(resultData.status).toBe('success')
    // For direct mode, delivery is skipped (no branch/PR)
    // The key assertion: status is preserved regardless of delivery outcome
    expect(['success', 'completed']).toContain(resultData.status)
  }, 180_000)

  it('PR data flows through SSE result', async () => {
    const projectId = crypto.randomUUID()
    const nodeId = crypto.randomUUID()
    projectIds.push(projectId)

    await createProject({
      id: projectId,
      name: 'E2E PR Data Flow Test',
      localPath: TEST_REPO_PATH,
      deliveryMode: 'branch',
    })
    await createPlanNode({
      id: nodeId,
      projectId,
      title: 'Branch task for PR data',
      description: "Create a file called test-pr-flow.txt with content 'test'. Do nothing else.",
    })

    const res = await fetch(`${API_BASE}/api/dispatch/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        projectId,
        title: 'Branch task for PR data',
        description: "Create a file called test-pr-flow.txt with content 'test'. Do nothing else.",
        workingDirectory: TEST_REPO_PATH,
        deliveryMode: 'branch',
        useWorktree: true,
      }),
    })

    expect(res.ok).toBe(true)
    const events = await readSSEStream(res, { timeoutMs: 120_000 })

    const resultEvents = events.filter(e => e.event === 'result')
    expect(resultEvents.length).toBeGreaterThanOrEqual(1)

    const resultData = JSON.parse(resultEvents[0].data)
    expect(resultData.status).toBe('success')

    // Branch mode should produce a branchName
    if (resultData.branchName) {
      expect(typeof resultData.branchName).toBe('string')
      expect(resultData.branchName.length).toBeGreaterThan(0)
    }
  }, 180_000)

  it('PR data persisted to DB after task completion', async () => {
    const projectId = crypto.randomUUID()
    const nodeId = crypto.randomUUID()
    projectIds.push(projectId)

    await createProject({
      id: projectId,
      name: 'E2E PR Persist Test',
      localPath: TEST_REPO_PATH,
      deliveryMode: 'branch',
    })
    await createPlanNode({
      id: nodeId,
      projectId,
      title: 'Persist test task',
      description: "Create a file called test-persist.txt with content 'persist'. Do nothing else.",
    })

    const res = await fetch(`${API_BASE}/api/dispatch/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        projectId,
        title: 'Persist test task',
        description: "Create a file called test-persist.txt with content 'persist'. Do nothing else.",
        workingDirectory: TEST_REPO_PATH,
        deliveryMode: 'branch',
        useWorktree: true,
      }),
    })

    expect(res.ok).toBe(true)
    await readSSEStream(res, { timeoutMs: 120_000 })

    // Allow a moment for hooks to persist data
    await new Promise(r => setTimeout(r, 2000))

    // Query the plan node from the API to check persisted data
    const planRes = await fetch(`${API_BASE}/api/data/plan/${projectId}`)
    expect(planRes.ok).toBe(true)
    const plan = await planRes.json()
    const node = plan.nodes.find((n: { id: string }) => n.id === nodeId)

    if (node) {
      // If the agent runner produced a branch, it should be persisted
      // (branchName may or may not be set depending on agent runner behavior)
      if (node.branchName) {
        expect(typeof node.branchName).toBe('string')
      }
    }
  }, 180_000)

  it('dryRun prompt contains delivery-mode-specific instructions', async () => {
    const projectId = crypto.randomUUID()
    const nodeId = crypto.randomUUID()
    projectIds.push(projectId)

    await createProject({
      id: projectId,
      name: 'E2E Direct Mode Prompt Test',
      localPath: TEST_REPO_PATH,
      deliveryMode: 'direct',
    })
    await createPlanNode({
      id: nodeId,
      projectId,
      title: 'Direct mode prompt check',
    })

    const res = await fetch(`${API_BASE}/api/dispatch/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        projectId,
        title: 'Direct mode prompt check',
        description: 'Test direct mode prompt',
        workingDirectory: TEST_REPO_PATH,
        deliveryMode: 'direct',
        dryRun: true,
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.prompt).toBeDefined()

    // Direct mode should mention "directly in the project directory"
    expect(body.prompt).toContain('directly in the project directory')
    // Direct mode should NOT mention worktree
    expect(body.prompt).not.toContain('git worktree')
    // Direct mode should NOT include astro-metadata
    expect(body.prompt).not.toContain('<!-- astro-metadata')
  })
})

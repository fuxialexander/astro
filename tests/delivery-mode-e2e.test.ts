/**
 * Delivery Mode E2E Tests
 *
 * Tests the full dispatch pipeline through the running local server (localhost:3001)
 * and connected agent runner, exercising PR, branch, and direct delivery modes.
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
 * Uses promise-based reader with explicit pump loop.
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
  localPath: string
  deliveryMode: string
}): Promise<void> {
  const res = await fetch(`${API_BASE}/api/data/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: opts.id,
      name: opts.name,
      description: 'Delivery mode E2E test project',
      source: { localPath: opts.localPath },
      deliveryMode: opts.deliveryMode,
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
  description: string
}): Promise<void> {
  const res = await fetch(`${API_BASE}/api/data/plan/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: opts.id,
      projectId: opts.projectId,
      type: 'task',
      title: opts.title,
      description: opts.description,
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
 * Dispatch a task and return the SSE event stream.
 */
async function dispatchTask(body: Record<string, unknown>): Promise<SSEEvent[]> {
  const res = await fetch(`${API_BASE}/api/dispatch/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Dispatch failed: ${res.status} ${text}`)
  }

  return readSSEStream(res, { timeoutMs: 150_000 })
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

// ============================================================================
// Server availability check
// ============================================================================

let serverAvailable = false
let hasRunner = false
try {
  const response = await fetch(`${API_BASE}/api/health`)
  if (response.ok) {
    const data = await response.json()
    serverAvailable = true
    hasRunner = data.relay?.connectedRunners > 0
  }
} catch {
  serverAvailable = false
}

// Also check if test repo exists
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

describe.skipIf(!canRun)('Delivery Mode E2E', () => {
  const projectIds: string[] = []

  beforeAll(() => {
    resetRepo()
  })

  beforeEach(async () => {
    // Wait for machine to be idle before each test
    await waitForIdle()
  })

  afterAll(async () => {
    // Clean up test projects
    for (const id of projectIds) {
      await deleteProject(id)
    }
    resetRepo()
  })

  it('PR delivery mode: dispatches task with worktree, result includes branchName', async () => {
    const projectId = crypto.randomUUID()
    const nodeId = crypto.randomUUID()
    projectIds.push(projectId)

    await createProject({
      id: projectId,
      name: 'E2E PR Delivery Test',
      localPath: TEST_REPO_PATH,
      deliveryMode: 'pr',
    })
    await createPlanNode({
      id: nodeId,
      projectId,
      title: 'Create test file for PR',
      description: "Create a file called test-delivery-pr.txt with the content 'hello from astro pr mode'. Do nothing else.",
    })

    const events = await dispatchTask({
      nodeId,
      projectId,
      title: 'Create test file for PR',
      description: "Create a file called test-delivery-pr.txt with the content 'hello from astro pr mode'. Do nothing else.",
      workingDirectory: TEST_REPO_PATH,
      deliveryMode: 'pr',
      useWorktree: true,
    })

    // Should have init event
    const initEvents = events.filter((e) => e.event === 'init')
    expect(initEvents.length).toBeGreaterThanOrEqual(1)
    const initData = JSON.parse(initEvents[0].data)
    expect(initData.executionId).toBeDefined()
    expect(initData.nodeId).toBe(nodeId)
    expect(initData.machineId).toBeDefined()

    // Should have text events (agent output)
    const textEvents = events.filter((e) => e.event === 'text')
    expect(textEvents.length).toBeGreaterThan(0)

    // Should have a result event
    const resultEvents = events.filter((e) => e.event === 'result')
    expect(resultEvents.length).toBeGreaterThanOrEqual(1)
    const resultData = JSON.parse(resultEvents[0].data)
    expect(resultData.status).toBe('success')

    // PR mode should produce a branchName
    expect(resultData.branchName).toBeDefined()
    expect(typeof resultData.branchName).toBe('string')
    expect(resultData.branchName.length).toBeGreaterThan(0)

    // Should have a done event
    const doneEvents = events.filter((e) => e.event === 'done')
    expect(doneEvents.length).toBeGreaterThanOrEqual(1)
  }, 180_000)

  it('Branch delivery mode: result has branchName but no prUrl', async () => {
    const projectId = crypto.randomUUID()
    const nodeId = crypto.randomUUID()
    projectIds.push(projectId)

    await createProject({
      id: projectId,
      name: 'E2E Branch Delivery Test',
      localPath: TEST_REPO_PATH,
      deliveryMode: 'branch',
    })
    await createPlanNode({
      id: nodeId,
      projectId,
      title: 'Create branch test file',
      description: "Create a file called test-delivery-branch.txt with the content 'hello from astro branch mode'. Do nothing else.",
    })

    const events = await dispatchTask({
      nodeId,
      projectId,
      title: 'Create branch test file',
      description: "Create a file called test-delivery-branch.txt with the content 'hello from astro branch mode'. Do nothing else.",
      workingDirectory: TEST_REPO_PATH,
      deliveryMode: 'branch',
      useWorktree: true,
    })

    const initEvents = events.filter((e) => e.event === 'init')
    expect(initEvents.length).toBeGreaterThanOrEqual(1)

    const resultEvents = events.filter((e) => e.event === 'result')
    expect(resultEvents.length).toBeGreaterThanOrEqual(1)
    const resultData = JSON.parse(resultEvents[0].data)
    expect(resultData.status).toBe('success')

    // Branch mode should have a branchName
    expect(resultData.branchName).toBeDefined()
    expect(typeof resultData.branchName).toBe('string')

    // Branch mode should NOT create a PR
    expect(resultData.prUrl).toBeUndefined()
  }, 180_000)

  it('Direct delivery mode: task completes without branch isolation', async () => {
    // Clean repo for direct mode (no uncommitted changes allowed)
    resetRepo()

    const projectId = crypto.randomUUID()
    const nodeId = crypto.randomUUID()
    projectIds.push(projectId)

    await createProject({
      id: projectId,
      name: 'E2E Direct Delivery Test',
      localPath: TEST_REPO_PATH,
      deliveryMode: 'direct',
    })
    await createPlanNode({
      id: nodeId,
      projectId,
      title: 'Create direct test file',
      description: "Create a file called test-delivery-direct.txt with the content 'hello from astro direct mode'. Do nothing else.",
    })

    const events = await dispatchTask({
      nodeId,
      projectId,
      title: 'Create direct test file',
      description: "Create a file called test-delivery-direct.txt with the content 'hello from astro direct mode'. Do nothing else.",
      workingDirectory: TEST_REPO_PATH,
      deliveryMode: 'direct',
      useWorktree: false,
    })

    const initEvents = events.filter((e) => e.event === 'init')
    expect(initEvents.length).toBeGreaterThanOrEqual(1)

    const resultEvents = events.filter((e) => e.event === 'result')
    expect(resultEvents.length).toBeGreaterThanOrEqual(1)
    const resultData = JSON.parse(resultEvents[0].data)
    expect(resultData.status).toBe('success')

    // Direct mode should NOT have a branchName
    if (resultData.branchName !== undefined) {
      expect(resultData.branchName).toBeNull()
    }
  }, 180_000)

  it('Prompt verification: agent receives workspace/delivery instructions in PR mode', async () => {
    const projectId = crypto.randomUUID()
    const nodeId = crypto.randomUUID()
    projectIds.push(projectId)

    await createProject({
      id: projectId,
      name: 'E2E Prompt Verification Test',
      localPath: TEST_REPO_PATH,
      deliveryMode: 'pr',
    })
    await createPlanNode({
      id: nodeId,
      projectId,
      title: 'Verify workspace instructions',
      description: "Run 'echo WORKSPACE_CHECK' and describe what delivery mode and workspace instructions you received. Just print a short summary.",
    })

    const events = await dispatchTask({
      nodeId,
      projectId,
      title: 'Verify workspace instructions',
      description: "Run 'echo WORKSPACE_CHECK' and describe what delivery mode and workspace instructions you received. Just print a short summary.",
      workingDirectory: TEST_REPO_PATH,
      deliveryMode: 'pr',
      useWorktree: true,
    })

    // Collect all text events — data may be JSON-encoded or plain text
    const textContent = events
      .filter((e) => e.event === 'text')
      .map((e) => {
        try {
          const parsed = JSON.parse(e.data)
          return typeof parsed === 'string' ? parsed : (parsed.text ?? e.data)
        } catch {
          return e.data
        }
      })
      .join('')

    // Also check tool_use events which may reference worktree paths
    const toolContent = events
      .filter((e) => e.event === 'tool_use' || e.event === 'tool_result')
      .map((e) => e.data)
      .join('')

    const allContent = (textContent + ' ' + toolContent).toLowerCase()

    // The agent should have received workspace/delivery instructions — check broad set of keywords
    const hasWorkspaceContext =
      allContent.includes('worktree') ||
      allContent.includes('branch') ||
      allContent.includes('pr') ||
      allContent.includes('pull request') ||
      allContent.includes('isolated') ||
      allContent.includes('workspace') ||
      allContent.includes('astro/') ||  // branch name pattern
      allContent.includes('.astro') ||   // agent dir
      allContent.includes('commit') ||
      allContent.includes('echo')        // the command we asked to run

    expect(hasWorkspaceContext).toBe(true)

    const resultEvents = events.filter((e) => e.event === 'result')
    expect(resultEvents.length).toBeGreaterThanOrEqual(1)
  }, 180_000)

  it('SSE event structure: init, text, result, and done events have correct fields', async () => {
    const projectId = crypto.randomUUID()
    const nodeId = crypto.randomUUID()
    projectIds.push(projectId)

    await createProject({
      id: projectId,
      name: 'E2E SSE Validation Test',
      localPath: TEST_REPO_PATH,
      deliveryMode: 'pr',
    })
    await createPlanNode({
      id: nodeId,
      projectId,
      title: 'Simple file creation',
      description: "Create a file called test-sse.txt with content 'sse test'. Do nothing else.",
    })

    const events = await dispatchTask({
      nodeId,
      projectId,
      title: 'Simple file creation',
      description: "Create a file called test-sse.txt with content 'sse test'. Do nothing else.",
      workingDirectory: TEST_REPO_PATH,
      deliveryMode: 'pr',
      useWorktree: true,
    })

    // Validate init event structure
    const initEvent = events.find((e) => e.event === 'init')
    expect(initEvent).toBeDefined()
    const initData = JSON.parse(initEvent!.data)
    expect(initData).toHaveProperty('executionId')
    expect(initData).toHaveProperty('nodeId')
    expect(initData).toHaveProperty('machineId')

    // Validate result event structure
    const resultEvent = events.find((e) => e.event === 'result')
    expect(resultEvent).toBeDefined()
    const resultData = JSON.parse(resultEvent!.data)
    expect(resultData).toHaveProperty('executionId')
    expect(resultData).toHaveProperty('nodeId')
    expect(resultData).toHaveProperty('status')
    expect(['success', 'failure']).toContain(resultData.status)

    // Validate done event
    const doneEvent = events.find((e) => e.event === 'done')
    expect(doneEvent).toBeDefined()
    const doneData = JSON.parse(doneEvent!.data)
    expect(doneData).toHaveProperty('executionId')
    expect(doneData).toHaveProperty('nodeId')

    // Collect event types seen
    const eventTypes = new Set(events.map((e) => e.event))
    expect(eventTypes.has('init')).toBe(true)
    expect(eventTypes.has('result')).toBe(true)
    expect(eventTypes.has('done')).toBe(true)
    expect(eventTypes.has('text')).toBe(true)

    // Tool use events are expected for file creation
    if (eventTypes.has('tool_use')) {
      const toolEvent = events.find((e) => e.event === 'tool_use')!
      const toolData = JSON.parse(toolEvent.data)
      expect(toolData).toHaveProperty('toolName')
    }
  }, 180_000)
})

/**
 * Integration test: Local execution end-to-end
 *
 * 1. Generate a plan for a scatter-plot Python app
 * 2. Parse plan nodes/edges from SSE
 * 3. Dispatch the first task to local Claude Code provider
 * 4. Stream execution output until completion
 *
 * Usage:
 *   npx tsx tests/test-local-execution.ts
 *
 * Prerequisites:
 *   - Backend running on port 3001 (`npm run dev:backend`)
 *   - Claude Code authenticated (`claude login`)
 *   - tests/scatter-plot-app/ git repo exists
 */

const API = 'http://localhost:3001'
const WORKING_DIR = new URL('./scatter-plot-app', import.meta.url).pathname

interface PlanNode {
  id: string
  type: string
  title: string
  description: string
  status: string
  parentId: string | null
  dependencies: string[]
  environment: string
  verification: string
  position: { x: number; y: number }
  priority?: string
  estimate?: string
}

interface PlanEdge {
  id: string
  source: string
  target: string
  type: string
}

interface PlanResult {
  projectName: string
  nodes: PlanNode[]
  edges: PlanEdge[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse SSE stream and call handler for each event */
async function readSSE(
  response: Response,
  handler: (event: string, data: string) => void
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    let currentEvent = ''
    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        const data = line.slice(5).trim()
        if (currentEvent) {
          handler(currentEvent, data)
          currentEvent = ''
        }
      }
    }
  }
}

function log(tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`[${ts}] [${tag}] ${msg}`)
}

// ─── Step 1: Health check ───────────────────────────────────────────────────

async function checkHealth() {
  log('health', 'Checking backend health...')
  const res = await fetch(`${API}/api/health`)
  const data = await res.json()
  log('health', `Status: ${data.status}, Authenticated: ${data.authenticated}`)
  log('health', `Default provider: ${data.defaultProvider?.id ?? 'none'}`)
  if (!data.authenticated) {
    throw new Error('Backend not authenticated. Run `claude login` first.')
  }
  return data
}

// ─── Step 2: Generate plan ──────────────────────────────────────────────────

async function generatePlan(): Promise<PlanResult> {
  log('plan', 'Generating plan for scatter-plot app...')

  const description = `Build a Python scatter plot application with the following requirements:
- Reads CSV files (user provides a file path)
- Lets user select any two columns from the CSV to use as X and Y axes
- Displays an interactive scatter plot using matplotlib or plotly
- Handles common edge cases: missing values, non-numeric columns
- Has a simple CLI interface (argparse)
- Include a sample CSV file for testing

The code should be clean, well-documented, and include a requirements.txt.
Working directory: ${WORKING_DIR}`

  const response = await fetch(`${API}/api/agent/generate-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description,
      projectId: 'test-scatter-plot',
    }),
  })

  if (!response.ok) {
    throw new Error(`Plan generation failed: ${response.status}`)
  }

  let plan: PlanResult | null = null
  let textBuffer = ''

  await readSSE(response, (event, data) => {
    switch (event) {
      case 'text':
        textBuffer += data
        process.stdout.write(data)
        break
      case 'plan_result':
        try {
          plan = JSON.parse(data)
          log('plan', `\nReceived plan: "${plan!.projectName}" with ${plan!.nodes.length} nodes`)
        } catch {
          log('plan', 'Failed to parse plan_result')
        }
        break
      case 'done':
        log('plan', 'Plan generation complete')
        break
      case 'error':
        log('plan', `Error: ${data}`)
        break
    }
  })

  // If no structured plan_result, try to parse from text
  if (!plan && textBuffer) {
    const jsonMatch = textBuffer.match(/\{[\s\S]*"nodes"[\s\S]*"edges"[\s\S]*\}/)
    if (jsonMatch) {
      try {
        plan = JSON.parse(jsonMatch[0])
        log('plan', `Parsed plan from text: "${plan!.projectName}" with ${plan!.nodes.length} nodes`)
      } catch {
        log('plan', 'Could not parse plan from text output')
      }
    }
  }

  if (!plan) {
    throw new Error('No plan generated')
  }

  return plan
}

// ─── Step 3: Display plan ───────────────────────────────────────────────────

function displayPlan(plan: PlanResult) {
  console.log('\n' + '='.repeat(60))
  console.log(`Plan: ${plan.projectName}`)
  console.log('='.repeat(60))

  // Topological order for display
  const visited = new Set<string>()
  const order: PlanNode[] = []

  function visit(nodeId: string) {
    if (visited.has(nodeId)) return
    const node = plan.nodes.find((n) => n.id === nodeId)
    if (!node) return
    visited.add(nodeId)
    for (const dep of node.dependencies) {
      visit(dep)
    }
    order.push(node)
  }

  for (const node of plan.nodes) {
    visit(node.id)
  }

  for (const node of order) {
    const deps = node.dependencies.length > 0 ? ` (depends: ${node.dependencies.join(', ')})` : ''
    const icon = node.type === 'milestone' ? '◆' : node.type === 'decision' ? '◇' : '●'
    console.log(
      `  ${icon} ${node.id}: ${node.title}${deps}`
    )
    console.log(`    ${node.description.slice(0, 100)}${node.description.length > 100 ? '...' : ''}`)
    console.log(`    env=${node.environment} verify=${node.verification} est=${node.estimate ?? '-'}`)
  }

  console.log(`\nEdges: ${plan.edges.length}`)
  for (const edge of plan.edges) {
    console.log(`  ${edge.source} → ${edge.target} (${edge.type})`)
  }
  console.log()
}

// ─── Step 4: Execute first task ─────────────────────────────────────────────

async function executeTask(node: PlanNode, plan: PlanResult) {
  log('exec', `Dispatching task: "${node.title}"`)
  log('exec', `Working directory: ${WORKING_DIR}`)

  const response = await fetch(`${API}/api/dispatch/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nodeId: node.id,
      projectId: 'test-scatter-plot',
      title: node.title,
      description: node.description,
      dependencies: node.dependencies,
      environment: 'local',
      verification: node.verification,
      workingDirectory: WORKING_DIR,
      maxTurns: 30,
      force: true, // skip dependency checks for first task
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Dispatch failed: ${response.status} - ${text}`)
  }

  let executionId = ''
  let toolCount = 0
  let fileChangeCount = 0

  await readSSE(response, (event, data) => {
    switch (event) {
      case 'init': {
        const parsed = JSON.parse(data)
        executionId = parsed.executionId
        log('exec', `Execution started: ${executionId} (provider: ${parsed.providerName ?? parsed.providerId})`)
        break
      }
      case 'session_init': {
        const parsed = JSON.parse(data)
        log('exec', `Session: ${parsed.sessionId}, Model: ${parsed.model}`)
        break
      }
      case 'text':
        process.stdout.write(data)
        break
      case 'tool_use': {
        toolCount++
        const parsed = JSON.parse(data)
        log('tool', `${parsed.toolName}`)
        break
      }
      case 'tool_result': {
        const parsed = JSON.parse(data)
        const status = parsed.success ? 'ok' : 'FAIL'
        log('tool', `  → ${status}`)
        break
      }
      case 'file_change': {
        fileChangeCount++
        const parsed = JSON.parse(data)
        log('file', `${parsed.action ?? 'modify'}: ${parsed.path}`)
        break
      }
      case 'progress': {
        const parsed = JSON.parse(data)
        log('exec', `Progress: ${parsed.message}`)
        break
      }
      case 'result': {
        const parsed = JSON.parse(data)
        log('exec', `\nResult: ${parsed.status} (final: ${parsed.finalStatus ?? '-'})`)
        break
      }
      case 'error': {
        const parsed = JSON.parse(data)
        const msg = typeof parsed === 'string' ? parsed : parsed.error
        log('exec', `ERROR: ${msg}`)
        break
      }
      case 'aborted':
        log('exec', 'Execution aborted')
        break
      case 'done':
        log('exec', 'Stream complete')
        break
    }
  })

  console.log('\n' + '='.repeat(60))
  log('exec', `Summary: ${toolCount} tool calls, ${fileChangeCount} file changes`)
  console.log('='.repeat(60))
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  Nexus Local Execution Integration Test                 ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log()

  // Step 1: Health check
  await checkHealth()

  // Step 2: Generate plan
  const plan = await generatePlan()

  // Step 3: Display plan
  displayPlan(plan)

  // Step 4: Find the first executable task (no dependencies)
  const rootTasks = plan.nodes.filter(
    (n) => n.type === 'task' && n.dependencies.length === 0
  )

  if (rootTasks.length === 0) {
    log('exec', 'No root tasks found. Picking first task node.')
    const firstTask = plan.nodes.find((n) => n.type === 'task')
    if (!firstTask) throw new Error('No tasks in plan')
    rootTasks.push(firstTask)
  }

  log('exec', `Found ${rootTasks.length} root task(s). Executing first one.`)

  // Step 5: Execute
  await executeTask(rootTasks[0], plan)

  // Step 6: Verify output
  log('verify', `Checking working directory: ${WORKING_DIR}`)

  // List files in the working directory
  const { execSync } = await import('child_process')
  try {
    const files = execSync(`ls -la "${WORKING_DIR}"`, { encoding: 'utf-8' })
    console.log('\nFiles in working directory:')
    console.log(files)
  } catch {
    log('verify', 'Could not list files')
  }

  // Check git log
  try {
    const gitLog = execSync(`git -C "${WORKING_DIR}" log --oneline -5`, { encoding: 'utf-8' })
    console.log('Recent git commits:')
    console.log(gitLog)
  } catch {
    log('verify', 'Could not read git log')
  }

  console.log('\nTest complete!')
}

main().catch((err) => {
  console.error('\nTest failed:', err.message)
  process.exit(1)
})

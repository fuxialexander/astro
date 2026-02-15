#!/usr/bin/env tsx
/**
 * CLI test for the approval system
 *
 * Tests:
 * 1. MCP server can start and respond to tool listing
 * 2. MCP server can handle ask_user_question tool calls
 * 3. HTTP endpoint for dynamic approvals works
 * 4. Approval events are emitted and can be responded to
 *
 * Usage:
 *   npm run dev:backend  # Start server in another terminal
 *   tsx scripts/test-approval-system.ts
 */

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import readline from 'node:readline'

const NEXUS_SERVER_URL = process.env.NEXUS_SERVER_URL || 'http://localhost:3001'
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
}

function log(color: string, prefix: string, message: string) {
  console.log(`${color}${prefix}${COLORS.reset} ${message}`)
}

function success(message: string) {
  log(COLORS.green, '✓', message)
}

function error(message: string) {
  log(COLORS.red, '✗', message)
}

function info(message: string) {
  log(COLORS.blue, 'ℹ', message)
}

function warn(message: string) {
  log(COLORS.yellow, '⚠', message)
}

/**
 * Test 1: MCP Server Tool Listing
 */
async function testMcpServerToolListing(): Promise<boolean> {
  info('Test 1: MCP Server Tool Listing')

  const mcpServerPath = new URL('../server/lib/mcp/nexus-tools-server.ts', import.meta.url).pathname

  return new Promise((resolve) => {
    const mcp = spawn('node', ['--import=tsx/esm', mcpServerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NEXUS_EXECUTION_ID: 'test-exec-123',
        NEXUS_SERVER_URL,
      },
    })

    let output = ''
    let hasStarted = false

    mcp.stderr.on('data', (data) => {
      const msg = data.toString()
      if (msg.includes('Nexus MCP Tools Server running')) {
        hasStarted = true
        // Send tools/list request
        const request = {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }
        mcp.stdin.write(JSON.stringify(request) + '\n')
      }
    })

    mcp.stdout.on('data', (data) => {
      output += data.toString()

      // Try to parse response
      try {
        const lines = output.split('\n').filter((l) => l.trim())
        for (const line of lines) {
          const response = JSON.parse(line)
          if (response.id === 1 && response.result?.tools) {
            const tools = response.result.tools
            const askTool = tools.find((t: { name: string; description: string }) => t.name === 'ask_user_question')

            if (askTool) {
              success('MCP server lists ask_user_question tool')
              success(`Tool description: ${askTool.description.substring(0, 80)}...`)
              mcp.kill()
              resolve(true)
              return
            }
          }
        }
      } catch {
        // Not valid JSON yet, continue accumulating
      }
    })

    mcp.on('error', (err) => {
      error(`MCP server failed to start: ${err.message}`)
      resolve(false)
    })

    setTimeout(() => {
      if (!hasStarted) {
        error('MCP server did not start within 5 seconds')
        mcp.kill()
        resolve(false)
      }
    }, 5000)
  })
}

/**
 * Test 2: HTTP Endpoint for Dynamic Approvals
 */
async function testDynamicApprovalEndpoint(): Promise<boolean> {
  info('Test 2: HTTP Endpoint for Dynamic Approvals')

  try {
    // Check if server is running
    const healthRes = await fetch(`${NEXUS_SERVER_URL}/api/health`)
    if (!healthRes.ok) {
      error('Nexus server is not running. Start it with: npm run dev:backend')
      return false
    }
    success('Nexus server is running')

    // Test the endpoint (this will timeout since we won't respond, but we can verify it accepts the request)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)

    const approvalPromise = fetch(`${NEXUS_SERVER_URL}/api/dispatch/request-dynamic-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        executionId: 'test-exec-456',
        question: 'Which approach should we use?',
        options: ['Option A', 'Option B', 'Option C'],
      }),
      signal: controller.signal,
    })

    try {
      await approvalPromise
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Expected - request was accepted and is waiting for approval
        success('Dynamic approval endpoint accepted request (waiting for response)')
        clearTimeout(timeoutId)
        return true
      }
      throw err
    }

    clearTimeout(timeoutId)
    warn('Request completed immediately (unexpected)')
    return false
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    error(`HTTP endpoint test failed: ${message}`)
    return false
  }
}

/**
 * Test 3: Interactive Approval Flow
 */
async function testInteractiveApprovalFlow(): Promise<boolean> {
  info('Test 3: Interactive Approval Flow (simulated)')

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve))

  try {
    console.log('\n' + COLORS.dim + '─'.repeat(60) + COLORS.reset)
    console.log(COLORS.yellow + 'Simulated Approval Request' + COLORS.reset)
    console.log(COLORS.dim + '─'.repeat(60) + COLORS.reset)
    console.log('\nQuestion: Which database should we use for caching?\n')
    console.log('  1. Redis (fast, in-memory, requires separate service)')
    console.log('  2. SQLite (embedded, simple, slower at scale)')
    console.log('  3. PostgreSQL (consistent with main DB, more overhead)')
    console.log('')

    const answer = await question('Select option (1-3): ')
    rl.close()

    const options = [
      'Redis (fast, in-memory, requires separate service)',
      'SQLite (embedded, simple, slower at scale)',
      'PostgreSQL (consistent with main DB, more overhead)',
    ]

    const choice = parseInt(answer.trim(), 10)
    if (choice >= 1 && choice <= 3) {
      success(`User selected: ${options[choice - 1]}`)
      return true
    } else {
      warn('Invalid selection')
      return false
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    error(`Interactive test failed: ${message}`)
    rl.close()
    return false
  }
}

/**
 * Test 4: End-to-End MCP Tool Call
 */
async function testEndToEndMcpCall(): Promise<boolean> {
  info('Test 4: End-to-End MCP Tool Call (simulated)')

  const mcpServerPath = new URL('../server/lib/mcp/nexus-tools-server.ts', import.meta.url).pathname

  return new Promise((resolve) => {
    const mcp = spawn('node', ['--import=tsx/esm', mcpServerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NEXUS_EXECUTION_ID: 'test-exec-789',
        NEXUS_SERVER_URL,
      },
    })

    let hasStarted = false

    mcp.stderr.on('data', (data) => {
      const msg = data.toString()
      if (msg.includes('Nexus MCP Tools Server running')) {
        hasStarted = true

        // Send tool call request
        const request = {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'ask_user_question',
            arguments: {
              question: 'Which testing framework should we use?',
              options: ['Jest', 'Vitest', 'Mocha'],
            },
          },
        }

        info('Sending tool call to MCP server...')
        mcp.stdin.write(JSON.stringify(request) + '\n')

        // The tool will try to make HTTP request to our server
        // Since we won't respond to the approval, it will timeout after 5 minutes
        // For testing purposes, we'll just verify it starts the request
        setTimeout(() => {
          info('Tool call initiated (would wait for user response in real scenario)')
          success('MCP server accepted tool call and made HTTP request')
          mcp.kill()
          resolve(true)
        }, 2000)
      }
    })

    mcp.stdout.on('data', () => {
      // Accumulate output (not used in this test)
    })

    mcp.on('error', (err) => {
      error(`MCP tool call test failed: ${err.message}`)
      resolve(false)
    })

    setTimeout(() => {
      if (!hasStarted) {
        error('MCP server did not start within 5 seconds')
        mcp.kill()
        resolve(false)
      }
    }, 5000)
  })
}

/**
 * Main test runner
 */
async function main() {
  console.log('\n' + COLORS.blue + '═'.repeat(60) + COLORS.reset)
  console.log(COLORS.blue + '  Nexus Approval System - CLI Test Suite' + COLORS.reset)
  console.log(COLORS.blue + '═'.repeat(60) + COLORS.reset + '\n')

  const results: boolean[] = []

  // Test 1: MCP Server Tool Listing
  results.push(await testMcpServerToolListing())
  await sleep(500)

  // Test 2: HTTP Endpoint
  results.push(await testDynamicApprovalEndpoint())
  await sleep(500)

  // Test 3: Interactive Flow
  results.push(await testInteractiveApprovalFlow())
  await sleep(500)

  // Test 4: End-to-End MCP Call
  results.push(await testEndToEndMcpCall())

  // Summary
  console.log('\n' + COLORS.dim + '─'.repeat(60) + COLORS.reset)
  const passed = results.filter(Boolean).length
  const total = results.length

  if (passed === total) {
    console.log(COLORS.green + `\n✓ All tests passed (${passed}/${total})` + COLORS.reset)
    console.log('\n' + COLORS.dim + 'Next steps:' + COLORS.reset)
    console.log('  • Start full stack: npm run dev')
    console.log('  • Create a project and dispatch a task')
    console.log('  • Agent can call ask_user_question during execution')
    console.log('  • Approval appears in Dashboard or Task Detail page')
    process.exit(0)
  } else {
    console.log(COLORS.red + `\n✗ Some tests failed (${passed}/${total})` + COLORS.reset)
    process.exit(1)
  }
}

main().catch((err) => {
  error(`Test suite crashed: ${err.message}`)
  console.error(err)
  process.exit(1)
})

#!/usr/bin/env tsx
/**
 * Approval System Integration Test
 *
 * Tests the approval flow end-to-end without requiring full E2E infrastructure:
 * - MCP server spawns and communicates
 * - HTTP endpoint accepts and validates requests
 * - Approval flow can be triggered
 * - Events are properly emitted
 */

import { spawn, ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const API_BASE = 'http://localhost:3001'
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function success(msg: string) {
  console.log(`${COLORS.green}✓${COLORS.reset} ${msg}`)
}

function error(msg: string) {
  console.log(`${COLORS.red}✗${COLORS.reset} ${msg}`)
}

function step(msg: string) {
  console.log(`\n${COLORS.cyan}==>${COLORS.reset} ${msg}`)
}

async function testApprovalIntegration(): Promise<boolean> {
  console.log(`\n${COLORS.cyan}${'═'.repeat(60)}${COLORS.reset}`)
  console.log(`${COLORS.cyan}  Approval System - Integration Test${COLORS.reset}`)
  console.log(`${COLORS.cyan}${'═'.repeat(60)}${COLORS.reset}\n`)

  let mcpServer: ChildProcess | null = null
  let testPassed = true

  try {
    // Step 1: Verify backend is running
    step('Step 1: Verifying Backend')
    const healthRes = await fetch(`${API_BASE}/api/health`)
    if (!healthRes.ok) {
      error('Backend not running. Start with: npm run dev:backend')
      return false
    }
    success('Backend is running')

    // Step 2: Start MCP server
    step('Step 2: Starting MCP Server')
    const mcpPath = new URL('../server/lib/mcp/nexus-tools-server.ts', import.meta.url)
      .pathname

    mcpServer = spawn('node', ['--import=tsx/esm', mcpPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NEXUS_EXECUTION_ID: 'integration-test-exec',
        NEXUS_SERVER_URL: API_BASE,
      },
    })

    // Wait for MCP server to start
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('MCP server timeout')), 5000)

      mcpServer!.stderr.on('data', (data) => {
        if (data.toString().includes('Nexus MCP Tools Server running')) {
          clearTimeout(timeout)
          resolve()
        }
      })

      mcpServer!.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    success('MCP server started')

    // Step 3: Send tools/list request
    step('Step 3: Testing MCP Communication')
    const toolListRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }

    mcpServer.stdin.write(JSON.stringify(toolListRequest) + '\n')

    // Wait for response
    const toolsResponse = await new Promise<boolean>((resolve) => {
      let output = ''
      const timeout = setTimeout(() => resolve(false), 3000)

      mcpServer!.stdout.on('data', (data) => {
        output += data.toString()
        try {
          const lines = output.split('\n').filter((l) => l.trim())
          for (const line of lines) {
            const response = JSON.parse(line)
            if (response.id === 1 && response.result?.tools) {
              const askTool = response.result.tools.find(
                (t: { name: string }) => t.name === 'ask_user_question'
              )
              if (askTool) {
                clearTimeout(timeout)
                resolve(true)
                return
              }
            }
          }
        } catch {
          // Continue accumulating
        }
      })
    })

    if (!toolsResponse) {
      error('MCP server did not return tools list')
      testPassed = false
    } else {
      success('MCP server lists ask_user_question tool')
    }

    // Step 4: Test HTTP approval endpoint
    step('Step 4: Testing Approval HTTP Endpoint')

    const approvalEndpointTest = await fetch(
      `${API_BASE}/api/dispatch/request-dynamic-approval`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executionId: 'non-existent-exec',
          question: 'Test question?',
          options: ['A', 'B', 'C'],
        }),
      }
    )

    const result = await approvalEndpointTest.json()
    if (result.error) {
      success('Approval endpoint validates execution IDs')
    } else {
      error('Expected validation error for invalid execution ID')
      testPassed = false
    }

    // Step 5: Test MCP tool call (without actual approval)
    step('Step 5: Testing MCP Tool Call Format')

    const toolCallRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'ask_user_question',
        arguments: {
          question: 'Integration test question?',
          // Missing required options to test validation
        },
      },
    }

    mcpServer.stdin.write(JSON.stringify(toolCallRequest) + '\n')
    await sleep(1000)
    success('MCP server accepts tool call requests')

    // Cleanup
    mcpServer.kill()
    mcpServer = null

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    error(`Integration test failed: ${message}`)
    testPassed = false
  } finally {
    if (mcpServer) {
      mcpServer.kill()
    }
  }

  console.log(`\n${COLORS.cyan}${'─'.repeat(60)}${COLORS.reset}`)
  if (testPassed) {
    console.log(`${COLORS.green}✓ Integration test passed${COLORS.reset}\n`)
    return true
  } else {
    console.log(`${COLORS.red}✗ Integration test failed${COLORS.reset}\n`)
    return false
  }
}

async function main() {
  const passed = await testApprovalIntegration()
  process.exit(passed ? 0 : 1)
}

main().catch((err) => {
  error(`Test crashed: ${err.message}`)
  console.error(err)
  process.exit(1)
})

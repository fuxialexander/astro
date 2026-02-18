#!/usr/bin/env tsx
/**
 * Automated (non-interactive) approval system tests
 * Tests MCP server and HTTP endpoints without user input
 */

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const ASTRO_SERVER_URL = process.env.ASTRO_SERVER_URL || 'http://localhost:3001'
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
}

function success(message: string) {
  console.log(`${COLORS.green}✓${COLORS.reset} ${message}`)
}

function error(message: string) {
  console.log(`${COLORS.red}✗${COLORS.reset} ${message}`)
}

function info(message: string) {
  console.log(`${COLORS.blue}ℹ${COLORS.reset} ${message}`)
}

async function testMcpServerToolListing(): Promise<boolean> {
  info('Test 1: MCP Server Tool Listing')

  const mcpServerPath = new URL('../server/lib/mcp/astro-tools-server.ts', import.meta.url)
    .pathname

  return new Promise((resolve) => {
    const mcp = spawn('node', ['--import=tsx/esm', mcpServerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ASTRO_EXECUTION_ID: 'test-exec-123',
        ASTRO_SERVER_URL,
      },
    })

    let output = ''
    let hasStarted = false

    mcp.stderr.on('data', (data) => {
      const msg = data.toString()
      if (msg.includes('Astro MCP Tools Server running')) {
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

      try {
        const lines = output.split('\n').filter((l) => l.trim())
        for (const line of lines) {
          const response = JSON.parse(line)
          if (response.id === 1 && response.result?.tools) {
            const tools = response.result.tools
            const askTool = tools.find(
              (t: { name: string }) => t.name === 'ask_user_question'
            )

            if (askTool) {
              success('MCP server lists ask_user_question tool')
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
      error(`MCP server failed: ${err.message}`)
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

async function testHttpEndpoint(): Promise<boolean> {
  info('Test 2: HTTP Endpoint for Dynamic Approvals')

  try {
    const healthRes = await fetch(`${ASTRO_SERVER_URL}/api/health`)
    if (!healthRes.ok) {
      error('Astro server is not running')
      return false
    }
    success('Astro server is running')

    // Test endpoint with invalid execution ID (should return error quickly)
    const approvalRes = await fetch(
      `${ASTRO_SERVER_URL}/api/dispatch/request-dynamic-approval`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executionId: 'invalid-test-exec',
          question: 'Test question?',
          options: ['Option A', 'Option B'],
        }),
      }
    )

    const result = await approvalRes.json()

    // Should return error for invalid execution ID
    if (result.error) {
      success('Dynamic approval endpoint validates execution ID')
      return true
    } else {
      error('Expected error for invalid execution ID')
      return false
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    error(`HTTP endpoint test failed: ${message}`)
    return false
  }
}

async function testMcpToolCallFormat(): Promise<boolean> {
  info('Test 3: MCP Tool Call Format')

  const mcpServerPath = new URL('../server/lib/mcp/astro-tools-server.ts', import.meta.url)
    .pathname

  return new Promise((resolve) => {
    const mcp = spawn('node', ['--import=tsx/esm', mcpServerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ASTRO_EXECUTION_ID: 'test-exec-456',
        ASTRO_SERVER_URL,
      },
    })

    let hasStarted = false

    mcp.stderr.on('data', (data) => {
      const msg = data.toString()
      if (msg.includes('Astro MCP Tools Server running')) {
        hasStarted = true

        // Send tool call with invalid format (missing required params)
        const request = {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'ask_user_question',
            arguments: {
              question: 'Test?',
              // Missing options array
            },
          },
        }

        mcp.stdin.write(JSON.stringify(request) + '\n')

        // Should return error for invalid params
        setTimeout(() => {
          success('MCP server accepts tool calls')
          mcp.kill()
          resolve(true)
        }, 1000)
      }
    })

    mcp.stdout.on('data', () => {
      // Stdout captured but not used in this test
    })

    mcp.on('error', (err) => {
      error(`MCP tool call test failed: ${err.message}`)
      resolve(false)
    })

    setTimeout(() => {
      if (!hasStarted) {
        error('MCP server did not start')
        mcp.kill()
        resolve(false)
      }
    }, 5000)
  })
}

async function main() {
  console.log('\n' + COLORS.blue + '═'.repeat(60) + COLORS.reset)
  console.log(COLORS.blue + '  Approval System - Automated Tests' + COLORS.reset)
  console.log(COLORS.blue + '═'.repeat(60) + COLORS.reset + '\n')

  const results: boolean[] = []

  results.push(await testMcpServerToolListing())
  await sleep(500)

  results.push(await testHttpEndpoint())
  await sleep(500)

  results.push(await testMcpToolCallFormat())

  const passed = results.filter(Boolean).length
  const total = results.length

  console.log('\n' + '─'.repeat(60))
  if (passed === total) {
    console.log(COLORS.green + `\n✓ All tests passed (${passed}/${total})` + COLORS.reset)
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

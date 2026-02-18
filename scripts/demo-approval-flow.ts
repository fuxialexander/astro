#!/usr/bin/env tsx
/**
 * Demo script to show how the approval flow works
 *
 * This demonstrates:
 * 1. How an agent would call ask_user_question via MCP
 * 2. How the approval request flows through the system
 * 3. How the user responds and execution continues
 *
 * Usage:
 *   tsx scripts/demo-approval-flow.ts
 */

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
}

function log(step: string, actor: string, message: string) {
  console.log(
    `${COLORS.dim}${step}${COLORS.reset} ${COLORS.bold}${actor}${COLORS.reset} ${message}`
  )
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function demo() {
  console.log('\n' + COLORS.cyan + '═'.repeat(70) + COLORS.reset)
  console.log(
    COLORS.cyan + COLORS.bold + '  Astro Approval System - How It Works' + COLORS.reset
  )
  console.log(COLORS.cyan + '═'.repeat(70) + COLORS.reset + '\n')

  // Step 1: Agent encounters a decision point
  log(
    '1.',
    COLORS.green + 'Agent:',
    'I need to decide which database to use for caching...'
  )
  await sleep(1000)

  log(
    '  ',
    COLORS.green + 'Agent:',
    'Let me ask the user for guidance using ask_user_question tool'
  )
  await sleep(1000)

  // Step 2: Agent calls MCP tool
  console.log('\n' + COLORS.dim + '─'.repeat(70) + COLORS.reset)
  console.log(COLORS.yellow + '  MCP Tool Call' + COLORS.reset)
  console.log(COLORS.dim + '─'.repeat(70) + COLORS.reset)
  console.log(
    COLORS.dim +
      `
{
  "name": "ask_user_question",
  "arguments": {
    "question": "Which database should we use for caching?",
    "options": [
      "Redis (fast, in-memory, requires separate service)",
      "SQLite (embedded, simple, slower at scale)",
      "PostgreSQL (consistent with main DB, more overhead)"
    ]
  }
}
`.trim() +
      COLORS.reset +
      '\n'
  )
  await sleep(1500)

  // Step 3: MCP server receives call
  log(
    '2.',
    COLORS.magenta + 'MCP Server:',
    'Received ask_user_question call, making HTTP request...'
  )
  await sleep(800)

  // Step 4: HTTP request to dispatch engine
  log(
    '3.',
    COLORS.cyan + 'Dispatch Engine:',
    'Creating approval request with ID: approval-tool-node123-...'
  )
  await sleep(800)

  // Step 5: Event emitted
  log('4.', COLORS.cyan + 'Event System:', 'Emitting approval.requested event')
  await sleep(800)

  log('  ', COLORS.cyan + 'Event System:', 'Broadcasting via SSE to browser...')
  await sleep(800)

  // Step 6: UI displays approval card
  console.log('\n' + COLORS.dim + '─'.repeat(70) + COLORS.reset)
  console.log(COLORS.yellow + '  User Interface (Browser)' + COLORS.reset)
  console.log(COLORS.dim + '─'.repeat(70) + COLORS.reset)
  console.log('\n  ' + COLORS.bold + 'Approval Required' + COLORS.reset)
  console.log('  Which database should we use for caching?\n')
  console.log('  ○ Redis (fast, in-memory, requires separate service)')
  console.log('  ○ SQLite (embedded, simple, slower at scale)')
  console.log('  ○ PostgreSQL (consistent with main DB, more overhead)\n')
  console.log('  [Cancel]  [Confirm]\n')
  await sleep(2000)

  // Step 7: User selects option
  log(
    '5.',
    COLORS.green + 'User:',
    'Selects "Redis" and clicks Confirm'
  )
  await sleep(800)

  // Step 8: POST to /api/dispatch/approve
  log('6.', COLORS.cyan + 'Frontend:', 'POST /api/dispatch/approve')
  await sleep(800)

  // Step 9: Dispatch engine resolves promise
  log(
    '7.',
    COLORS.cyan + 'Dispatch Engine:',
    'Resolving approval promise with: "Redis (fast, in-memory, requires separate service)"'
  )
  await sleep(800)

  // Step 10: HTTP response to MCP server
  log('8.', COLORS.magenta + 'MCP Server:', 'HTTP request completed with selected option')
  await sleep(800)

  // Step 11: Tool result returned to agent
  console.log('\n' + COLORS.dim + '─'.repeat(70) + COLORS.reset)
  console.log(COLORS.yellow + '  MCP Tool Result' + COLORS.reset)
  console.log(COLORS.dim + '─'.repeat(70) + COLORS.reset)
  console.log(
    COLORS.dim +
      `
{
  "content": [
    {
      "type": "text",
      "text": "User selected: Redis (fast, in-memory, requires separate service)"
    }
  ]
}
`.trim() +
      COLORS.reset +
      '\n'
  )
  await sleep(1500)

  // Step 12: Agent continues execution
  log(
    '9.',
    COLORS.green + 'Agent:',
    'Great! I\'ll proceed with Redis for the caching layer...'
  )
  await sleep(800)

  log('  ', COLORS.green + 'Agent:', 'Installing redis package...')
  await sleep(800)

  log('  ', COLORS.green + 'Agent:', 'Creating Redis client configuration...')
  await sleep(800)

  log('  ', COLORS.green + 'Agent:', 'Writing tests for caching layer...')
  await sleep(800)

  // Success
  console.log('\n' + COLORS.dim + '─'.repeat(70) + COLORS.reset)
  console.log(COLORS.green + '✓ Task completed successfully!' + COLORS.reset)
  console.log(COLORS.dim + '─'.repeat(70) + COLORS.reset + '\n')

  // Key points
  console.log(COLORS.cyan + 'Key Points:' + COLORS.reset)
  console.log('  • Agent execution pauses at ask_user_question tool call')
  console.log('  • User sees approval card in Dashboard or Task Detail page')
  console.log('  • User selection is returned to agent as tool result')
  console.log('  • Agent continues with user\'s choice')
  console.log('  • Timeout: 5 minutes (configurable)\n')

  // Files involved
  console.log(COLORS.cyan + 'Files Involved:' + COLORS.reset)
  console.log('  • server/lib/mcp/astro-tools-server.ts - MCP server')
  console.log('  • server/lib/dispatch/dispatch-engine.ts - Approval logic')
  console.log('  • server/routes/dispatch.ts - HTTP endpoints')
  console.log('  • server/routes/events.ts - SSE event streaming')
  console.log('  • src/components/approval-card.tsx - UI component')
  console.log('  • src/stores/execution-store.ts - State management\n')
}

demo().catch(console.error)

/**
 * PR 2 — Provider Threading
 *
 * Verifies that `providerId` from request bodies is threaded through
 * to `preferredProvider` in RelayTaskDispatch objects for all streaming
 * and non-streaming pathways in agent.ts.
 *
 * Also audits ALL 11 AI pathways for provider threading completeness
 * and verifies PR1 renames are clean (no stale old names in code).
 *
 * Part of issue #668: Simplified AI Pathways (16 → 11).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve, join } from 'path'

const ROOT = resolve(__dirname, '..')
const AGENT_TS = resolve(ROOT, 'server/routes/agent.ts')
const DISPATCH_TS = resolve(ROOT, 'server/routes/dispatch.ts')
const RELAY_TYPES = resolve(ROOT, 'server/types/relay.ts')
const API_CLIENT = resolve(ROOT, 'src/lib/api-client.ts')

const agentSource = readFileSync(AGENT_TS, 'utf-8')
const dispatchSource = readFileSync(DISPATCH_TS, 'utf-8')
const relayTypes = readFileSync(RELAY_TYPES, 'utf-8')
const apiClient = readFileSync(API_CLIENT, 'utf-8')

// ═══════════════════════════════════════════════════════════════════════
// Part A: streamChatViaRelay — provider threading
// ═══════════════════════════════════════════════════════════════════════

describe('streamChatViaRelay preferredProvider threading', () => {
  const fnMatch = agentSource.match(
    /async function streamChatViaRelay\s*\([^)]*\n\s*opts:\s*\{([\s\S]*?)\}\s*\)/
  )

  it('opts type includes preferredProvider field', () => {
    expect(fnMatch).toBeTruthy()
    expect(fnMatch![1]).toContain('preferredProvider')
  })

  it('opts type declares preferredProvider as optional string', () => {
    expect(fnMatch![1]).toMatch(/preferredProvider\?:\s*string/)
  })

  it('RelayTaskDispatch sets preferredProvider from opts', () => {
    const fnBody = agentSource.slice(
      agentSource.indexOf('async function streamChatViaRelay'),
      agentSource.indexOf('async function executeViaRelay')
    )
    expect(fnBody).toContain('preferredProvider: opts.preferredProvider')
  })

  it('casts preferredProvider to ProviderType', () => {
    const fnBody = agentSource.slice(
      agentSource.indexOf('async function streamChatViaRelay'),
      agentSource.indexOf('async function executeViaRelay')
    )
    expect(fnBody).toMatch(/preferredProvider:\s*opts\.preferredProvider\s+as\s+ProviderType/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part B: executeViaRelay — provider threading
// ═══════════════════════════════════════════════════════════════════════

describe('executeViaRelay preferredProvider threading', () => {
  const fnMatch = agentSource.match(
    /async function executeViaRelay\s*\(\s*opts:\s*\{([\s\S]*?)\}\s*\)/
  )

  it('opts type includes preferredProvider field', () => {
    expect(fnMatch).toBeTruthy()
    expect(fnMatch![1]).toContain('preferredProvider')
  })

  it('opts type declares preferredProvider as optional string', () => {
    expect(fnMatch![1]).toMatch(/preferredProvider\?:\s*string/)
  })

  it('RelayTaskDispatch sets preferredProvider from opts', () => {
    const fnStart = agentSource.indexOf('async function executeViaRelay')
    const fnEnd = agentSource.indexOf('const agentRoute')
    const fnBody = agentSource.slice(fnStart, fnEnd)
    expect(fnBody).toContain('preferredProvider: opts.preferredProvider')
  })

  it('casts preferredProvider to ProviderType', () => {
    const fnStart = agentSource.indexOf('async function executeViaRelay')
    const fnEnd = agentSource.indexOf('const agentRoute')
    const fnBody = agentSource.slice(fnStart, fnEnd)
    expect(fnBody).toMatch(/preferredProvider:\s*opts\.preferredProvider\s+as\s+ProviderType/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part C: All 11 Pathway Audit — Provider Threading
// ═══════════════════════════════════════════════════════════════════════

describe('P1-4: dispatch.ts pathways (Task Execution, Playground, Interactive Plan, HPC)', () => {
  it('dispatch schema accepts preferredProvider', () => {
    expect(dispatchSource).toMatch(/preferredProvider:\s*z\.string/)
  })

  it('dispatch handler destructures preferredProvider from body', () => {
    // Find the POST /task handler and check it destructures preferredProvider
    const taskHandler = dispatchSource.slice(
      dispatchSource.indexOf("dispatchRoute.post('/task'"),
      dispatchSource.indexOf('async function dispatchViaRelay')
    )
    expect(taskHandler).toContain('preferredProvider')
  })

  it('dispatchViaRelay params type includes preferredProvider', () => {
    const fnBody = dispatchSource.slice(
      dispatchSource.indexOf('async function dispatchViaRelay'),
      dispatchSource.indexOf('async function dispatchViaRelay') + 3000
    )
    expect(fnBody).toMatch(/preferredProvider\?:\s*ProviderType/)
  })

  it('relay task dispatch object includes preferredProvider', () => {
    // The RelayTaskDispatch object built in dispatchViaRelay should set preferredProvider
    expect(dispatchSource).toMatch(/preferredProvider,/)
  })
})

describe('P5: /project-chat provider threading', () => {
  const handlerStart = agentSource.indexOf("agentRoute.post('/project-chat'")
  const handlerEnd = agentSource.indexOf("const taskChatSchema")
  const handler = agentSource.slice(handlerStart, handlerEnd)

  it('chatSchema includes providerId field', () => {
    const schemaStart = agentSource.indexOf('const chatSchema')
    const schemaEnd = agentSource.indexOf('async function streamChatViaRelay')
    const schema = agentSource.slice(schemaStart, schemaEnd)
    expect(schema).toMatch(/providerId:\s*z\.string\(\)\.max\(100\)\.optional\(\)/)
  })

  it('destructures providerId from body', () => {
    expect(handler).toMatch(/const\s*\{[^}]*providerId[^}]*\}\s*=\s*body/)
  })

  it('passes preferredProvider: providerId || undefined to streamChatViaRelay', () => {
    expect(handler).toMatch(/preferredProvider:\s*providerId\s*\|\|\s*undefined/)
  })
})

describe('P6: /task-chat provider threading', () => {
  const handlerStart = agentSource.indexOf("agentRoute.post('/task-chat'")
  const handlerEnd = agentSource.indexOf("agentRoute.post('/abort'")
  const handler = agentSource.slice(handlerStart, handlerEnd)

  it('taskChatSchema includes providerId field', () => {
    const schemaStart = agentSource.indexOf('const taskChatSchema')
    const schemaEnd = agentSource.indexOf("agentRoute.post('/task-chat'")
    const schema = agentSource.slice(schemaStart, schemaEnd)
    expect(schema).toMatch(/providerId:\s*z\.string\(\)/)
  })

  it('destructures providerId from body', () => {
    expect(handler).toContain('providerId,')
  })

  it('passes preferredProvider: providerId || undefined to streamChatViaRelay', () => {
    expect(handler).toMatch(/preferredProvider:\s*providerId\s*\|\|\s*undefined/)
  })
})

describe('P7-10: One-shot pathways (summarize, title-gen, refine, labels)', () => {
  // These pathways now accept optional providerId from the request body
  // and thread it through to executeViaRelay as preferredProvider.

  it('/summarize accepts providerId and threads it to executeViaRelay', () => {
    const handler = agentSource.slice(
      agentSource.indexOf("agentRoute.post('/summarize'"),
      agentSource.indexOf("agentRoute.post('/generate-title'")
    )
    expect(handler).toContain('providerId')
    expect(handler).toContain('executeViaRelay')
    expect(handler).toContain('preferredProvider')
  })

  it('/generate-title accepts providerId and threads it to executeViaRelay', () => {
    const handler = agentSource.slice(
      agentSource.indexOf("agentRoute.post('/generate-title'"),
      agentSource.indexOf("agentRoute.post('/refine'")
    )
    expect(handler).toContain('providerId')
    expect(handler).toContain('executeViaRelay')
    expect(handler).toContain('preferredProvider')
  })

  it('/refine accepts providerId via Zod schema and threads it to executeViaRelay', () => {
    const handler = agentSource.slice(
      agentSource.indexOf("agentRoute.post('/refine'"),
      agentSource.indexOf("agentRoute.post('/suggest-labels'")
    )
    expect(handler).toMatch(/providerId:\s*z\.string/)
    expect(handler).toContain('executeViaRelay')
    expect(handler).toContain('preferredProvider')
  })

  it('/suggest-labels accepts providerId via Zod schema and threads it to executeViaRelay', () => {
    const handler = agentSource.slice(
      agentSource.indexOf("agentRoute.post('/suggest-labels'"),
      agentSource.indexOf("agentRoute.get('/providers'")
    )
    expect(handler).toMatch(/providerId:\s*z\.string/)
    expect(handler).toContain('executeViaRelay')
    expect(handler).toContain('preferredProvider')
  })
})

describe('P11: Steering (no AI invocation)', () => {
  it('/abort route exists and does NOT invoke AI or relay dispatch', () => {
    const handler = agentSource.slice(
      agentSource.indexOf("agentRoute.post('/abort'"),
      agentSource.indexOf("const dispatchTaskSchema")
    )
    expect(handler).toContain('cancelTask')
    expect(handler).not.toContain('streamChatViaRelay')
    expect(handler).not.toContain('executeViaRelay')
  })
})

describe('Agent.ts /dispatch route provider threading', () => {
  const schemaStart = agentSource.lastIndexOf(
    'const dispatchTaskSchema',
    agentSource.indexOf("agentRoute.post('/dispatch'")
  )
  const handlerStart = agentSource.indexOf("agentRoute.post('/dispatch'")
  const handlerEnd = agentSource.indexOf("agentRoute.post('/summarize'")
  const handler = agentSource.slice(handlerStart, handlerEnd)
  const schema = agentSource.slice(schemaStart, handlerStart)

  it('dispatchTaskSchema includes providerId field', () => {
    expect(schema).toMatch(/providerId:\s*z\.string/)
  })

  it('handler destructures providerId from body', () => {
    expect(handler).toContain('providerId,')
  })

  it('passes preferredProvider: providerId || undefined to streamChatViaRelay', () => {
    expect(handler).toMatch(/preferredProvider:\s*providerId\s*\|\|\s*undefined/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part D: Relay Type Verification
// ═══════════════════════════════════════════════════════════════════════

describe('Relay type: TaskDispatch', () => {
  it('TaskDispatch interface includes preferredProvider field', () => {
    expect(relayTypes).toMatch(/preferredProvider\?:\s*ProviderType/)
  })

  it('ProviderType is exported', () => {
    expect(relayTypes).toMatch(/export type ProviderType\s*=/)
  })
})

describe('ProviderType import in agent.ts', () => {
  it('imports ProviderType from relay types', () => {
    expect(agentSource).toMatch(/import type\s*\{[^}]*ProviderType[^}]*\}\s*from\s*['"]\.\.\/types\/relay/)
  })

  it('does NOT use inline import() for ProviderType cast', () => {
    // Should use the imported ProviderType, not inline import('../types/relay.js').ProviderType
    expect(agentSource).not.toContain("import('../types/relay.js').ProviderType")
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part E: Frontend API Client Type Completeness
// ═══════════════════════════════════════════════════════════════════════

describe('Frontend API client: projectChatWithAgent', () => {
  it('params type includes providerId', () => {
    // The inline params type for projectChatWithAgent should include providerId
    const fnStart = apiClient.indexOf('export async function projectChatWithAgent')
    const fnBodyStart = apiClient.indexOf('): Promise<void>', fnStart)
    const paramsBlock = apiClient.slice(fnStart, fnBodyStart)
    expect(paramsBlock).toContain('providerId')
  })

  it('sends to /api/agent/project-chat endpoint', () => {
    expect(apiClient).toContain('/api/agent/project-chat')
  })
})

describe('Frontend API client: chatWithTask (TaskChatParams)', () => {
  it('TaskChatParams includes providerId field', () => {
    const typeStart = apiClient.indexOf('export interface TaskChatParams')
    const typeEnd = apiClient.indexOf('}', typeStart)
    const typeBody = apiClient.slice(typeStart, typeEnd)
    expect(typeBody).toContain('providerId')
  })

  it('sends to /api/agent/task-chat endpoint', () => {
    expect(apiClient).toContain('/api/agent/task-chat')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part F: Relay Server Consumption — preferredProvider is actually used
// ═══════════════════════════════════════════════════════════════════════

describe('Relay server uses preferredProvider for machine selection', () => {
  const relayServer = readFileSync(resolve(ROOT, 'server/lib/relay-server.ts'), 'utf-8')

  it('dispatchTask passes task.preferredProvider to findBestMachine', () => {
    expect(relayServer).toContain('task.preferredProvider')
    expect(relayServer).toContain('findBestMachine')
  })

  it('falls back to any machine if preferred provider unavailable', () => {
    expect(relayServer).toMatch(/if\s*\(\s*!bestMachine\s*&&\s*task\.preferredProvider\s*\)/)
  })
})

describe('Machine registry findBestMachine accepts provider filter', () => {
  const machineReg = readFileSync(resolve(ROOT, 'server/lib/machine-registry.ts'), 'utf-8')

  it('findBestMachine accepts preferredProvider parameter', () => {
    expect(machineReg).toMatch(/findBestMachine\s*\(\s*preferredProvider/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part G: PR1 Rename Verification — No Stale Old Names in Code
// ═══════════════════════════════════════════════════════════════════════

describe('PR1 renames: no stale old names in src/', () => {
  const srcFiles = [
    'src/lib/api-client.ts',
    'src/stores/execution-store.ts',
    'src/components/agent/chat-panel.tsx',
    'src/pages/project-new-plan.tsx',
    'src/pages/dashboard.tsx',
    'src/pages/playground.tsx',
  ]

  for (const file of srcFiles) {
    const fullPath = join(ROOT, file)
    if (!existsSync(fullPath)) continue
    const source = readFileSync(fullPath, 'utf-8')

    it(`${file}: no 'planChatWithAgent' reference`, () => {
      expect(source).not.toContain('planChatWithAgent')
    })

    it(`${file}: no 'chatWithAgent(' function call`, () => {
      expect(source).not.toMatch(/\bchatWithAgent\s*\(/)
    })

    it(`${file}: no '/plan-chat' route reference`, () => {
      expect(source).not.toMatch(/['"]\/(?:api\/agent\/)?plan-chat['"]/)
    })

    it(`${file}: no 'plan-session/' import path`, () => {
      expect(source).not.toContain('plan-session/')
    })
  }
})

describe('PR1 renames: no stale old names in server/', () => {
  const serverFiles = [
    'server/routes/agent.ts',
    'server/routes/dispatch.ts',
  ]

  for (const file of serverFiles) {
    const source = readFileSync(join(ROOT, file), 'utf-8')

    it(`${file}: no '/plan-chat' route`, () => {
      expect(source).not.toMatch(/\.post\s*\(\s*['"]\/plan-chat['"]/)
    })

    it(`${file}: no '/chat' route (old project chat)`, () => {
      // /project-chat should exist, but not bare /chat
      expect(source).not.toMatch(/\.post\s*\(\s*['"]\/chat['"]/)
    })

    it(`${file}: no retryPlanExtraction reference`, () => {
      expect(source).not.toContain('retryPlanExtraction')
    })

    it(`${file}: no generateServerSideSummary reference`, () => {
      expect(source).not.toContain('generateServerSideSummary')
    })
  }
})

describe('PR1 renames: deleted files are gone', () => {
  it('plan-extraction-retry.ts is deleted', () => {
    expect(existsSync(join(ROOT, 'packages/core/src/plan-extraction-retry.ts'))).toBe(false)
  })

  it('task-chat.tsx component is deleted', () => {
    expect(existsSync(join(ROOT, 'src/components/task-detail/task-chat.tsx'))).toBe(false)
  })

  it('plan-session/ directory is gone', () => {
    expect(existsSync(join(ROOT, 'src/components/plan-session'))).toBe(false)
  })

  it('plan-generation/ directory exists', () => {
    expect(existsSync(join(ROOT, 'src/components/plan-generation'))).toBe(true)
  })
})

describe('PR1 renames: packages/core index has no stale exports', () => {
  const coreIndex = readFileSync(join(ROOT, 'packages/core/src/index.ts'), 'utf-8')

  it('no retryPlanExtraction export', () => {
    expect(coreIndex).not.toContain('retryPlanExtraction')
  })

  it('no plan-extraction-retry import', () => {
    expect(coreIndex).not.toContain('plan-extraction-retry')
  })
})

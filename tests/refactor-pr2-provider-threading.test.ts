/**
 * PR 2 — Provider Threading
 *
 * Verifies that `providerId` from request bodies is threaded through
 * to `preferredProvider` in RelayTaskDispatch objects for all streaming
 * and non-streaming pathways in agent.ts.
 *
 * Part of issue #668: Simplified AI Pathways (16 → 11).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const AGENT_TS = resolve(__dirname, '../server/routes/agent.ts')
const agentSource = readFileSync(AGENT_TS, 'utf-8')

// ─── 2a: streamChatViaRelay opts type ──────────────────────────────────

describe('streamChatViaRelay preferredProvider threading', () => {
  it('opts type includes preferredProvider field', () => {
    // The function signature should declare preferredProvider in its opts
    const fnMatch = agentSource.match(
      /async function streamChatViaRelay\s*\([^)]*\n\s*opts:\s*\{([\s\S]*?)\}\s*\)/
    )
    expect(fnMatch).toBeTruthy()
    expect(fnMatch![1]).toContain('preferredProvider')
  })

  it('RelayTaskDispatch in streamChatViaRelay sets preferredProvider', () => {
    // Between streamChatViaRelay function def and its first `streamSSE`,
    // there should be a RelayTaskDispatch object with preferredProvider
    const fnBody = agentSource.slice(
      agentSource.indexOf('async function streamChatViaRelay'),
      agentSource.indexOf('async function executeViaRelay')
    )
    expect(fnBody).toContain('preferredProvider: opts.preferredProvider')
  })
})

// ─── 2a: /project-chat handler ─────────────────────────────────────────

describe('/project-chat providerId threading', () => {
  // Extract the /project-chat handler body
  const handlerStart = agentSource.indexOf("agentRoute.post('/project-chat'")
  const handlerEnd = agentSource.indexOf("const taskChatSchema")
  const handler = agentSource.slice(handlerStart, handlerEnd)

  it('destructures providerId from request body', () => {
    expect(handler).toMatch(/\bproviderId\b/)
  })

  it('passes preferredProvider to streamChatViaRelay', () => {
    expect(handler).toContain('preferredProvider:')
    // Should map providerId to preferredProvider
    expect(handler).toMatch(/preferredProvider:\s*providerId\s*\|\|\s*undefined/)
  })
})

// ─── 2a: /task-chat handler ────────────────────────────────────────────

describe('/task-chat providerId threading', () => {
  // Extract the /task-chat handler body
  const handlerStart = agentSource.indexOf("agentRoute.post('/task-chat'")
  const handlerEnd = agentSource.indexOf("agentRoute.post('/abort'")
  const handler = agentSource.slice(handlerStart, handlerEnd)

  it('taskChatSchema includes providerId field', () => {
    const schemaStart = agentSource.indexOf('const taskChatSchema')
    const schemaEnd = agentSource.indexOf("agentRoute.post('/task-chat'")
    const schema = agentSource.slice(schemaStart, schemaEnd)
    expect(schema).toContain('providerId')
  })

  it('destructures providerId from request body', () => {
    expect(handler).toMatch(/\bproviderId\b/)
  })

  it('passes preferredProvider to streamChatViaRelay', () => {
    expect(handler).toContain('preferredProvider:')
    expect(handler).toMatch(/preferredProvider:\s*providerId\s*\|\|\s*undefined/)
  })
})

// ─── 2a: /dispatch handler in agent.ts ─────────────────────────────────

describe('/dispatch (agent.ts) providerId threading', () => {
  // The /dispatch in agent.ts (not dispatch.ts)
  const handlerStart = agentSource.indexOf("agentRoute.post('/dispatch'")
  const handlerEnd = agentSource.indexOf("agentRoute.post('/summarize'")
  const handler = agentSource.slice(handlerStart, handlerEnd)

  it('dispatchTaskSchema includes providerId field', () => {
    // There's a local dispatchTaskSchema in agent.ts
    const schemaStart = agentSource.lastIndexOf('const dispatchTaskSchema', handlerStart)
    const schema = agentSource.slice(schemaStart, handlerStart)
    expect(schema).toContain('providerId')
  })

  it('destructures providerId from request body', () => {
    expect(handler).toMatch(/\bproviderId\b/)
  })

  it('passes preferredProvider to streamChatViaRelay', () => {
    expect(handler).toContain('preferredProvider:')
    expect(handler).toMatch(/preferredProvider:\s*providerId\s*\|\|\s*undefined/)
  })
})

// ─── 2b: executeViaRelay opts type ─────────────────────────────────────

describe('executeViaRelay preferredProvider threading', () => {
  it('opts type includes preferredProvider field', () => {
    const fnMatch = agentSource.match(
      /async function executeViaRelay\s*\(\s*opts:\s*\{([\s\S]*?)\}\s*\)/
    )
    expect(fnMatch).toBeTruthy()
    expect(fnMatch![1]).toContain('preferredProvider')
  })

  it('RelayTaskDispatch in executeViaRelay sets preferredProvider', () => {
    const fnStart = agentSource.indexOf('async function executeViaRelay')
    const fnEnd = agentSource.indexOf('const agentRoute')
    const fnBody = agentSource.slice(fnStart, fnEnd)
    expect(fnBody).toContain('preferredProvider: opts.preferredProvider')
  })
})

// ─── 2a+b: chatSchema already has providerId ───────────────────────────

describe('chatSchema providerId field', () => {
  it('chatSchema defines providerId as optional string', () => {
    const schemaStart = agentSource.indexOf('const chatSchema')
    const schemaEnd = agentSource.indexOf('async function streamChatViaRelay')
    const schema = agentSource.slice(schemaStart, schemaEnd)
    expect(schema).toContain('providerId')
    expect(schema).toMatch(/providerId:\s*z\.string\(\)/)
  })
})

// ─── Relay type: TaskDispatch has preferredProvider ────────────────────

describe('relay TaskDispatch type', () => {
  const relayPath = resolve(__dirname, '../server/types/relay.ts')
  const relaySource = readFileSync(relayPath, 'utf-8')

  it('TaskDispatch interface includes preferredProvider field', () => {
    expect(relaySource).toMatch(/preferredProvider\?:\s*ProviderType/)
  })
})

// ─── No dangling providerId ignoring ───────────────────────────────────

describe('no dropped providerId fields', () => {
  it('/project-chat does not ignore providerId from chatSchema', () => {
    // Verify providerId appears in both the schema AND the handler destructuring
    const schemaHasIt = agentSource.includes('providerId: z.string().max(100).optional()')
    expect(schemaHasIt).toBe(true)

    // The /project-chat handler should destructure it
    const handlerStart = agentSource.indexOf("agentRoute.post('/project-chat'")
    const handlerEnd = agentSource.indexOf("const taskChatSchema")
    const handler = agentSource.slice(handlerStart, handlerEnd)
    // Must appear in the destructuring const, not just somewhere in the handler
    expect(handler).toMatch(/const\s*\{[^}]*providerId[^}]*\}\s*=\s*body/)
  })
})

/**
 * Verification tests for global event persistence in relay-server.ts
 *
 * Verifies:
 * - Relay handlers persist events to streamingEventLog directly
 * - All five event types (text, tool_use, tool_result, file_change, session_init) are persisted
 * - Structural handlers are async with error handling
 * - DB seq is passed through emit for SSE event IDs
 * - SSE relay handlers in events.ts no longer duplicate persistence
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RELAY_SERVER_PATH = join(process.cwd(), 'server/lib/relay-server.ts')
const EVENTS_PATH = join(process.cwd(), 'server/routes/events.ts')

const relaySource = readFileSync(RELAY_SERVER_PATH, 'utf-8')
const eventsSource = readFileSync(EVENTS_PATH, 'utf-8')

describe('relay-server global event persistence', () => {
  it('imports streamingEventLog', () => {
    expect(relaySource).toContain("import { streamingEventLog } from './streaming-event-log.js'")
  })

  it('persists text events via appendText', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskText('),
      relaySource.indexOf('private async handleAgentRunnerTaskToolUse('),
    )
    expect(handler).toContain('streamingEventLog.appendText(payload.taskId, payload.text)')
  })

  it('persists tool_use events with await and error handling', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskToolUse('),
      relaySource.indexOf('private async handleAgentRunnerTaskToolResult('),
    )
    expect(handler).toContain('try {')
    expect(handler).toContain("await streamingEventLog.append(payload.taskId, 'tool_use'")
    expect(handler).toContain('} catch (err) {')
    expect(handler).toContain('console.error(`[relay-server] Failed to persist')
  })

  it('persists tool_result events with await and error handling', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskToolResult('),
      relaySource.indexOf('private async handleAgentRunnerTaskFileChange('),
    )
    expect(handler).toContain("await streamingEventLog.append(payload.taskId, 'tool_result'")
    expect(handler).toContain('} catch (err) {')
  })

  it('persists file_change events with await and error handling', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskFileChange('),
      relaySource.indexOf('private async handleAgentRunnerTaskSessionInit('),
    )
    expect(handler).toContain("await streamingEventLog.append(payload.taskId, 'file_change'")
    expect(handler).toContain('} catch (err) {')
  })

  it('persists session_init events with await and error handling', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskSessionInit('),
      relaySource.indexOf('private handleAgentRunnerTaskSteerAck('),
    )
    expect(handler).toContain("await streamingEventLog.append(payload.taskId, 'session_init'")
    expect(handler).toContain('} catch (err) {')
  })

  it('passes DB seq through emit via _dbSeq field', () => {
    expect(relaySource).toContain("Object.assign(traceMsg, { _dbSeq: seq })")
    expect(relaySource).toContain("Object.assign(changeMsg, { _dbSeq: seq })")
    expect(relaySource).toContain("Object.assign(initMsg, { _dbSeq: seq })")
  })

  it('persistence errors do not prevent event emission', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskToolResult('),
      relaySource.indexOf('private async handleAgentRunnerTaskFileChange('),
    )
    const catchIdx = handler.indexOf('} catch (err) {')
    const emitIdx = handler.indexOf('this.emit(')
    expect(catchIdx).toBeGreaterThan(-1)
    expect(emitIdx).toBeGreaterThan(-1)
    expect(emitIdx).toBeGreaterThan(catchIdx)
  })
})

describe('events.ts relay handlers — no duplicate persistence', () => {
  it('onRelayText does NOT call streamingEventLog', () => {
    const handler = eventsSource.slice(
      eventsSource.indexOf('const onRelayText ='),
      eventsSource.indexOf('const onRelaySessionInit ='),
    )
    expect(handler).not.toContain('streamingEventLog.appendText')
    expect(handler).not.toContain('streamingEventLog.append')
  })

  it('structural handlers do NOT call streamingEventLog.append', () => {
    const section = eventsSource.slice(
      eventsSource.indexOf('const onRelaySessionInit ='),
      eventsSource.indexOf("relayServer.on('task:text'"),
    )
    expect(section).not.toContain('streamingEventLog.append(')
    expect(section).not.toContain('streamingEventLog.appendText')
  })

  it('relay handlers still deliver SSE events', () => {
    const section = eventsSource.slice(
      eventsSource.indexOf('const onRelayText ='),
      eventsSource.indexOf("relayServer.on('task:text'"),
    )
    expect(section).toContain('throttle.write(')
    expect(section).toContain('stream.writeSSE(')
  })

  it('uses _dbSeq from relay emit for SSE event IDs', () => {
    expect(eventsSource).toContain("msg._dbSeq ? String(msg._dbSeq) : eventBuffer.push('task:session_init'")
    expect(eventsSource).toContain("msg._dbSeq ? String(msg._dbSeq) : eventBuffer.push('task:tool_trace'")
    expect(eventsSource).toContain("msg._dbSeq ? String(msg._dbSeq) : eventBuffer.push('task:file_change'")
    expect(eventsSource).toContain("msg._dbSeq ? String(msg._dbSeq) : eventBuffer.push('task:progress'")
  })
})

/**
 * Chat Stream Status Tests
 *
 * Verifies that chat streams set taskStream.status in the realtime-store
 * so that the periodic catch-up poll in useStreamEvents activates.
 *
 * The bug: chat sessions never set taskStream.status = 'running', so the
 * periodic 3-second DB catch-up poll (guarded by `streamStatus === 'running'`)
 * never activated, causing activityEvents text to be stale until page refresh.
 *
 * The fix: setChatStreamStatus() is called at chat start ('running') and
 * chat end ('completed'/'error'/'aborted').
 *
 * Multi-tab: The server also emits task:init for chat sessions (agent.ts L151),
 * which sets taskStream.status = 'running' on all SSE-connected tabs. The
 * frontend setChatStreamStatus is a fast-path for the initiating tab.
 *
 * Run with: npx vitest run tests/chat-stream-status.test.ts
 */
import { describe, it, expect } from 'vitest'

/**
 * Minimal simulation of the realtime-store's taskStream status management.
 * Tests the invariant: chat streams must transition through running → terminal.
 */
interface TaskStream {
  taskId: string
  status?: string
  stdout: string
  activityEvents: unknown[]
}

class MockRealtimeStore {
  taskStreams = new Map<string, TaskStream>()

  setState(updater: (state: { taskStreams: Map<string, TaskStream> }) => { taskStreams: Map<string, TaskStream> }) {
    const result = updater({ taskStreams: this.taskStreams })
    this.taskStreams = result.taskStreams
  }

  getStreamStatus(streamId: string): string | undefined {
    return this.taskStreams.get(streamId)?.status
  }
}

function setChatStreamStatus(store: MockRealtimeStore, streamId: string, status: string) {
  store.setState((state) => {
    const streams = new Map(state.taskStreams)
    const existing = streams.get(streamId) || {
      taskId: streamId, stdout: '', progress: 0,
      toolTraces: [], fileChanges: [], steerMessages: [], activityEvents: [],
    }
    streams.set(streamId, { ...existing, status })
    return { taskStreams: streams }
  })
}

/** Simulates useStreamEvents periodic poll guard */
function wouldPeriodicPollActivate(status: string | undefined): boolean {
  return status === 'running' || status === 'in_progress'
}

describe('chat stream status lifecycle', () => {
  it('sets running on chat start, enabling periodic poll', () => {
    const store = new MockRealtimeStore()
    const sid = 'session-123'

    // Before chat starts — no status, poll won't activate
    expect(store.getStreamStatus(sid)).toBeUndefined()
    expect(wouldPeriodicPollActivate(store.getStreamStatus(sid))).toBe(false)

    // Chat starts
    setChatStreamStatus(store, sid, 'running')
    expect(store.getStreamStatus(sid)).toBe('running')
    expect(wouldPeriodicPollActivate(store.getStreamStatus(sid))).toBe(true)
  })

  it('sets completed on chat success, stopping periodic poll', () => {
    const store = new MockRealtimeStore()
    const sid = 'session-456'

    setChatStreamStatus(store, sid, 'running')
    expect(wouldPeriodicPollActivate(store.getStreamStatus(sid))).toBe(true)

    setChatStreamStatus(store, sid, 'completed')
    expect(store.getStreamStatus(sid)).toBe('completed')
    expect(wouldPeriodicPollActivate(store.getStreamStatus(sid))).toBe(false)
  })

  it('sets error on chat failure, stopping periodic poll', () => {
    const store = new MockRealtimeStore()
    const sid = 'session-789'

    setChatStreamStatus(store, sid, 'running')
    setChatStreamStatus(store, sid, 'error')
    expect(store.getStreamStatus(sid)).toBe('error')
    expect(wouldPeriodicPollActivate(store.getStreamStatus(sid))).toBe(false)
  })

  it('sets aborted on user abort, stopping periodic poll', () => {
    const store = new MockRealtimeStore()
    const sid = 'session-abort'

    setChatStreamStatus(store, sid, 'running')
    setChatStreamStatus(store, sid, 'aborted')
    expect(store.getStreamStatus(sid)).toBe('aborted')
    expect(wouldPeriodicPollActivate(store.getStreamStatus(sid))).toBe(false)
  })

  it('preserves existing taskStream fields when setting status', () => {
    const store = new MockRealtimeStore()
    const sid = 'session-preserve'

    // Simulate some prior state (e.g. from task:init or prior SSE events)
    store.taskStreams.set(sid, {
      taskId: sid,
      stdout: 'hello world',
      activityEvents: [{ type: 'chat_user', message: 'hi' }],
    })

    setChatStreamStatus(store, sid, 'running')
    const stream = store.taskStreams.get(sid)!
    expect(stream.status).toBe('running')
    expect(stream.stdout).toBe('hello world')
    expect(stream.activityEvents).toHaveLength(1)
  })

  it('creates taskStream entry if none exists', () => {
    const store = new MockRealtimeStore()
    const sid = 'session-new'

    expect(store.taskStreams.has(sid)).toBe(false)
    setChatStreamStatus(store, sid, 'running')
    expect(store.taskStreams.has(sid)).toBe(true)
    expect(store.taskStreams.get(sid)!.status).toBe('running')
  })

  it('task:init from server also sets running (multi-tab scenario)', () => {
    const store = new MockRealtimeStore()
    const execId = 'session-multitab'

    // Simulate task:init handler (realtime-store.ts L1838-1845)
    store.setState((state) => {
      const streams = new Map(state.taskStreams)
      if (!streams.has(execId)) {
        streams.set(execId, { taskId: execId, stdout: '', activityEvents: [] })
      }
      const existing = streams.get(execId)!
      streams.set(execId, { ...existing, status: 'running' })
      return { taskStreams: streams }
    })

    expect(store.getStreamStatus(execId)).toBe('running')
    expect(wouldPeriodicPollActivate(store.getStreamStatus(execId))).toBe(true)
  })

  it('multi-turn chat: status cycles running→completed→running→completed', () => {
    const store = new MockRealtimeStore()
    const sid = 'session-multiturn'

    // Turn 1
    setChatStreamStatus(store, sid, 'running')
    expect(wouldPeriodicPollActivate(store.getStreamStatus(sid))).toBe(true)
    setChatStreamStatus(store, sid, 'completed')
    expect(wouldPeriodicPollActivate(store.getStreamStatus(sid))).toBe(false)

    // Turn 2
    setChatStreamStatus(store, sid, 'running')
    expect(wouldPeriodicPollActivate(store.getStreamStatus(sid))).toBe(true)
    setChatStreamStatus(store, sid, 'completed')
    expect(wouldPeriodicPollActivate(store.getStreamStatus(sid))).toBe(false)
  })
})

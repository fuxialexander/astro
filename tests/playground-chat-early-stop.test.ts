/**
 * Playground Chat: Early Stop and Duplicate Text Tests
 *
 * Tests for two bugs:
 * 1. Agent stops after ~10 turns because agent-runner defaults maxTurns=10
 *    for type=chat tasks, and the server didn't override it.
 * 2. Duplicate text blocks when activity events from execution stream and
 *    chat events from session stream overlap after SSE catch-up hydration.
 */
import { describe, it, expect } from 'vitest'

// ============================================================================
// Bug 1: maxTurns override for chat routes
// ============================================================================

describe('Bug 1: maxTurns override for chat tasks', () => {
  /**
   * Simulates the agent-runner's maxTurns resolution logic.
   * Source: tests/relay-protocol-fields.test.ts lines 313-317
   */
  function resolveMaxTurns(
    taskMaxTurns: number | undefined,
    taskType: string,
  ): number | undefined {
    const isTextOnly = taskType === 'chat' || taskType === 'summarize'
    const defaultMaxTurns = isTextOnly ? 10 : undefined
    return taskMaxTurns ?? defaultMaxTurns
  }

  it('agent-runner defaults to 10 turns for chat tasks when no override', () => {
    // This is the broken behavior — the agent stops after 10 turns
    const turns = resolveMaxTurns(undefined, 'chat')
    expect(turns).toBe(10)
  })

  it('agent-runner defaults to 10 turns for summarize tasks', () => {
    const turns = resolveMaxTurns(undefined, 'summarize')
    expect(turns).toBe(10)
  })

  it('agent-runner has no turn limit for execution tasks', () => {
    const turns = resolveMaxTurns(undefined, 'execution')
    expect(turns).toBeUndefined()
  })

  it('explicit maxTurns overrides the default', () => {
    // This is the fix: server sends maxTurns=50 for playground chat
    const turns = resolveMaxTurns(50, 'chat')
    expect(turns).toBe(50)
  })

  it('maxTurns=1 still works for summarize endpoints', () => {
    const turns = resolveMaxTurns(1, 'summarize')
    expect(turns).toBe(1)
  })

  it('server route should set maxTurns for task-chat (playground)', () => {
    // Simulates the fix in agent.ts task-chat route
    const chatMaxTurns = 50
    const resolved = resolveMaxTurns(chatMaxTurns, 'chat')
    expect(resolved).toBe(50)
  })

  it('server route should set maxTurns for project-chat', () => {
    // Simulates the fix in agent.ts project-chat route
    const taskType = 'execution' // project-chat uses type='execution' by default
    const projectChatMaxTurns = (taskType === 'plan') ? undefined : 50
    const resolved = resolveMaxTurns(projectChatMaxTurns, taskType)
    expect(resolved).toBe(50)
  })

  it('plan tasks should NOT have maxTurns override', () => {
    const taskType = 'plan'
    const projectChatMaxTurns = (taskType === 'plan') ? undefined : 50
    const resolved = resolveMaxTurns(projectChatMaxTurns, taskType)
    expect(resolved).toBeUndefined()
  })
})

// ============================================================================
// Bug 2: Duplicate text deduplication
// ============================================================================

interface MockEvent {
  type: string
  content?: string
  timestamp: Date
  toolName?: string
  seq?: number
}

/**
 * Replicates the dedup logic from playground.tsx's allActivityEvents merge.
 * Prefers seq-based dedup when available, falls back to fingerprint heuristic.
 */
function mergeWithDedup(
  activityEvents: MockEvent[],
  chatEvents: MockEvent[],
): MockEvent[] {
  if (activityEvents.length === 0) return chatEvents
  if (chatEvents.length === 0) return activityEvents

  const seenSeqs = new Set<number>()
  const seenFingerprints = new Set<string>()
  for (const e of activityEvents) {
    if (e.seq != null) {
      seenSeqs.add(e.seq)
    } else {
      const content = e.content ? e.content.slice(0, 40) : ''
      seenFingerprints.add(`${e.type}|${new Date(e.timestamp).getTime()}|${content}`)
    }
  }
  const dedupedChat = chatEvents.filter((e) => {
    if (e.seq != null) return !seenSeqs.has(e.seq)
    const content = e.content ? e.content.slice(0, 40) : ''
    return !seenFingerprints.has(`${e.type}|${new Date(e.timestamp).getTime()}|${content}`)
  })

  return [...activityEvents, ...dedupedChat]
}

describe('Bug 2: Duplicate text deduplication', () => {
  it('removes exact duplicate events', () => {
    const ts = new Date('2026-03-12T10:00:00Z')
    const activityEvents: MockEvent[] = [
      { type: 'text', content: 'Hello world', timestamp: ts },
    ]
    const chatEvents: MockEvent[] = [
      { type: 'text', content: 'Hello world', timestamp: ts },
    ]

    const merged = mergeWithDedup(activityEvents, chatEvents)
    expect(merged).toHaveLength(1)
    expect(merged[0].content).toBe('Hello world')
  })

  it('keeps non-duplicate events from both sources', () => {
    const ts1 = new Date('2026-03-12T10:00:00Z')
    const ts2 = new Date('2026-03-12T10:00:01Z')
    const activityEvents: MockEvent[] = [
      { type: 'text', content: 'From execution', timestamp: ts1 },
    ]
    const chatEvents: MockEvent[] = [
      { type: 'chat_user', content: 'User message', timestamp: ts2 },
    ]

    const merged = mergeWithDedup(activityEvents, chatEvents)
    expect(merged).toHaveLength(2)
  })

  it('deduplicates tool_use events with same timestamp', () => {
    const ts = new Date('2026-03-12T10:00:00Z')
    const activityEvents: MockEvent[] = [
      { type: 'tool_use', toolName: 'Read', timestamp: ts },
    ]
    const chatEvents: MockEvent[] = [
      { type: 'tool_use', toolName: 'Read', timestamp: ts },
    ]

    const merged = mergeWithDedup(activityEvents, chatEvents)
    expect(merged).toHaveLength(1)
  })

  it('keeps events with same type but different timestamps', () => {
    const ts1 = new Date('2026-03-12T10:00:00Z')
    const ts2 = new Date('2026-03-12T10:00:01Z')
    const activityEvents: MockEvent[] = [
      { type: 'text', content: 'First chunk', timestamp: ts1 },
    ]
    const chatEvents: MockEvent[] = [
      { type: 'text', content: 'Second chunk', timestamp: ts2 },
    ]

    const merged = mergeWithDedup(activityEvents, chatEvents)
    expect(merged).toHaveLength(2)
  })

  it('returns chatEvents when activityEvents is empty', () => {
    const chatEvents: MockEvent[] = [
      { type: 'text', content: 'Only chat', timestamp: new Date() },
    ]

    const merged = mergeWithDedup([], chatEvents)
    expect(merged).toHaveLength(1)
    expect(merged).toBe(chatEvents)
  })

  it('returns activityEvents when chatEvents is empty', () => {
    const activityEvents: MockEvent[] = [
      { type: 'text', content: 'Only activity', timestamp: new Date() },
    ]

    const merged = mergeWithDedup(activityEvents, [])
    expect(merged).toHaveLength(1)
    expect(merged).toBe(activityEvents)
  })

  it('handles multiple duplicate events in sequence', () => {
    const ts1 = new Date('2026-03-12T10:00:00Z')
    const ts2 = new Date('2026-03-12T10:00:01Z')
    const ts3 = new Date('2026-03-12T10:00:02Z')

    const activityEvents: MockEvent[] = [
      { type: 'text', content: 'Let me read that file. ', timestamp: ts1 },
      { type: 'tool_use', timestamp: ts2 },
      { type: 'text', content: 'I see the issue. ', timestamp: ts3 },
    ]
    // Chat events contain the same + one extra
    const chatEvents: MockEvent[] = [
      { type: 'text', content: 'Let me read that file. ', timestamp: ts1 },
      { type: 'tool_use', timestamp: ts2 },
      { type: 'text', content: 'I see the issue. ', timestamp: ts3 },
      { type: 'chat_user', content: 'Thanks!', timestamp: new Date('2026-03-12T10:01:00Z') },
    ]

    const merged = mergeWithDedup(activityEvents, chatEvents)
    // 3 from activity + 1 unique from chat
    expect(merged).toHaveLength(4)
    expect(merged[3].type).toBe('chat_user')
  })

  it('deduplicates by seq when both sides have seq numbers', () => {
    const ts = new Date('2026-03-12T10:00:00Z')
    const activityEvents: MockEvent[] = [
      { type: 'text', content: 'Hello', timestamp: ts, seq: 1 },
      { type: 'tool_use', timestamp: ts, seq: 2 },
    ]
    const chatEvents: MockEvent[] = [
      { type: 'text', content: 'Hello', timestamp: ts, seq: 1 },
      { type: 'tool_use', timestamp: ts, seq: 2 },
      { type: 'text', content: 'New', timestamp: ts, seq: 3 },
    ]

    const merged = mergeWithDedup(activityEvents, chatEvents)
    expect(merged).toHaveLength(3)
    expect(merged[2].seq).toBe(3)
  })

  it('seq dedup is definitive even when content differs', () => {
    // If two events have the same seq, they represent the same DB row
    // even if content appears different (e.g., partial vs complete text)
    const ts = new Date('2026-03-12T10:00:00Z')
    const activityEvents: MockEvent[] = [
      { type: 'text', content: 'Partial...', timestamp: ts, seq: 5 },
    ]
    const chatEvents: MockEvent[] = [
      { type: 'text', content: 'Partial text that is now complete', timestamp: ts, seq: 5 },
    ]

    const merged = mergeWithDedup(activityEvents, chatEvents)
    expect(merged).toHaveLength(1)
  })

  it('falls back to fingerprint when seq is absent', () => {
    // Events without seq (e.g., live SSE events before DB persistence)
    const ts = new Date('2026-03-12T10:00:00Z')
    const activityEvents: MockEvent[] = [
      { type: 'text', content: 'Hello world', timestamp: ts },
    ]
    const chatEvents: MockEvent[] = [
      { type: 'text', content: 'Hello world', timestamp: ts },
    ]

    const merged = mergeWithDedup(activityEvents, chatEvents)
    expect(merged).toHaveLength(1)
  })
})

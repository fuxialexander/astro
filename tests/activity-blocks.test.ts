/**
 * Unit tests for groupActivityEvents() from activity-blocks.tsx.
 *
 * Tests the logic that groups a flat list of TaskActivityEvents into
 * DisplayBlocks for rendering: consecutive text events merge, consecutive
 * tool events form tool_groups (or single tool blocks), and standalone
 * event types (steer, file_change, error, chat_*, approval_*) each get
 * their own block.
 *
 * Run with: npx vitest run tests/activity-blocks.test.ts
 */

import { describe, it, expect } from 'vitest'
import { groupActivityEvents, getToolInputSummary, getToolStatus } from '../src/components/activity-blocks'
import type { TaskActivityEvent } from '../packages/core/src/types'

// ─── Helpers ──────────────────────────────────────────────────────────

function textEvent(content: string): TaskActivityEvent {
  return { type: 'text', content, timestamp: new Date() }
}

function toolUseEvent(id: string, toolName: string, toolInput?: unknown): TaskActivityEvent {
  return { type: 'tool_use', id, toolName, toolInput: toolInput ?? {}, timestamp: new Date() }
}

function toolResultEvent(id: string, toolName: string, opts?: { success?: boolean; duration?: number; toolResult?: unknown }): TaskActivityEvent {
  return {
    type: 'tool_result',
    id,
    toolName,
    toolResult: opts?.toolResult ?? 'ok',
    success: opts?.success ?? true,
    duration: opts?.duration,
    timestamp: new Date(),
  }
}

function steerEvent(message: string): TaskActivityEvent {
  return { type: 'steer', message, timestamp: new Date() }
}

function fileChangeEvent(path: string): TaskActivityEvent {
  return { type: 'file_change', path, action: 'modified', timestamp: new Date() }
}

function errorEvent(error: string): TaskActivityEvent {
  return { type: 'error', error, timestamp: new Date() }
}

function chatUserEvent(message: string): TaskActivityEvent {
  return { type: 'chat_user', message, timestamp: new Date() }
}

function chatAssistantEvent(content: string): TaskActivityEvent {
  return { type: 'chat_assistant', content, timestamp: new Date() }
}

function approvalRequestEvent(requestId: string, question: string): TaskActivityEvent {
  return { type: 'approval_request', requestId, question, options: ['yes', 'no'], timestamp: new Date() }
}

function approvalResponseEvent(requestId: string, answer: string): TaskActivityEvent {
  return { type: 'approval_response', requestId, question: 'proceed?', answer, timestamp: new Date() }
}

function githubCommentEvent(login: string, body: string, commentType: 'issue_comment' | 'review_comment' = 'issue_comment'): TaskActivityEvent {
  return {
    type: 'github_comment',
    commentId: Math.floor(Math.random() * 100000),
    author: { login, avatar: `https://github.com/${login}.png` },
    body,
    commentType,
    timestamp: new Date(),
  }
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('groupActivityEvents', () => {
  describe('empty input', () => {
    it('should return empty array for empty events', () => {
      expect(groupActivityEvents([])).toEqual([])
    })
  })

  describe('text event grouping', () => {
    it('should group consecutive text events into a single text block', () => {
      const events = [textEvent('hello '), textEvent('world')]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('text')
      expect(blocks[0].events).toHaveLength(2)
      expect(blocks[0].events[0]).toEqual(events[0])
      expect(blocks[0].events[1]).toEqual(events[1])
    })

    it('should create separate text blocks when interrupted by non-text events', () => {
      const events = [
        textEvent('before'),
        steerEvent('do something'),
        textEvent('after'),
      ]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(3)
      expect(blocks[0].type).toBe('text')
      expect(blocks[0].events).toHaveLength(1)
      expect(blocks[1].type).toBe('steer')
      expect(blocks[2].type).toBe('text')
      expect(blocks[2].events).toHaveLength(1)
    })

    it('should handle a single text event', () => {
      const blocks = groupActivityEvents([textEvent('solo')])

      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('text')
      expect(blocks[0].events).toHaveLength(1)
    })
  })

  describe('tool event grouping', () => {
    it('should create a single tool block for one tool_use + tool_result pair', () => {
      const events = [
        toolUseEvent('t1', 'Read'),
        toolResultEvent('t1', 'Read'),
      ]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('tool')
      expect(blocks[0].events).toHaveLength(2)
    })

    it('should create a tool_group block for multiple consecutive tool pairs', () => {
      const events = [
        toolUseEvent('t1', 'Read'),
        toolResultEvent('t1', 'Read'),
        toolUseEvent('t2', 'Bash'),
        toolResultEvent('t2', 'Bash'),
      ]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('tool_group')
      expect(blocks[0].events).toHaveLength(4)
    })

    it('should create a tool block for a tool_use without a matching result', () => {
      const events = [toolUseEvent('t1', 'Read')]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('tool')
      expect(blocks[0].events).toHaveLength(1)
    })

    it('should group tool_use events without results into a tool_group when multiple', () => {
      const events = [
        toolUseEvent('t1', 'Read'),
        toolUseEvent('t2', 'Bash'),
      ]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('tool_group')
      expect(blocks[0].events).toHaveLength(2)
    })

    it('should flush tool buffer when text event appears', () => {
      const events = [
        toolUseEvent('t1', 'Read'),
        toolResultEvent('t1', 'Read'),
        textEvent('thinking...'),
      ]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(2)
      expect(blocks[0].type).toBe('tool')
      expect(blocks[1].type).toBe('text')
    })

    it('should flush text buffer when tool event appears', () => {
      const events = [
        textEvent('thinking...'),
        toolUseEvent('t1', 'Read'),
        toolResultEvent('t1', 'Read'),
      ]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(2)
      expect(blocks[0].type).toBe('text')
      expect(blocks[1].type).toBe('tool')
    })

    it('should pair tool_result with the correct tool_use by id', () => {
      const events = [
        toolUseEvent('t1', 'Read'),
        toolUseEvent('t2', 'Read'),
        toolResultEvent('t2', 'Read'),
        toolResultEvent('t1', 'Read'),
      ]
      const blocks = groupActivityEvents(events)

      // All consecutive tool events go into one tool_group
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('tool_group')
      expect(blocks[0].events).toHaveLength(4)
    })
  })

  describe('standalone event types', () => {
    it('should create individual blocks for steer events', () => {
      const events = [steerEvent('fix the bug'), steerEvent('also add tests')]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(2)
      expect(blocks[0].type).toBe('steer')
      expect(blocks[0].events).toHaveLength(1)
      expect(blocks[1].type).toBe('steer')
      expect(blocks[1].events).toHaveLength(1)
    })

    it('should create individual blocks for file_change events', () => {
      const events = [fileChangeEvent('/src/a.ts'), fileChangeEvent('/src/b.ts')]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(2)
      expect(blocks[0].type).toBe('file_change')
      expect(blocks[1].type).toBe('file_change')
    })

    it('should create individual blocks for error events', () => {
      const blocks = groupActivityEvents([errorEvent('something failed')])

      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('error')
      expect(blocks[0].events).toHaveLength(1)
    })

    it('should create individual blocks for chat_user events', () => {
      const blocks = groupActivityEvents([chatUserEvent('what happened?')])

      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('chat_user')
    })

    it('should create individual blocks for chat_assistant events', () => {
      const blocks = groupActivityEvents([chatAssistantEvent('I fixed the bug.')])

      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('chat_assistant')
    })

    it('should create individual blocks for approval_request events', () => {
      const blocks = groupActivityEvents([approvalRequestEvent('req-1', 'proceed?')])

      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('approval_request')
    })

    it('should create individual blocks for approval_response events', () => {
      const blocks = groupActivityEvents([approvalResponseEvent('req-1', 'yes')])

      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('approval_response')
    })
  })

  describe('flushing behavior', () => {
    it('should flush pending text before standalone events', () => {
      const events = [
        textEvent('thinking'),
        steerEvent('hurry up'),
      ]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(2)
      expect(blocks[0].type).toBe('text')
      expect(blocks[1].type).toBe('steer')
    })

    it('should flush pending tools before standalone events', () => {
      const events = [
        toolUseEvent('t1', 'Read'),
        toolResultEvent('t1', 'Read'),
        errorEvent('crash'),
      ]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(2)
      expect(blocks[0].type).toBe('tool')
      expect(blocks[1].type).toBe('error')
    })

    it('should flush both text and tools at end of events', () => {
      // text at end
      const textBlocks = groupActivityEvents([textEvent('trailing')])
      expect(textBlocks).toHaveLength(1)
      expect(textBlocks[0].type).toBe('text')

      // tools at end
      const toolBlocks = groupActivityEvents([
        toolUseEvent('t1', 'Bash'),
        toolResultEvent('t1', 'Bash'),
      ])
      expect(toolBlocks).toHaveLength(1)
      expect(toolBlocks[0].type).toBe('tool')
    })

    it('should flush text before tool events and tools before text events', () => {
      const events = [
        textEvent('first'),
        toolUseEvent('t1', 'Read'),
        toolResultEvent('t1', 'Read'),
        textEvent('second'),
      ]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(3)
      expect(blocks[0].type).toBe('text')
      expect(blocks[1].type).toBe('tool')
      expect(blocks[2].type).toBe('text')
    })
  })

  describe('mixed event sequences', () => {
    it('should handle a realistic agent session sequence', () => {
      const events: TaskActivityEvent[] = [
        textEvent('Let me look at the code.'),
        toolUseEvent('t1', 'Read', { file_path: '/src/main.ts' }),
        toolResultEvent('t1', 'Read', { toolResult: 'file contents' }),
        textEvent('I see the issue. Let me fix it.'),
        toolUseEvent('t2', 'Edit', { file_path: '/src/main.ts' }),
        toolResultEvent('t2', 'Edit'),
        toolUseEvent('t3', 'Bash', { command: 'npm test' }),
        toolResultEvent('t3', 'Bash'),
        fileChangeEvent('/src/main.ts'),
        textEvent('Done! The tests pass.'),
      ]
      const blocks = groupActivityEvents(events)

      // Walkthrough:
      // textEvent -> currentTextEvents
      // tool_use('Read') -> flushText() -> text block #1, push to currentToolEvents
      // tool_result('Read') -> push to currentToolEvents
      // textEvent -> flushTools() -> 1 tool_use -> tool block #2, push to currentTextEvents
      // tool_use('Edit') -> flushText() -> text block #3, push to currentToolEvents
      // tool_result('Edit') -> push to currentToolEvents
      // tool_use('Bash') -> push to currentToolEvents
      // tool_result('Bash') -> push to currentToolEvents
      // file_change -> flushText(empty), flushTools() -> 2 tool_uses -> tool_group #4, file_change #5
      // textEvent -> push to currentTextEvents
      // end: flushText() -> text block #6
      expect(blocks).toHaveLength(6)
      expect(blocks[0].type).toBe('text')
      expect(blocks[1].type).toBe('tool')
      expect(blocks[2].type).toBe('text')
      expect(blocks[3].type).toBe('tool_group')
      expect(blocks[4].type).toBe('file_change')
      expect(blocks[5].type).toBe('text')
    })

    it('should handle chat conversation interleaved with tools', () => {
      const events: TaskActivityEvent[] = [
        chatUserEvent('What is in main.ts?'),
        chatAssistantEvent('Let me check.'),
        toolUseEvent('t1', 'Read'),
        toolResultEvent('t1', 'Read'),
        textEvent('The file contains...'),
      ]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(4)
      expect(blocks[0].type).toBe('chat_user')
      expect(blocks[1].type).toBe('chat_assistant')
      expect(blocks[2].type).toBe('tool')
      expect(blocks[3].type).toBe('text')
    })

    it('should handle approval flow', () => {
      const events: TaskActivityEvent[] = [
        textEvent('I need your approval.'),
        approvalRequestEvent('req-1', 'Should I deploy?'),
        approvalResponseEvent('req-1', 'yes'),
        textEvent('Deploying now.'),
      ]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(4)
      expect(blocks[0].type).toBe('text')
      expect(blocks[1].type).toBe('approval_request')
      expect(blocks[2].type).toBe('approval_response')
      expect(blocks[3].type).toBe('text')
    })

    it('should handle all standalone types in sequence without merging', () => {
      const events: TaskActivityEvent[] = [
        steerEvent('do A'),
        fileChangeEvent('/a.ts'),
        errorEvent('oops'),
        chatUserEvent('help'),
        chatAssistantEvent('ok'),
        approvalRequestEvent('r1', 'continue?'),
        approvalResponseEvent('r1', 'yes'),
      ]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(7)
      expect(blocks.map(b => b.type)).toEqual([
        'steer', 'file_change', 'error', 'chat_user',
        'chat_assistant', 'approval_request', 'approval_response',
      ])
      // Each standalone block has exactly 1 event
      blocks.forEach(block => {
        expect(block.events).toHaveLength(1)
      })
    })

    it('should create individual blocks for github_comment events', () => {
      const events = [
        githubCommentEvent('user1', 'Looks good!'),
        githubCommentEvent('user2', 'LGTM', 'review_comment'),
      ]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(2)
      expect(blocks[0].type).toBe('github_comment')
      expect(blocks[0].events).toHaveLength(1)
      expect(blocks[1].type).toBe('github_comment')
      expect(blocks[1].events).toHaveLength(1)
    })

    it('should interleave github_comment blocks with other events', () => {
      const events: TaskActivityEvent[] = [
        textEvent('Working on it...'),
        githubCommentEvent('reviewer', 'Please add tests'),
        textEvent('Added tests.'),
      ]
      const blocks = groupActivityEvents(events)

      expect(blocks).toHaveLength(3)
      expect(blocks[0].type).toBe('text')
      expect(blocks[1].type).toBe('github_comment')
      expect(blocks[2].type).toBe('text')
    })
  })

  describe('block events are copies', () => {
    it('should not share references between blocks for text events', () => {
      const events = [
        textEvent('a'),
        steerEvent('break'),
        textEvent('b'),
      ]
      const blocks = groupActivityEvents(events)

      // The text block events arrays should be independent
      expect(blocks[0].events).not.toBe(blocks[2].events)
    })
  })
})

describe('getToolInputSummary', () => {
  it('should extract file path suffix for Read', () => {
    expect(getToolInputSummary('Read', { file_path: '/home/user/project/src/main.ts' }))
      .toBe('src/main.ts')
  })

  it('should extract file path suffix for Write', () => {
    expect(getToolInputSummary('Write', { file_path: '/a/b/c.ts' }))
      .toBe('b/c.ts')
  })

  it('should extract file path suffix for Edit', () => {
    expect(getToolInputSummary('Edit', { file_path: '/x/y.ts' }))
      .toBe('x/y.ts')
  })

  it('should extract pattern for Glob', () => {
    expect(getToolInputSummary('Glob', { pattern: '**/*.ts' }))
      .toBe('**/*.ts')
  })

  it('should extract pattern wrapped in slashes for Grep', () => {
    expect(getToolInputSummary('Grep', { pattern: 'TODO' }))
      .toBe('/TODO/')
  })

  it('should extract command (truncated to 60 chars) for Bash', () => {
    const shortCmd = 'npm test'
    expect(getToolInputSummary('Bash', { command: shortCmd })).toBe('npm test')

    const longCmd = 'a'.repeat(100)
    expect(getToolInputSummary('Bash', { command: longCmd })).toBe('a'.repeat(60))
  })

  it('should extract description for Task', () => {
    expect(getToolInputSummary('Task', { description: 'find the bug' }))
      .toBe('find the bug')
  })

  it('should extract url for WebFetch', () => {
    expect(getToolInputSummary('WebFetch', { url: 'https://example.com' }))
      .toBe('https://example.com')
  })

  it('should return null for unknown tool names', () => {
    expect(getToolInputSummary('UnknownTool', { foo: 'bar' })).toBeNull()
  })

  it('should return null for null/undefined input', () => {
    expect(getToolInputSummary('Read', null)).toBeNull()
    expect(getToolInputSummary('Read', undefined)).toBeNull()
  })

  it('should return null for non-object input', () => {
    expect(getToolInputSummary('Read', 'string')).toBeNull()
    expect(getToolInputSummary('Read', 42)).toBeNull()
  })

  it('should return null when expected field is missing', () => {
    expect(getToolInputSummary('Read', { other: 'value' })).toBeNull()
  })

  it('should return null when expected field is not a string', () => {
    expect(getToolInputSummary('Read', { file_path: 123 })).toBeNull()
    expect(getToolInputSummary('Bash', { command: false })).toBeNull()
  })
})

describe('getToolStatus', () => {
  it('should show spinner when running without result', () => {
    const s = getToolStatus(false, true)
    expect(s.icon).toBe('spinner')
    expect(s.isComplete).toBe(false)
    expect(s.colorClass).toBe('text-info')
  })

  it('should show check with success color when result is successful', () => {
    const s = getToolStatus(true, true, true)
    expect(s.icon).toBe('check')
    expect(s.isComplete).toBe(true)
    expect(s.colorClass).toBe('text-success')
  })

  it('should show x when result failed', () => {
    const s = getToolStatus(true, true, false)
    expect(s.icon).toBe('x')
    expect(s.isComplete).toBe(true)
    expect(s.colorClass).toBe('text-muted-foreground')
  })

  it('should show check-muted when result has no success field', () => {
    const s = getToolStatus(true, true, undefined)
    expect(s.icon).toBe('check-muted')
    expect(s.isComplete).toBe(true)
    expect(s.colorClass).toBe('text-muted-foreground')
  })

  it('should show check-muted when task stopped without result (no perpetual spinner)', () => {
    const s = getToolStatus(false, false)
    expect(s.icon).toBe('check-muted')
    expect(s.isComplete).toBe(true)
    expect(s.colorClass).toBe('text-muted-foreground')
  })

  it('should never return spinner when isRunning=false', () => {
    for (const hasResult of [true, false]) {
      for (const success of [true, false, undefined]) {
        const s = getToolStatus(hasResult, false, success)
        expect(s.icon).not.toBe('spinner')
        expect(s.isComplete).toBe(true)
      }
    }
  })
})

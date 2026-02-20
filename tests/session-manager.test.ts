/**
 * Session Manager Unit Tests
 *
 * Tests the server-side session manager that tracks active agent sessions,
 * abort controllers, and provider metadata.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createSession,
  getSession,
  updateSession,
  abortSession,
  removeSession,
  hasSession,
  getAllSessions,
  getSessionsByProvider,
  getActiveSessionCount,
  abortSessionsByProvider,
  abortAllSessions,
  cleanupStaleSessions,
  getSessionStats,
} from '../server/lib/session-manager.js'

// Clean up between tests
beforeEach(() => {
  abortAllSessions()
})

describe('Session Manager', () => {
  describe('createSession', () => {
    it('creates a session and returns an AbortController', () => {
      const controller = createSession('test-1', 'claude-code')
      expect(controller).toBeInstanceOf(AbortController)
      expect(controller.signal.aborted).toBe(false)
    })

    it('stores the session with correct metadata', () => {
      createSession('test-2', 'claude-code', {
        taskType: 'chat',
        projectId: 'proj-1',
      })

      const session = getSession('test-2')
      expect(session).toBeDefined()
      expect(session!.providerId).toBe('claude-code')
      expect(session!.taskType).toBe('chat')
      expect(session!.projectId).toBe('proj-1')
      expect(session!.createdAt).toBeInstanceOf(Date)
    })

    it('overwrites existing session with same ID', () => {
      createSession('test-dup', 'provider-a')
      createSession('test-dup', 'provider-b')

      const session = getSession('test-dup')
      expect(session!.providerId).toBe('provider-b')
      expect(getActiveSessionCount()).toBe(1)
    })
  })

  describe('getSession / hasSession', () => {
    it('returns undefined for non-existent session', () => {
      expect(getSession('no-such')).toBeUndefined()
      expect(hasSession('no-such')).toBe(false)
    })

    it('returns true for existing session', () => {
      createSession('exists', 'p')
      expect(hasSession('exists')).toBe(true)
    })
  })

  describe('updateSession', () => {
    it('updates session metadata', () => {
      createSession('upd-1', 'p')
      const result = updateSession('upd-1', { sessionId: 'provider-session-xyz' })
      expect(result).toBe(true)

      const session = getSession('upd-1')
      expect(session!.sessionId).toBe('provider-session-xyz')
    })

    it('returns false for non-existent session', () => {
      expect(updateSession('no-such', { sessionId: 'x' })).toBe(false)
    })
  })

  describe('abortSession', () => {
    it('aborts the controller and removes the session', () => {
      const controller = createSession('abort-1', 'p')
      expect(abortSession('abort-1')).toBe(true)
      expect(controller.signal.aborted).toBe(true)
      expect(hasSession('abort-1')).toBe(false)
    })

    it('returns false for non-existent session', () => {
      expect(abortSession('no-such')).toBe(false)
    })
  })

  describe('removeSession', () => {
    it('removes session without aborting', () => {
      const controller = createSession('rm-1', 'p')
      removeSession('rm-1')
      expect(hasSession('rm-1')).toBe(false)
      expect(controller.signal.aborted).toBe(false)
    })
  })

  describe('getAllSessions', () => {
    it('returns all active sessions as a copy', () => {
      createSession('a', 'p')
      createSession('b', 'p')
      createSession('c', 'q')

      const all = getAllSessions()
      expect(all.size).toBe(3)
      // Verify it's a copy
      all.delete('a')
      expect(getActiveSessionCount()).toBe(3)
    })
  })

  describe('getSessionsByProvider', () => {
    it('filters by provider ID', () => {
      createSession('s1', 'claude-code')
      createSession('s2', 'codex')
      createSession('s3', 'claude-code')

      const claude = getSessionsByProvider('claude-code')
      expect(claude).toHaveLength(2)

      const codex = getSessionsByProvider('codex')
      expect(codex).toHaveLength(1)
    })
  })

  describe('abortSessionsByProvider', () => {
    it('aborts only sessions for the specified provider', () => {
      const c1 = createSession('s1', 'claude-code')
      const c2 = createSession('s2', 'codex')
      const c3 = createSession('s3', 'claude-code')

      const count = abortSessionsByProvider('claude-code')
      expect(count).toBe(2)
      expect(c1.signal.aborted).toBe(true)
      expect(c3.signal.aborted).toBe(true)
      expect(c2.signal.aborted).toBe(false)
      expect(getActiveSessionCount()).toBe(1)
    })
  })

  describe('cleanupStaleSessions', () => {
    it('removes sessions older than maxAge', async () => {
      createSession('old', 'p')
      // Wait a bit
      await new Promise((r) => setTimeout(r, 50))
      createSession('new', 'p')

      const cleaned = cleanupStaleSessions(25) // 25ms
      expect(cleaned).toBe(1)
      expect(hasSession('old')).toBe(false)
      expect(hasSession('new')).toBe(true)
    })
  })

  describe('getSessionStats', () => {
    it('returns correct statistics', () => {
      createSession('s1', 'claude-code', { taskType: 'chat' })
      createSession('s2', 'codex', { taskType: 'code_generation' })
      createSession('s3', 'claude-code', { taskType: 'chat' })

      const stats = getSessionStats()
      expect(stats.total).toBe(3)
      expect(stats.byProvider['claude-code']).toBe(2)
      expect(stats.byProvider['codex']).toBe(1)
      expect(stats.byTaskType['chat']).toBe(2)
      expect(stats.byTaskType['code_generation']).toBe(1)
      expect(stats.oldestSession).toBeInstanceOf(Date)
    })
  })
})

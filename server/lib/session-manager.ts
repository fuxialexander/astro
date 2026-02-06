/**
 * Session Manager
 *
 * Manages active agent sessions, including abort controllers and provider metadata.
 * Extended to support the provider abstraction layer.
 */

/**
 * Session metadata stored for active sessions.
 */
export interface SessionData {
  /** Abort controller for cancellation */
  abortController: AbortController
  /** Provider ID that is executing this session */
  providerId?: string
  /** Provider-specific session ID (for session resumption) */
  sessionId?: string
  /** When the session was created */
  createdAt: Date
  /** Task type being executed */
  taskType?: string
  /** Project ID associated with this session */
  projectId?: string
}

const activeSessions = new Map<string, SessionData>()

/**
 * Create a new session with an abort controller.
 * Returns the abort controller for use with provider execution.
 */
export function createSession(
  sessionId: string,
  providerId?: string,
  metadata?: Partial<Pick<SessionData, 'taskType' | 'projectId'>>
): AbortController {
  const abortController = new AbortController()

  activeSessions.set(sessionId, {
    abortController,
    providerId,
    createdAt: new Date(),
    ...metadata,
  })

  return abortController
}

/**
 * Get session data by ID.
 */
export function getSession(sessionId: string): SessionData | undefined {
  return activeSessions.get(sessionId)
}

/**
 * Update session metadata.
 */
export function updateSession(
  sessionId: string,
  updates: Partial<Omit<SessionData, 'abortController' | 'createdAt'>>
): boolean {
  const session = activeSessions.get(sessionId)
  if (!session) {
    return false
  }

  // Apply updates
  Object.assign(session, updates)
  return true
}

/**
 * Abort a session by ID.
 * Returns true if the session was found and aborted.
 */
export function abortSession(sessionId: string): boolean {
  const session = activeSessions.get(sessionId)
  if (session) {
    session.abortController.abort()
    activeSessions.delete(sessionId)
    return true
  }
  return false
}

/**
 * Remove a session from tracking (without aborting).
 * Call this when a session completes normally.
 */
export function removeSession(sessionId: string): void {
  activeSessions.delete(sessionId)
}

/**
 * Check if a session exists.
 */
export function hasSession(sessionId: string): boolean {
  return activeSessions.has(sessionId)
}

/**
 * Get all active sessions.
 */
export function getAllSessions(): Map<string, SessionData> {
  return new Map(activeSessions)
}

/**
 * Get sessions for a specific provider.
 */
export function getSessionsByProvider(providerId: string): SessionData[] {
  return Array.from(activeSessions.values()).filter(
    (session) => session.providerId === providerId
  )
}

/**
 * Get count of active sessions.
 */
export function getActiveSessionCount(): number {
  return activeSessions.size
}

/**
 * Abort all sessions for a specific provider.
 * Useful when a provider becomes unavailable.
 */
export function abortSessionsByProvider(providerId: string): number {
  let abortedCount = 0

  for (const [sessionId, session] of activeSessions.entries()) {
    if (session.providerId === providerId) {
      session.abortController.abort()
      activeSessions.delete(sessionId)
      abortedCount++
    }
  }

  return abortedCount
}

/**
 * Abort all active sessions.
 * Use with caution — typically for shutdown scenarios.
 */
export function abortAllSessions(): number {
  const count = activeSessions.size

  for (const session of activeSessions.values()) {
    session.abortController.abort()
  }
  activeSessions.clear()

  return count
}

/**
 * Clean up stale sessions (older than maxAge milliseconds).
 * Useful for preventing memory leaks from orphaned sessions.
 */
export function cleanupStaleSessions(maxAgeMs: number): number {
  const now = Date.now()
  let cleanedCount = 0

  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.createdAt.getTime() > maxAgeMs) {
      session.abortController.abort()
      activeSessions.delete(sessionId)
      cleanedCount++
    }
  }

  return cleanedCount
}

/**
 * Get session statistics.
 */
export function getSessionStats(): {
  total: number
  byProvider: Record<string, number>
  byTaskType: Record<string, number>
  oldestSession: Date | null
} {
  const byProvider: Record<string, number> = {}
  const byTaskType: Record<string, number> = {}
  let oldestSession: Date | null = null

  for (const session of activeSessions.values()) {
    // Count by provider
    const providerId = session.providerId ?? 'unknown'
    byProvider[providerId] = (byProvider[providerId] ?? 0) + 1

    // Count by task type
    const taskType = session.taskType ?? 'unknown'
    byTaskType[taskType] = (byTaskType[taskType] ?? 0) + 1

    // Track oldest
    if (!oldestSession || session.createdAt < oldestSession) {
      oldestSession = session.createdAt
    }
  }

  return {
    total: activeSessions.size,
    byProvider,
    byTaskType,
    oldestSession,
  }
}

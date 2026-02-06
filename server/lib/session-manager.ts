const activeSessions = new Map<string, { abortController: AbortController }>()

export function createSession(sessionId: string): AbortController {
  const abortController = new AbortController()
  activeSessions.set(sessionId, { abortController })
  return abortController
}

export function abortSession(sessionId: string): boolean {
  const session = activeSessions.get(sessionId)
  if (session) {
    session.abortController.abort()
    activeSessions.delete(sessionId)
    return true
  }
  return false
}

export function removeSession(sessionId: string): void {
  activeSessions.delete(sessionId)
}

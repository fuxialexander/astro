/**
 * SSE Connection Tracker
 *
 * Tracks active SSE connections for monitoring and diagnostics.
 * Exposed via /api/health for connection saturation visibility.
 */

let globalSSEConnections = 0
let dispatchSSEConnections = 0
let chatSSEConnections = 0

export function incrementGlobalSSE(): void { globalSSEConnections++ }
export function decrementGlobalSSE(): void { globalSSEConnections = Math.max(0, globalSSEConnections - 1) }

export function incrementDispatchSSE(): void { dispatchSSEConnections++ }
export function decrementDispatchSSE(): void { dispatchSSEConnections = Math.max(0, dispatchSSEConnections - 1) }

export function incrementChatSSE(): void { chatSSEConnections++ }
export function decrementChatSSE(): void { chatSSEConnections = Math.max(0, chatSSEConnections - 1) }

export function getSSEConnectionCounts() {
  return {
    global: globalSSEConnections,
    dispatch: dispatchSSEConnections,
    chat: chatSSEConnections,
    total: globalSSEConnections + dispatchSSEConnections + chatSSEConnections,
  }
}

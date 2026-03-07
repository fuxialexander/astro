/**
 * Browser Notification API wrapper.
 *
 * Provides permission management and notification helpers for
 * plan session approval requests and completion events.
 */

export function requestNotificationPermission(): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

export function showApprovalNotification(projectName: string, question: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (document.hasFocus()) return

  new Notification(`Decision needed: ${projectName}`, {
    body: question,
    tag: `approval-${Date.now()}`,
  })
}

export function showTaskNotification(
  projectName: string,
  taskTitle: string,
  status: 'completed' | 'failed' | 'awaiting_judgment'
): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (document.hasFocus()) return

  const title = status === 'awaiting_judgment'
    ? `Judgment needed: ${projectName}`
    : status === 'failed'
      ? `Task failed: ${projectName}`
      : `Task completed: ${projectName}`

  new Notification(title, {
    body: taskTitle,
    tag: `task-${status}-${Date.now()}`,
  })
}

export function showPlanCompleteNotification(projectName: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (document.hasFocus()) return

  new Notification(`Plan complete: ${projectName}`, {
    body: `The interactive plan for "${projectName}" has been generated.`,
    tag: `plan-complete-${Date.now()}`,
  })
}

export function showBatchCompleteNotification(
  projectName: string,
  stats: { total: number; succeeded: number; failed: number }
): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (document.hasFocus()) return

  const parts: string[] = []
  if (stats.succeeded > 0) parts.push(`${stats.succeeded} succeeded`)
  if (stats.failed > 0) parts.push(`${stats.failed} failed`)
  const body = parts.length > 0 ? parts.join(', ') : `All ${stats.total} tasks processed`

  new Notification(`Execution complete: ${projectName}`, {
    body,
    tag: `batch-complete-${Date.now()}`,
  })
}

export function showChatCompleteNotification(projectName: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (document.hasFocus()) return

  new Notification(`Response ready: ${projectName}`, {
    body: `Chat response for "${projectName}" is ready.`,
    tag: `chat-complete-${Date.now()}`,
  })
}

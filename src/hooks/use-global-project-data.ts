import { useEffect } from "react"
import { usePlanStore } from "@/stores/plan-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useSessionStore } from "@/stores/session-store"
import { useTaskChatStore } from "@/stores/task-chat-store"
import { useActivityStore } from "@/stores/activity-store"
import { useRealtimeStore } from "@/stores/realtime-store"

/**
 * Hook for pages that need plan/execution data across ALL projects
 * (e.g., Dashboard, MyTasks, ActiveTasks).
 *
 * Triggers a global load (no projectId filter) on first call.
 * This is deferred from the initial DataLoader so it doesn't block page render.
 */
export function useGlobalProjectData() {
  const planLoaded = usePlanStore((s) => s.loaded)
  const executionsLoaded = useExecutionStore((s) => s.loaded)
  const sessionsLoaded = useSessionStore((s) => s.loaded)
  const chatLoaded = useTaskChatStore((s) => s.loaded)
  const activitiesLoaded = useActivityStore((s) => s.loaded)

  const loadPlan = usePlanStore((s) => s.load)
  const loadExecutions = useExecutionStore((s) => s.load)
  const loadSessions = useSessionStore((s) => s.load)
  const loadChat = useTaskChatStore((s) => s.load)
  const loadActivities = useActivityStore((s) => s.loadActivities)
  const reconcileRunningTasks = useRealtimeStore((s) => s.reconcileRunningTasks)

  useEffect(() => {
    const promises: Promise<void>[] = []
    if (!planLoaded) promises.push(loadPlan())
    if (!executionsLoaded) promises.push(loadExecutions())
    if (!sessionsLoaded) promises.push(loadSessions())
    if (!chatLoaded) promises.push(loadChat())
    if (!activitiesLoaded) promises.push(loadActivities())

    if (promises.length > 0) {
      Promise.all(promises).then(() => {
        reconcileRunningTasks()
      }).catch((err) => {
        console.error('[useGlobalProjectData] Failed to load:', err)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Run once per page mount
  }, [])

  return { planLoaded, executionsLoaded, sessionsLoaded }
}

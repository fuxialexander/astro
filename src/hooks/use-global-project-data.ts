import { useEffect } from "react"
import { usePlanStore } from "@/stores/plan-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useSessionStore } from "@/stores/session-store"
import { useTaskChatStore } from "@/stores/task-chat-store"
import { useActivityStore } from "@/stores/activity-store"
import { useRealtimeStore } from "@/stores/realtime-store"

/**
 * Hook for pages that need plan/execution data across ALL projects
 * (e.g., Dashboard, MyTasks, ActiveTasks, Projects, Initiatives, Agents).
 *
 * Triggers a global load (no projectId filter) if the stores haven't
 * been globally loaded yet. Uses `globallyLoaded` flag to distinguish
 * "loaded some project data" from "loaded all data globally".
 */
export function useGlobalProjectData() {
  const planGloballyLoaded = usePlanStore((s) => s.globallyLoaded)
  const executionsGloballyLoaded = useExecutionStore((s) => s.globallyLoaded)
  const sessionsGloballyLoaded = useSessionStore((s) => s.globallyLoaded)
  const chatGloballyLoaded = useTaskChatStore((s) => s.globallyLoaded)
  const activitiesGloballyLoaded = useActivityStore((s) => s.globallyLoaded)

  const loadPlan = usePlanStore((s) => s.load)
  const loadExecutions = useExecutionStore((s) => s.load)
  const loadSessions = useSessionStore((s) => s.load)
  const loadChat = useTaskChatStore((s) => s.load)
  const loadActivities = useActivityStore((s) => s.loadActivities)
  const reconcileRunningTasks = useRealtimeStore((s) => s.reconcileRunningTasks)

  useEffect(() => {
    const promises: Promise<void>[] = []
    if (!planGloballyLoaded) promises.push(loadPlan())
    if (!executionsGloballyLoaded) promises.push(loadExecutions())
    if (!sessionsGloballyLoaded) promises.push(loadSessions())
    if (!chatGloballyLoaded) promises.push(loadChat())
    if (!activitiesGloballyLoaded) promises.push(loadActivities())

    if (promises.length > 0) {
      Promise.all(promises).then(() => {
        reconcileRunningTasks()
      }).catch((err) => {
        console.error('[useGlobalProjectData] Failed to load:', err)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Run once per page mount
  }, [])

  return { planLoaded: planGloballyLoaded, executionsLoaded: executionsGloballyLoaded, sessionsLoaded: sessionsGloballyLoaded }
}

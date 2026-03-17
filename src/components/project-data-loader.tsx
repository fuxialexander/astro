import { useEffect, useRef } from "react"
import { useParams, Outlet } from "react-router"
import { usePlanStore } from "@/stores/plan-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useSessionStore } from "@/stores/session-store"
import { useTaskChatStore } from "@/stores/task-chat-store"
import { useActivityStore } from "@/stores/activity-store"
import { useRealtimeStore } from "@/stores/realtime-store"

/**
 * ProjectDataLoader: loads project-scoped data on demand when the user
 * navigates to a project route (/project/:id/*).
 *
 * This replaces the old pattern of loading ALL plan/execution/session/chat/activity
 * data for ALL projects on initial page load. Instead, we only load data for the
 * project the user is currently viewing.
 *
 * Renders nothing — purely a side-effect component.
 */
function ProjectDataLoader() {
  const { id: projectId } = useParams<{ id: string }>()
  const lastProjectIdRef = useRef<string | null>(null)

  const loadPlanForProject = usePlanStore((s) => s.loadForProject)
  const loadExecutionsForProject = useExecutionStore((s) => s.loadForProject)
  const loadSessionsForProject = useSessionStore((s) => s.loadForProject)
  const loadChatForProject = useTaskChatStore((s) => s.loadForProject)
  const loadActivitiesForProject = useActivityStore((s) => s.loadForProject)
  const reconcileRunningTasks = useRealtimeStore((s) => s.reconcileRunningTasks)

  useEffect(() => {
    if (!projectId) return
    // Skip if we already loaded data for this project in this mount
    if (lastProjectIdRef.current === projectId) return
    lastProjectIdRef.current = projectId

    // Load all project-scoped data in parallel, then reconcile running tasks
    Promise.all([
      loadPlanForProject(projectId),
      loadExecutionsForProject(projectId),
      loadSessionsForProject(projectId),
      loadChatForProject(projectId),
      loadActivitiesForProject(projectId),
    ]).then(() => {
      reconcileRunningTasks()
    }).catch((err) => {
      console.error('[ProjectDataLoader] Failed to load project data:', err)
    })
  }, [projectId, loadPlanForProject, loadExecutionsForProject, loadSessionsForProject, loadChatForProject, loadActivitiesForProject, reconcileRunningTasks])

  return null
}

/**
 * ProjectLayout: layout route for /project/:id/* that persists the
 * ProjectDataLoader across sub-route changes (graph/list/timeline/etc).
 * This prevents re-fetching data when switching views within a project.
 */
export function ProjectLayout() {
  return (
    <>
      <ProjectDataLoader />
      <Outlet />
    </>
  )
}

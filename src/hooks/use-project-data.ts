import { useEffect, useRef } from "react"
import { usePlanStore } from "@/stores/plan-store"
import { useExecutionStore } from "@/stores/execution-store"

/**
 * Loads full project data (content, executionOutput, streamText) when the user
 * navigates to a specific project. The global load uses slim mode to keep
 * startup fast; this hook fills in the heavy fields for the active project.
 */
export function useProjectData(projectId: string | undefined) {
  const loadPlanForProject = usePlanStore((s) => s.loadForProject)
  const loadExecsForProject = useExecutionStore((s) => s.loadForProject)
  const planLoaded = usePlanStore((s) => s.loaded)
  const execsLoaded = useExecutionStore((s) => s.loaded)
  const loadedRef = useRef<Set<string>>(new Set())
  const loadingRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!projectId || !planLoaded || !execsLoaded) return
    // Only load once per project per session (unless previous attempt failed)
    if (loadedRef.current.has(projectId) || loadingRef.current.has(projectId)) return
    loadingRef.current.add(projectId)

    Promise.all([
      loadPlanForProject(projectId),
      loadExecsForProject(projectId),
    ]).then(() => {
      loadedRef.current.add(projectId)
    }).catch(() => {
      // Allow retry on next mount/navigation
    }).finally(() => {
      loadingRef.current.delete(projectId)
    })
  }, [projectId, planLoaded, execsLoaded, loadPlanForProject, loadExecsForProject])
}

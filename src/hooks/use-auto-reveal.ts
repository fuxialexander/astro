import { useEffect, useMemo } from "react"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useExecutionStore } from "@/stores/execution-store"

import { useSidebarStore, type AutoRevealCounts } from "@/stores/sidebar-store"

/**
 * Computes usage counts across stores and triggers sidebar auto-reveal
 * when thresholds are met.
 */
export function useAutoReveal() {
  const projects = useProjectStore((s) => s.projects)
  const rawNodes = usePlanStore((s) => s.nodes)
  const executions = useExecutionStore((s) => s.executions)
  const sidebarLoaded = useSidebarStore((s) => s.loaded)
  const checkAutoReveal = useSidebarStore((s) => s.checkAutoReveal)

  const counts = useMemo<AutoRevealCounts>(() => {
    const activeProjectCount = projects.filter((p) => p.status === "active").length

    // Count active tasks: running executions + in-progress plan nodes (deduplicated)
    const activeExecNodeIds = new Set<string>()
    let activeTaskCount = 0
    for (const [nodeId, exec] of executions) {
      if (exec.status === "pending" || exec.status === "running") {
        activeTaskCount++
        activeExecNodeIds.add(nodeId)
      }
    }
    const liveNodes = rawNodes.filter(isLive)
    for (const node of liveNodes) {
      if (
        (node.status === "in_progress" || node.status === "dispatched") &&
        !activeExecNodeIds.has(node.id)
      ) {
        activeTaskCount++
      }
    }

    return { activeProjectCount, activeTaskCount }
  }, [projects, rawNodes, executions])

  useEffect(() => {
    if (sidebarLoaded) {
      checkAutoReveal(counts)
    }
  }, [counts, sidebarLoaded, checkAutoReveal])
}

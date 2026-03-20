/**
 * Hook: usePlanContext
 *
 * Builds lean plan node/edge context for AI chat API calls.
 * Shared by plan-generation, chat-panel, and playground.
 *
 * Always filters to live (non-deleted) nodes and uses rich descriptions
 * (strips HTML from content field with fallback to description).
 */

import { useMemo } from "react"
import { stripHtml } from "@/lib/html-utils"
import { usePlanStore, isLive } from "@/stores/plan-store"
import type { ChatPlanNodeContext, ChatPlanEdgeContext } from "@/lib/api-client"

interface UsePlanContextReturn {
  planNodes: ReturnType<typeof usePlanStore.getState>["nodes"]
  planNodeContext: ChatPlanNodeContext[]
  planEdgeContext: ChatPlanEdgeContext[]
}

export function usePlanContext(projectId: string): UsePlanContextReturn {
  const allPlanNodes = usePlanStore((s) => s.nodes)
  const allPlanEdges = usePlanStore((s) => s.edges)

  const filteredNodes = useMemo(() => {
    return allPlanNodes.filter((n) => n.projectId === projectId).filter(isLive)
  }, [allPlanNodes, projectId])

  const filteredEdges = useMemo(() => {
    const projectNodeIds = new Set(filteredNodes.map((n) => n.id))
    return allPlanEdges
      .filter(isLive)
      .filter((e) => projectNodeIds.has(e.source) || projectNodeIds.has(e.target))
  }, [allPlanEdges, filteredNodes])

  const planNodeContext: ChatPlanNodeContext[] = useMemo(() => {
    return filteredNodes.map((n) => ({
      id: n.id,
      title: n.title,
      description: n.content ? stripHtml(n.content) : (n.description ?? ''),
      status: n.status,
      type: n.type,
      priority: n.priority,
      estimate: n.estimate,
      verification: n.verification,
      milestoneId: n.milestoneId,
      dependencies: n.dependencies,
      dueDate: n.dueDate,
      startDate: n.startDate,
      endDate: n.endDate,
    }))
  }, [filteredNodes])

  const planEdgeContext: ChatPlanEdgeContext[] = useMemo(() => {
    return filteredEdges.map((e) => ({ source: e.source, target: e.target, type: e.type }))
  }, [filteredEdges])

  return { planNodes: filteredNodes, planNodeContext, planEdgeContext }
}

import { create } from "zustand"
import type { PlanNode, PlanEdge } from "@/types"
import { loadState, saveState } from "@/lib/db"
import { layoutGraph } from "@/lib/graph-utils"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase-client"
import type { RealtimeChannel } from "@supabase/supabase-js"

interface PlanState {
  nodes: PlanNode[]
  edges: PlanEdge[]
  loaded: boolean
  load: () => Promise<void>
  addNode: (node: PlanNode) => void
  updateNode: (id: string, updates: Partial<PlanNode>) => void
  addEdge: (edge: PlanEdge) => void
  setProjectPlan: (projectId: string, nodes: PlanNode[], edges: PlanEdge[]) => void
  reorganizeProject: (projectId: string) => void
}

// Helper: map Supabase plan_nodes row to PlanNode
function mapNodeRow(row: Record<string, unknown>): PlanNode {
  return {
    id: row.client_id as string,
    projectId: row.project_id as string,
    type: row.type as PlanNode["type"],
    title: row.title as string,
    description: (row.description as string) || "",
    status: row.status as PlanNode["status"],
    parentId: row.parent_id as string | null,
    dependencies: [], // loaded from junction table
    environment: row.environment as PlanNode["environment"],
    verification: (row.verification as PlanNode["verification"]) || "auto",
    position: { x: (row.position_x as number) || 0, y: (row.position_y as number) || 0 },
    startDate: row.start_date as string | undefined,
    endDate: row.end_date as string | undefined,
    dueDate: row.due_date as string | undefined,
    priority: row.priority as PlanNode["priority"],
    estimate: row.estimate as PlanNode["estimate"],
    milestoneId: row.milestone_id as string | undefined,
    labelIds: row.label_ids as string[] | undefined,
    executionId: row.execution_id as string | undefined,
    executionOutput: row.execution_output as string | undefined,
    executionError: row.execution_error as string | undefined,
    executionStartedAt: row.execution_started_at ? new Date(row.execution_started_at as string) : undefined,
    executionCompletedAt: row.execution_completed_at ? new Date(row.execution_completed_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

// Helper: map Supabase plan_edges row to PlanEdge
function mapEdgeRow(row: Record<string, unknown>): PlanEdge {
  return {
    id: row.client_id as string,
    source: row.source_client_id as string,
    target: row.target_client_id as string,
    type: (row.type as PlanEdge["type"]) || "dependency",
  }
}

let nodesChannel: RealtimeChannel | null = null
let edgesChannel: RealtimeChannel | null = null

// Empty seed data — new users start with no plans and create via /projects/new
const SEED_NODES: PlanNode[] = []
const SEED_EDGES: PlanEdge[] = []

async function loadFromIdb(): Promise<{ nodes: PlanNode[]; edges: PlanEdge[] } | null> {
  const savedNodes = await loadState<PlanNode[]>("nexus-plan-nodes")
  const savedEdges = await loadState<PlanEdge[]>("nexus-plan-edges")
  if (savedNodes && savedEdges) {
    return {
      nodes: savedNodes.map(n => ({ ...n, createdAt: new Date(n.createdAt), updatedAt: new Date(n.updatedAt) })),
      edges: savedEdges,
    }
  }
  return null
}

function saveToIdb(nodes: PlanNode[], edges: PlanEdge[]) {
  saveState("nexus-plan-nodes", nodes)
  saveState("nexus-plan-edges", edges)
}

// Supabase sync helpers
function syncAddNode(node: PlanNode) {
  const supabase = getSupabase()
  if (!supabase || !isSupabaseConfigured()) return
  supabase.from("plan_nodes").insert({
    project_id: node.projectId,
    client_id: node.id,
    type: node.type,
    title: node.title,
    description: node.description,
    status: node.status,
    parent_id: node.parentId,
    environment: node.environment || null,
    verification: node.verification,
    position_x: node.position.x,
    position_y: node.position.y,
    start_date: node.startDate || null,
    end_date: node.endDate || null,
    due_date: node.dueDate || null,
    priority: node.priority || null,
    estimate: node.estimate || null,
    milestone_id: node.milestoneId || null,
    label_ids: node.labelIds || [],
  }).then()
}

function syncUpdateNode(id: string, projectId: string, updates: Partial<PlanNode>) {
  const supabase = getSupabase()
  if (!supabase || !isSupabaseConfigured()) return
  const row: Record<string, unknown> = {}
  if (updates.title !== undefined) row.title = updates.title
  if (updates.description !== undefined) row.description = updates.description
  if (updates.status !== undefined) row.status = updates.status
  if (updates.position !== undefined) { row.position_x = updates.position.x; row.position_y = updates.position.y }
  if (updates.startDate !== undefined) row.start_date = updates.startDate || null
  if (updates.endDate !== undefined) row.end_date = updates.endDate || null
  if (updates.dueDate !== undefined) row.due_date = updates.dueDate || null
  if (updates.priority !== undefined) row.priority = updates.priority || null
  if (updates.estimate !== undefined) row.estimate = updates.estimate || null
  if (updates.milestoneId !== undefined) row.milestone_id = updates.milestoneId || null
  if (updates.executionId !== undefined) row.execution_id = updates.executionId || null
  if (updates.executionOutput !== undefined) row.execution_output = updates.executionOutput || null
  if (updates.executionError !== undefined) row.execution_error = updates.executionError || null
  if (Object.keys(row).length > 0) {
    supabase.from("plan_nodes").update(row).eq("project_id", projectId).eq("client_id", id).then()
  }
}

function syncAddEdge(edge: PlanEdge, projectId: string) {
  const supabase = getSupabase()
  if (!supabase || !isSupabaseConfigured()) return
  supabase.from("plan_edges").insert({
    project_id: projectId,
    client_id: edge.id,
    source_client_id: edge.source,
    target_client_id: edge.target,
    type: edge.type,
  }).then()
}

export const usePlanStore = create<PlanState>((set, get) => ({
  nodes: [],
  edges: [],
  loaded: false,

  load: async () => {
    const supabase = getSupabase()

    if (supabase && isSupabaseConfigured()) {
      // Load from Supabase
      const [nodesRes, edgesRes] = await Promise.all([
        supabase.from("plan_nodes").select("*").order("created_at"),
        supabase.from("plan_edges").select("*"),
      ])

      if (!nodesRes.error && nodesRes.data && nodesRes.data.length > 0) {
        // Also load dependencies
        const { data: deps } = await supabase.from("plan_node_dependencies").select("*")
        const depsMap = new Map<string, string[]>()
        if (deps) {
          for (const dep of deps) {
            const key = `${dep.node_project_id}:${dep.node_client_id}`
            if (!depsMap.has(key)) depsMap.set(key, [])
            depsMap.get(key)!.push(dep.depends_on_client_id)
          }
        }

        const nodes = nodesRes.data.map((row) => {
          const node = mapNodeRow(row)
          node.dependencies = depsMap.get(`${row.project_id}:${row.client_id}`) || []
          return node
        })
        const edges = (edgesRes.data || []).map(mapEdgeRow)
        set({ nodes, edges, loaded: true })
        saveToIdb(nodes, edges)
      } else {
        // Fallback to IndexedDB
        const cached = await loadFromIdb()
        if (cached) {
          set({ ...cached, loaded: true })
        } else {
          set({ nodes: SEED_NODES, edges: SEED_EDGES, loaded: true })
          saveToIdb(SEED_NODES, SEED_EDGES)
        }
      }

      // Subscribe to realtime node changes
      if (!nodesChannel) {
        nodesChannel = supabase
          .channel("plan-nodes-changes")
          .on("postgres_changes", { event: "*", schema: "public", table: "plan_nodes" }, (payload) => {
            const current = get().nodes
            if (payload.eventType === "UPDATE") {
              const updated = mapNodeRow(payload.new)
              // Preserve dependencies (not in the row)
              const existing = current.find((n) => n.id === updated.id && n.projectId === updated.projectId)
              if (existing) updated.dependencies = existing.dependencies
              set({ nodes: current.map((n) => (n.id === updated.id && n.projectId === updated.projectId ? updated : n)) })
            }
          })
          .subscribe()
      }

      if (!edgesChannel) {
        edgesChannel = supabase
          .channel("plan-edges-changes")
          .on("postgres_changes", { event: "*", schema: "public", table: "plan_edges" }, () => {
            // Re-fetch edges on change for simplicity
          })
          .subscribe()
      }
    } else {
      // Pure IndexedDB mode
      const cached = await loadFromIdb()
      if (cached) {
        set({ ...cached, loaded: true })
      } else {
        set({ nodes: SEED_NODES, edges: SEED_EDGES, loaded: true })
        saveToIdb(SEED_NODES, SEED_EDGES)
      }
    }
  },

  addNode: (node) => {
    const nextNodes = [...get().nodes, node]
    set({ nodes: nextNodes })
    saveState("nexus-plan-nodes", nextNodes)
    syncAddNode(node)
  },

  updateNode: (id, updates) => {
    const existing = get().nodes.find((n) => n.id === id)
    const nextNodes = get().nodes.map((n) =>
      n.id === id ? { ...n, ...updates, updatedAt: new Date() } : n
    )
    set({ nodes: nextNodes })
    saveState("nexus-plan-nodes", nextNodes)
    if (existing) syncUpdateNode(id, existing.projectId, updates)
  },

  addEdge: (edge) => {
    const nextEdges = [...get().edges, edge]
    set({ edges: nextEdges })
    saveState("nexus-plan-edges", nextEdges)
    // Determine projectId from source node
    const sourceNode = get().nodes.find((n) => n.id === edge.source)
    if (sourceNode) syncAddEdge(edge, sourceNode.projectId)
  },

  setProjectPlan: (projectId, newNodes, newEdges) => {
    const otherNodes = get().nodes.filter((n) => n.projectId !== projectId)
    const otherEdges = get().edges.filter((e) => {
      const nodeIds = new Set(get().nodes.filter((n) => n.projectId === projectId).map((n) => n.id))
      return !nodeIds.has(e.source) && !nodeIds.has(e.target)
    })
    const nextNodes = [...otherNodes, ...newNodes]
    const nextEdges = [...otherEdges, ...newEdges]
    set({ nodes: nextNodes, edges: nextEdges })
    saveToIdb(nextNodes, nextEdges)

    // Bulk sync to Supabase
    const supabase = getSupabase()
    if (supabase && isSupabaseConfigured()) {
      // Delete old nodes/edges for project, then insert new
      supabase.from("plan_edges").delete().eq("project_id", projectId).then(() => {
        supabase.from("plan_nodes").delete().eq("project_id", projectId).then(() => {
          // Insert new nodes
          const nodeRows = newNodes.map((n) => ({
            project_id: n.projectId,
            client_id: n.id,
            type: n.type,
            title: n.title,
            description: n.description,
            status: n.status,
            parent_id: n.parentId,
            environment: n.environment || null,
            verification: n.verification,
            position_x: n.position.x,
            position_y: n.position.y,
            start_date: n.startDate || null,
            end_date: n.endDate || null,
            due_date: n.dueDate || null,
            priority: n.priority || null,
            estimate: n.estimate || null,
            milestone_id: n.milestoneId || null,
            label_ids: n.labelIds || [],
          }))
          if (nodeRows.length > 0) supabase.from("plan_nodes").insert(nodeRows).then()

          // Insert new edges
          const edgeRows = newEdges.map((e) => ({
            project_id: projectId,
            client_id: e.id,
            source_client_id: e.source,
            target_client_id: e.target,
            type: e.type,
          }))
          if (edgeRows.length > 0) supabase.from("plan_edges").insert(edgeRows).then()

          // Insert dependencies
          const depRows = newNodes.flatMap((n) =>
            n.dependencies.map((depId) => ({
              node_project_id: projectId,
              node_client_id: n.id,
              depends_on_client_id: depId,
            }))
          )
          if (depRows.length > 0) supabase.from("plan_node_dependencies").insert(depRows).then()
        })
      })
    }
  },

  reorganizeProject: (projectId) => {
    const allNodes = get().nodes
    const allEdges = get().edges
    const projectNodes = allNodes.filter((n) => n.projectId === projectId)
    const nodeIds = new Set(projectNodes.map((n) => n.id))
    const projectEdges = allEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

    const positions = layoutGraph(projectNodes, projectEdges)

    const nextNodes = allNodes.map((n) => {
      const newPos = positions.get(n.id)
      return newPos ? { ...n, position: newPos, updatedAt: new Date() } : n
    })
    set({ nodes: nextNodes })
    saveState("nexus-plan-nodes", nextNodes)

    // Sync position updates to Supabase
    const supabase = getSupabase()
    if (supabase && isSupabaseConfigured()) {
      for (const [nodeId, pos] of positions) {
        supabase.from("plan_nodes").update({ position_x: pos.x, position_y: pos.y }).eq("project_id", projectId).eq("client_id", nodeId).then()
      }
    }
  },
}))

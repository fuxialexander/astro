import { create } from "zustand"
import type { Project } from "@/types"
import { loadState, saveState } from "@/lib/db"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase-client"
import type { RealtimeChannel } from "@supabase/supabase-js"

interface ProjectState {
  projects: Project[]
  loaded: boolean
  load: () => Promise<void>
  addProject: (project: Project) => void
  updateProject: (id: string, updates: Partial<Project>) => void
  deleteProject: (id: string) => void
}

// Map Supabase row to Project
function mapRow(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) || "",
    visionDoc: (row.vision_doc as string) || "",
    status: (row.status as Project["status"]) || "active",
    startDate: row.start_date as string | undefined,
    targetDate: row.target_date as string | undefined,
    lead: row.lead as string | undefined,
    health: row.health as Project["health"] | undefined,
    initiative: row.initiative as string | undefined,
    progress: row.progress as number | undefined,
    labels: (row.labels as Project["labels"]) || [],
    workingDirectory: row.working_directory as string | undefined,
    repository: row.repository as string | undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

// Map Project to Supabase insert/update
function toRow(project: Project, ownerId?: string) {
  return {
    id: project.id,
    owner_id: ownerId,
    name: project.name,
    description: project.description,
    vision_doc: project.visionDoc,
    status: project.status,
    start_date: project.startDate || null,
    target_date: project.targetDate || null,
    lead: project.lead || null,
    health: project.health || null,
    initiative: project.initiative || null,
    progress: project.progress ?? 0,
    labels: project.labels || [],
    working_directory: project.workingDirectory || null,
    repository: project.repository || null,
  }
}

let realtimeChannel: RealtimeChannel | null = null

// Mock data for first-time / offline use
const MOCK_PROJECTS: Project[] = [
  {
    id: "proj-1",
    name: "Personal Finance App",
    description: "AI-powered budgeting app with transaction categorization and savings goals",
    visionDoc: "Build a personal finance application that helps users track spending, categorize transactions automatically using AI, and set/monitor savings goals.",
    status: "active",
    startDate: "2026-01-15",
    targetDate: "2026-03-30",
    lead: "Alex Chen",
    health: "on_track",
    initiative: "Platform Development",
    progress: 65,
    labels: [
      { id: "l1", name: "Frontend", color: "#3b82f6" },
      { id: "l2", name: "Backend", color: "#10b981" },
      { id: "l3", name: "Testing", color: "#f59e0b" },
    ],
    createdAt: new Date("2026-01-15"),
    updatedAt: new Date("2026-02-04"),
  },
  {
    id: "proj-2",
    name: "ML Training Pipeline",
    description: "Scalable machine learning pipeline for model training and evaluation",
    visionDoc: "Design a distributed ML pipeline that handles data preprocessing, model training across GPU clusters, hyperparameter tuning, and automated evaluation.",
    status: "active",
    startDate: "2026-02-01",
    targetDate: "2026-05-15",
    lead: "Alex Chen",
    health: "on_track",
    initiative: "Platform Development",
    progress: 30,
    labels: [
      { id: "l1", name: "Infrastructure", color: "#8b5cf6" },
      { id: "l2", name: "Research", color: "#ec4899" },
    ],
    createdAt: new Date("2026-02-01"),
    updatedAt: new Date("2026-02-05"),
  },
  {
    id: "proj-3",
    name: "API Gateway Service",
    description: "High-performance API gateway with rate limiting and auth",
    visionDoc: "Build a lightweight API gateway service with JWT authentication, rate limiting, request routing, and observability built in.",
    status: "active",
    startDate: "2026-02-03",
    targetDate: "2026-04-01",
    lead: "Alex Chen",
    health: "at_risk",
    initiative: "Platform Development",
    progress: 15,
    createdAt: new Date("2026-02-03"),
    updatedAt: new Date("2026-02-05"),
  },
  {
    id: "proj-4",
    name: "Genomic Data Pipeline",
    description: "Bioinformatics pipeline for whole-genome sequencing analysis",
    visionDoc: "Analyze WGS data across HPC and cloud environments, supporting variant calling, annotation, and population-level analysis.",
    status: "active",
    startDate: "2026-03-01",
    targetDate: "2026-06-15",
    lead: "Alex Chen",
    health: "on_track",
    initiative: "Research Projects",
    progress: 0,
    createdAt: new Date("2026-03-01"),
    updatedAt: new Date("2026-03-01"),
  },
  {
    id: "proj-5",
    name: "LLM Benchmark Suite",
    description: "Comprehensive benchmark suite for evaluating language models",
    visionDoc: "Build a standardized benchmarking framework for LLMs covering reasoning, code generation, and instruction following.",
    status: "active",
    startDate: "2025-12-10",
    targetDate: "2026-02-10",
    lead: "Alex Chen",
    health: "off_track",
    initiative: "Research Projects",
    progress: 85,
    createdAt: new Date("2025-12-10"),
    updatedAt: new Date("2026-02-04"),
  },
]

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loaded: false,

  load: async () => {
    const supabase = getSupabase()

    if (supabase && isSupabaseConfigured()) {
      // Load from Supabase (primary)
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false })

      if (!error && data && data.length > 0) {
        const projects = data.map(mapRow)
        set({ projects, loaded: true })
        // Update IndexedDB cache
        await saveState("nexus-projects", projects)
      } else {
        // Fall back to IndexedDB
        const saved = await loadState<Project[]>("nexus-projects")
        if (saved) {
          set({ projects: saved.map(p => ({ ...p, createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt) })), loaded: true })
        } else {
          set({ projects: MOCK_PROJECTS, loaded: true })
          await saveState("nexus-projects", MOCK_PROJECTS)
        }
      }

      // Subscribe to realtime changes
      if (!realtimeChannel) {
        realtimeChannel = supabase
          .channel("projects-changes")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "projects" },
            (payload) => {
              const current = get().projects
              if (payload.eventType === "INSERT") {
                const newProject = mapRow(payload.new)
                if (!current.find((p) => p.id === newProject.id)) {
                  set({ projects: [newProject, ...current] })
                }
              } else if (payload.eventType === "UPDATE") {
                const updated = mapRow(payload.new)
                set({
                  projects: current.map((p) => (p.id === updated.id ? updated : p)),
                })
              } else if (payload.eventType === "DELETE") {
                set({
                  projects: current.filter((p) => p.id !== (payload.old as { id: string }).id),
                })
              }
            }
          )
          .subscribe()
      }
    } else {
      // Pure IndexedDB mode (no Supabase)
      const saved = await loadState<Project[]>("nexus-projects")
      if (saved) {
        set({ projects: saved.map(p => ({ ...p, createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt) })), loaded: true })
      } else {
        set({ projects: MOCK_PROJECTS, loaded: true })
        await saveState("nexus-projects", MOCK_PROJECTS)
      }
    }
  },

  addProject: (project) => {
    const next = [...get().projects, project]
    set({ projects: next })
    saveState("nexus-projects", next)

    // Write to Supabase
    const supabase = getSupabase()
    if (supabase && isSupabaseConfigured()) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          supabase.from("projects").insert(toRow(project, user.id)).then()
        }
      })
    }
  },

  updateProject: (id, updates) => {
    const next = get().projects.map((p) =>
      p.id === id ? { ...p, ...updates, updatedAt: new Date() } : p
    )
    set({ projects: next })
    saveState("nexus-projects", next)

    // Write to Supabase
    const supabase = getSupabase()
    if (supabase && isSupabaseConfigured()) {
      const row: Record<string, unknown> = {}
      if (updates.name !== undefined) row.name = updates.name
      if (updates.description !== undefined) row.description = updates.description
      if (updates.visionDoc !== undefined) row.vision_doc = updates.visionDoc
      if (updates.status !== undefined) row.status = updates.status
      if (updates.startDate !== undefined) row.start_date = updates.startDate || null
      if (updates.targetDate !== undefined) row.target_date = updates.targetDate || null
      if (updates.lead !== undefined) row.lead = updates.lead || null
      if (updates.health !== undefined) row.health = updates.health || null
      if (updates.initiative !== undefined) row.initiative = updates.initiative || null
      if (updates.progress !== undefined) row.progress = updates.progress
      if (updates.labels !== undefined) row.labels = updates.labels
      if (updates.workingDirectory !== undefined) row.working_directory = updates.workingDirectory || null
      if (updates.repository !== undefined) row.repository = updates.repository || null

      if (Object.keys(row).length > 0) {
        supabase.from("projects").update(row).eq("id", id).then()
      }
    }
  },

  deleteProject: (id) => {
    const next = get().projects.filter((p) => p.id !== id)
    set({ projects: next })
    saveState("nexus-projects", next)

    const supabase = getSupabase()
    if (supabase && isSupabaseConfigured()) {
      supabase.from("projects").delete().eq("id", id).then()
    }
  },
}))

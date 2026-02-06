import { create } from "zustand"
import type { Project } from "@/types"
import { loadState, saveState } from "@/lib/db"

interface ProjectState {
  projects: Project[]
  loaded: boolean
  load: () => Promise<void>
  addProject: (project: Project) => void
  updateProject: (id: string, updates: Partial<Project>) => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loaded: false,

  load: async () => {
    const saved = await loadState<Project[]>("nexus-projects")
    if (saved) {
      set({ projects: saved.map(p => ({ ...p, createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt) })), loaded: true })
    } else {
      // Seed mock data
      const mockProjects: Project[] = [
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
      set({ projects: mockProjects, loaded: true })
      await saveState("nexus-projects", mockProjects)
    }
  },

  addProject: (project) => {
    const next = [...get().projects, project]
    set({ projects: next })
    saveState("nexus-projects", next)
  },

  updateProject: (id, updates) => {
    const next = get().projects.map((p) =>
      p.id === id ? { ...p, ...updates, updatedAt: new Date() } : p
    )
    set({ projects: next })
    saveState("nexus-projects", next)
  },
}))

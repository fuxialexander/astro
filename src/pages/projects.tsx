import { useMemo } from "react"
import { Link, useNavigate } from "react-router"
import { Folder, ListFilter, Plus, ChevronDown, Rocket, FlaskConical, SlidersHorizontal, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { useProjectStore } from "@/stores/project-store"
import type { Project } from "@/types"

const healthConfig: Record<string, { label: string; dotClass: string; textClass: string }> = {
  on_track: { label: "On track", dotClass: "bg-green-500", textClass: "text-green-600" },
  at_risk: { label: "At risk", dotClass: "bg-amber-500", textClass: "text-amber-600" },
  off_track: { label: "Off track", dotClass: "bg-red-500", textClass: "text-red-600" },
}

const initiativeIcons: Record<string, typeof Rocket> = {
  "Platform Development": Rocket,
  "Research Projects": FlaskConical,
}

const initiativeIconColors: Record<string, string> = {
  "Platform Development": "text-primary",
  "Research Projects": "text-destructive",
}

function formatShortDate(dateStr?: string): string {
  if (!dateStr) return "—"
  const d = new Date(dateStr + "T00:00:00Z")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

export function Projects() {
  const projects = useProjectStore((s) => s.projects)
  const navigate = useNavigate()

  // Group by initiative
  const groups = useMemo(() => {
    return projects.reduce<Record<string, Project[]>>((acc, p) => {
      const group = p.initiative ?? "Other"
      ;(acc[group] ??= []).push(p)
      return acc
    }, {})
  }, [projects])

  // Initiative counts for right panel
  const initiativeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of projects) {
      const init = p.initiative ?? "Other"
      counts[init] = (counts[init] ?? 0) + 1
    }
    return counts
  }, [projects])

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-base font-semibold">Projects</span>
            <div className="flex items-center rounded-lg bg-secondary p-1 gap-0.5">
              <span className="rounded-md bg-card px-4 py-1.5 text-[13px] font-medium">All projects</span>
              <span className="rounded-md px-4 py-1.5 text-[13px] text-muted-foreground">Timeline</span>
              <span className="rounded-md px-4 py-1.5 text-[13px] text-muted-foreground">Board</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" asChild>
              <Link to="/projects/new">
                <Plus className="h-3.5 w-3.5" />
                Add project
              </Link>
            </Button>
            <Button variant="outline" size="sm">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Display
            </Button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex items-center gap-3 border-b border-border px-6 py-2 shrink-0">
          <ListFilter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Filter</span>
        </div>

        {/* Column Headers */}
        <div className="flex items-center border-b border-border px-6 h-9 shrink-0">
          <span className="flex-1 text-[13px] font-medium text-muted-foreground">Name</span>
          <span className="w-[100px] text-[13px] font-medium text-muted-foreground">Status</span>
          <span className="w-[100px] text-[13px] font-medium text-muted-foreground">Health</span>
          <span className="w-[80px] text-[13px] font-medium text-muted-foreground">Progress</span>
          <span className="w-[100px] text-[13px] font-medium text-muted-foreground">Start date</span>
        </div>

        {/* Table Body */}
        <div className="flex-1 overflow-auto">
          {projects.length === 0 ? (
            <EmptyState
              icon={Folder}
              title="What are you working on?"
              description="Create your first project and let AI help you break it down into a structured plan with clear dependencies and verification steps."
              action={{
                label: "Create Project",
                onClick: () => navigate("/projects/new"),
              }}
              className="h-full"
            />
          ) : (
            Object.entries(groups).map(([initiative, items]) => {
              const Icon = initiativeIcons[initiative] ?? Users
              const iconColor = initiativeIconColors[initiative] ?? "text-green-600"
              return (
                <div key={initiative}>
                  {/* Initiative Group Header */}
                  <div className="flex items-center gap-2 bg-muted px-6 py-2.5">
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    <Icon className={`h-4 w-4 ${iconColor}`} />
                    <span className="text-sm font-medium">{initiative}</span>
                    <span className="text-[13px] text-muted-foreground">{items.length}</span>
                  </div>

                  {/* Project Rows */}
                  {items.map((project) => {
                    const health = healthConfig[project.health ?? "on_track"]
                    return (
                      <Link
                        key={project.id}
                        to={`/project/${project.id}`}
                        className="flex items-center border-b border-border px-6 pl-12 py-2.5 hover:bg-muted/30 transition-colors"
                      >
                        {/* Name */}
                        <div className="flex flex-1 items-center gap-2.5 min-w-0">
                          <Folder className="h-4 w-4 shrink-0 text-blue-500" />
                          <span className="text-sm truncate">{project.name}</span>
                        </div>

                        {/* Status */}
                        <div className="w-[100px]">
                          <Badge variant="success" className="text-xs">
                            {project.status === "active" ? "Active" : "Archived"}
                          </Badge>
                        </div>

                        {/* Health */}
                        <div className="w-[100px] flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${health.dotClass}`} />
                          <span className={`text-xs ${health.textClass}`}>{health.label}</span>
                        </div>

                        {/* Progress */}
                        <div className="w-[80px]">
                          <span className="text-xs">{project.progress ?? 0}%</span>
                        </div>

                        {/* Start Date */}
                        <div className="w-[100px]">
                          <span className="text-xs text-muted-foreground">{formatShortDate(project.startDate)}</span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Right Panel — Initiatives */}
      <div className="flex w-[280px] shrink-0 flex-col border-l border-border bg-card">
        {/* Panel Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 h-12">
          <Folder className="h-4 w-4" />
          <span className="text-sm font-semibold">Projects</span>
        </div>

        {/* Panel Tabs */}
        <div className="flex border-b border-border px-4">
          <span className="border-b-2 border-primary px-3 py-3 text-[13px] font-medium">Initiatives</span>
          <span className="px-3 py-3 text-[13px] text-muted-foreground">Health</span>
        </div>

        {/* Initiative List */}
        <div className="flex flex-col gap-1 p-2">
          {Object.entries(initiativeCounts).map(([name, count]) => {
            const Icon = initiativeIcons[name] ?? Users
            const iconColor = initiativeIconColors[name] ?? "text-green-600"
            return (
              <div key={name} className="flex items-center gap-2.5 rounded-md px-3 py-2.5">
                <Icon className={`h-4 w-4 ${iconColor}`} />
                <span className="flex-1 text-[13px]">{name}</span>
                <span className="text-[13px] text-muted-foreground">{count}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

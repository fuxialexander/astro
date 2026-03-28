import { useEffect, useMemo } from "react"
import { Link } from "react-router"
import { Button } from "@/components/ui/button"
import { NotificationCards } from "@/components/dashboard/notification-card"
import { NeedsYouSection } from "@/components/inbox/needs-you-section"
import { RunningSection } from "@/components/inbox/running-section"
import { DoneTodaySection } from "@/components/inbox/done-today-section"
import { ProjectHealthCard } from "@/components/dashboard/project-health-card"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { dataClient } from "@/lib/data-client"
import { useState } from "react"

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function InboxHome() {
  const projects = useProjectStore((s) => s.projects)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const profile = useUserProfileStore((s) => s.profile)

  const activeProjects = useMemo(() => projects.filter((p) => p.status === "active" && p.projectType !== "playground"), [projects])

  const recentProjects = useMemo(() => {
    return [...activeProjects]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6)
  }, [activeProjects])

  const [projectCosts, setProjectCosts] = useState<Record<string, number>>({})
  useEffect(() => {
    const ids = activeProjects.map((p) => p.id)
    if (ids.length === 0) return
    dataClient.getProjectCosts(ids).then(setProjectCosts).catch(() => {})
  }, [activeProjects])

  const projectHealth = useMemo(() => {
    return recentProjects.map((project) => {
      const pNodes = nodes.filter((n) => n.projectId === project.id)
      const completed = pNodes.filter((n) => ["completed", "auto_verified"].includes(n.status)).length
      const inProgress = pNodes.filter((n) => ["in_progress", "dispatched"].includes(n.status)).length
      const planned = pNodes.filter((n) => n.status === "planned").length
      const awaiting = pNodes.filter((n) => ["awaiting_judgment", "awaiting_approval"].includes(n.status)).length
      const pruned = pNodes.filter((n) => n.status === "pruned").length
      const now = new Date()
      const dayBuckets = new Array(30).fill(0)
      for (const n of pNodes) {
        const completedAt = n.executionCompletedAt ?? (["completed", "auto_verified"].includes(n.status) ? n.updatedAt : null)
        if (!completedAt) continue
        const d = new Date(completedAt)
        const daysAgo = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
        if (daysAgo >= 0 && daysAgo < 30) {
          dayBuckets[29 - daysAgo]++
        }
      }
      return {
        project,
        completed,
        inProgress,
        planned,
        awaiting,
        pruned,
        total: pNodes.length,
        costUsd: projectCosts[project.id] ?? 0,
        velocityData: dayBuckets,
      }
    })
  }, [recentProjects, nodes, projectCosts])

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return "Good morning"
    if (h < 17) return "Good afternoon"
    return "Good evening"
  }, [])

  const dateString = useMemo(() => {
    const now = new Date()
    return `${DAY_NAMES[now.getDay()]}, ${MONTH_NAMES[now.getMonth()]} ${now.getDate()}`
  }, [])

  return (
    <div className="flex flex-col gap-8 p-6 md:px-10 md:py-8 max-w-[1100px] mx-auto w-full animate-stagger">
      {/* Greeting */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl md:text-[28px] font-secondary font-light tracking-wide leading-tight">
          {greeting}{profile.name && !profile.name.includes("@") ? `, ${profile.name}` : ""}
        </h1>
        <p className="text-[13px] text-muted-foreground/40 tracking-wide">{dateString}</p>
      </div>

      {/* Notifications */}
      <NotificationCards />

      {/* Needs You */}
      <NeedsYouSection />

      {/* Running */}
      <RunningSection />

      {/* Done Today */}
      <DoneTodaySection />

      {/* Project Health Cards (compact grid, max 6) */}
      {recentProjects.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold tracking-wide text-muted-foreground/70 uppercase">Projects</h2>
            {activeProjects.length > 6 && (
              <Button variant="ghost" size="sm" asChild className="h-6 text-[11px] text-muted-foreground/50 px-2">
                <Link to="/projects">All {activeProjects.length}</Link>
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {projectHealth.map(({ project, completed, inProgress, planned, awaiting, pruned, total, costUsd, velocityData }) => (
              <ProjectHealthCard
                key={project.id}
                projectId={project.id}
                name={project.name}
                icon={project.icon}
                color={project.color}
                completed={completed}
                inProgress={inProgress}
                planned={planned}
                awaiting={awaiting}
                pruned={pruned}
                total={total}
                costUsd={costUsd}
                velocityData={velocityData}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

import { Sparkles, ListFilter, Rocket, FolderKanban, Server, Check, CheckCircle2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { cn } from "@/lib/utils"

type TabFilter = "all" | "awaiting_review" | "deferred" | "completed"

interface DecisionItem {
  id: string
  type: "judgment" | "decision" | "deployment"
  status: "awaiting_review" | "deferred" | "completed"
  title: string
  project: string
  projectIcon: typeof FolderKanban
  description: string
  aiRecommendation?: {
    text: string
    bgColor: string
    iconColor: string
  }
  options?: {
    a: { title: string; points: string[]; selected: boolean }
    b: { title: string; points: string[]; selected: boolean }
  }
}

const mockDecisions: DecisionItem[] = [
  {
    id: "d1",
    type: "judgment",
    status: "awaiting_review",
    title: "Navigation UI Component Review",
    project: "Personal Finance App",
    projectIcon: FolderKanban,
    description:
      "The agent has completed the navigation component implementation with tab-based navigation for desktop and a bottom bar for mobile. The component includes animated transitions, active state indicators, and responsive breakpoints. Ready for visual and UX review before merging.",
    aiRecommendation: {
      text: "Approve with minor change: the mobile bottom bar should use 48px touch targets instead of the current 36px to meet accessibility guidelines. All other aspects meet the design spec.",
      bgColor: "bg-info",
      iconColor: "text-info-foreground",
    },
  },
  {
    id: "d2",
    type: "decision",
    status: "awaiting_review",
    title: "API Architecture Decision",
    project: "Personal Finance App",
    projectIcon: FolderKanban,
    description:
      "The project needs a client API layer. Two approaches have been evaluated: REST with OpenAPI codegen, and GraphQL with Apollo Client. This decision affects the entire frontend data layer and future API evolution.",
    aiRecommendation: {
      text: "Recommend GraphQL. The app has complex nested data (accounts > transactions > categories) that maps naturally to GraphQL queries. This avoids over-fetching on the dashboard and simplifies the 12 planned list/detail views.",
      bgColor: "bg-success",
      iconColor: "text-success-foreground",
    },
  },
  {
    id: "d3",
    type: "deployment",
    status: "awaiting_review",
    title: "Deployment Strategy: ML Training Pipeline",
    project: "ML Training Pipeline",
    projectIcon: Server,
    description:
      "The training pipeline is ready for deployment. Two infrastructure configurations have been evaluated based on cost, latency, and fault tolerance.",
    options: {
      a: {
        title: "Option A: Single Large Instance",
        points: [
          "1x p4d.24xlarge (8x A100 GPUs)",
          "Lower cost per training run ($32/hr)",
          "Simpler orchestration, no cross-node communication",
          "Single point of failure",
        ],
        selected: true,
      },
      b: {
        title: "Option B: Distributed Multi-Node",
        points: [
          "4x p3.8xlarge (4x V100 GPUs each)",
          "Higher cost ($48/hr combined)",
          "Fault tolerant: survives single node failure",
          "Enables larger batch sizes via data parallelism",
        ],
        selected: false,
      },
    },
  },
  {
    id: "d4",
    type: "judgment",
    status: "deferred",
    title: "Dashboard Layout Approval",
    project: "ML Training Pipeline",
    projectIcon: Server,
    description:
      "Dashboard wireframe ready. Shows training metrics, loss curves, and GPU utilization in a grid layout. Deferred pending stakeholder availability.",
    aiRecommendation: {
      text: "The layout follows standard ML dashboard conventions. Recommend approving with the addition of a model comparison view.",
      bgColor: "bg-info",
      iconColor: "text-info-foreground",
    },
  },
  {
    id: "d5",
    type: "decision",
    status: "completed",
    title: "Branch Strategy: Data Pipeline",
    project: "Genomic Data Pipeline",
    projectIcon: Rocket,
    description:
      "Hypothesis A (BWA-MEM2) was selected based on 2x speedup benchmark. Memory requirements addressed with 256GB node allocation.",
    aiRecommendation: {
      text: "BWA-MEM2 confirmed as optimal. Benchmarks validated on production data.",
      bgColor: "bg-success",
      iconColor: "text-success-foreground",
    },
  },
]

const tabs: { key: TabFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "awaiting_review", label: "Awaiting Review" },
  { key: "deferred", label: "Deferred" },
  { key: "completed", label: "Completed" },
]

export function JudgmentQueue() {
  const [tab, setTab] = useState<TabFilter>("all")

  const pendingCount = mockDecisions.filter(
    (d) => d.status === "awaiting_review"
  ).length

  const filteredItems =
    tab === "all"
      ? mockDecisions
      : mockDecisions.filter((d) => d.status === tab)

  const statusBadge = (status: DecisionItem["status"]) => {
    switch (status) {
      case "awaiting_review":
        return (
          <Badge className="bg-warning text-warning-foreground border-transparent">
            Awaiting Judgment
          </Badge>
        )
      case "deferred":
        return (
          <Badge className="bg-muted text-muted-foreground border-transparent">
            Deferred
          </Badge>
        )
      case "completed":
        return (
          <Badge className="bg-success text-success-foreground border-transparent">
            Completed
          </Badge>
        )
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Page Header */}
      <div className="flex flex-col gap-4 border-b border-border px-10 py-6">
        {/* Title Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">Judgment Queue</h1>
            <Badge className="bg-warning text-warning-foreground border-transparent px-3 py-0.5">
              {pendingCount} pending
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              Batch Mode
            </Button>
            <Button variant="outline" size="sm">
              <ListFilter className="h-4 w-4" />
              Filter
            </Button>
          </div>
        </div>

        {/* Tabs Row */}
        <div className="flex items-center">
          <div className="flex items-center gap-1 rounded-full border border-border p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "cursor-pointer rounded-full px-4 py-1.5 text-[13px] font-medium transition-all",
                  tab === t.key
                    ? "bg-secondary shadow-sm text-foreground"
                    : "bg-white text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex flex-col gap-5 overflow-auto px-10 py-6">
        {filteredItems.map((item) => {
          const ProjectIcon = item.projectIcon

          if (item.type === "deployment" && item.options) {
            return (
              <Card key={item.id} className="shadow-sm">
                {/* Card Header */}
                <div className="flex flex-col gap-3 p-5 px-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ProjectIcon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {item.project}
                      </span>
                    </div>
                    {statusBadge(item.status)}
                  </div>
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                </div>

                {/* Card Content - Options */}
                <CardContent className="px-6 pb-5">
                  <div className="flex gap-4">
                    <div
                      className={cn(
                        "flex-1 rounded-xl bg-muted p-4",
                        item.options.a.selected
                          ? "border-2 border-primary"
                          : "border border-border"
                      )}
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <h4 className="text-sm font-semibold">
                          {item.options.a.title}
                        </h4>
                        {item.options.a.selected && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                      <ul className="flex flex-col gap-1.5">
                        {item.options.a.points.map((point, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 text-sm text-muted-foreground"
                          >
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                            {point}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div
                      className={cn(
                        "flex-1 rounded-xl bg-muted p-4",
                        item.options.b.selected
                          ? "border-2 border-primary"
                          : "border border-border"
                      )}
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <h4 className="text-sm font-semibold">
                          {item.options.b.title}
                        </h4>
                        {item.options.b.selected && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                      <ul className="flex flex-col gap-1.5">
                        {item.options.b.points.map((point, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 text-sm text-muted-foreground"
                          >
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                            {point}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </CardContent>

                {/* Card Actions */}
                <div className="flex items-center justify-between border-t border-border px-6 py-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-muted hover:bg-muted/80"
                  >
                    Defer
                  </Button>
                  <Button
                    size="sm"
                    className="bg-primary text-white hover:bg-primary/90"
                  >
                    Confirm Selection
                  </Button>
                </div>
              </Card>
            )
          }

          return (
            <Card key={item.id} className="shadow-sm">
              {/* Card Header */}
              <div className="flex flex-col gap-3 p-5 px-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ProjectIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {item.project}
                    </span>
                  </div>
                  {statusBadge(item.status)}
                </div>
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </div>

              {/* Card Content - AI Recommendation */}
              {item.aiRecommendation && (
                <CardContent className="px-6 pb-5">
                  <div
                    className={cn(
                      "flex gap-3 rounded-xl p-4",
                      item.aiRecommendation.bgColor
                    )}
                  >
                    <Sparkles
                      className={cn(
                        "mt-0.5 h-5 w-5 shrink-0",
                        item.aiRecommendation.iconColor
                      )}
                    />
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold">
                        AI Recommendation
                      </span>
                      <p className="text-sm leading-relaxed">
                        {item.aiRecommendation.text}
                      </p>
                    </div>
                  </div>
                </CardContent>
              )}

              {/* Card Actions */}
              <div className="flex items-center justify-between border-t border-border px-6 py-4">
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-muted hover:bg-muted/80"
                  >
                    Defer
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="bg-destructive hover:bg-destructive/90"
                  >
                    Reject
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm">
                    Modify
                  </Button>
                  <Button
                    size="sm"
                    className="bg-primary text-white hover:bg-primary/90"
                  >
                    Approve
                  </Button>
                </div>
              </div>
            </Card>
          )
        })}

        {filteredItems.length === 0 && (
          tab === "all" ? (
            // Main empty state when no items at all - celebratory
            <EmptyState
              icon={CheckCircle2}
              title="All caught up!"
              description="Nothing needs your attention right now. Your agents are working autonomously. Check back later or view your active projects to see progress."
              action={{
                label: "View Projects",
                href: "/projects",
              }}
              variant="success"
              className="py-20"
            />
          ) : tab === "awaiting_review" ? (
            // Empty awaiting review - celebratory
            <EmptyState
              icon={CheckCircle2}
              title="No pending reviews"
              description="Your agents are working through the plan. You'll be notified when decisions need your input."
              variant="success"
              className="py-20"
            />
          ) : tab === "deferred" ? (
            // Empty deferred
            <EmptyState
              icon={CheckCircle2}
              title="No deferred items"
              description="You haven't deferred any decisions. Items you defer will appear here for later review."
              className="py-20"
            />
          ) : (
            // Empty completed
            <EmptyState
              icon={CheckCircle2}
              title="No completed reviews yet"
              description="Items you approve, reject, or complete will appear here for reference."
              className="py-20"
            />
          )
        )}
      </div>
    </div>
  )
}

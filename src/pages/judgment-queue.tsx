import { CheckCircle2, Clock, XCircle, AlertCircle, Eye, GitBranch } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
type TabFilter = "all" | "judgments" | "decisions" | "errors"

export function JudgmentQueue() {
  const [tab, setTab] = useState<TabFilter>("all")

  // Mock decision items
  const mockDecisions = [
    {
      id: "d1",
      type: "judgment" as const,
      title: "Navigation UI Review",
      project: "Personal Finance App",
      description: "The navigation component is ready for review. Agent has implemented tab-based navigation with bottom bar for mobile.",
      priority: "high" as const,
    },
    {
      id: "d2",
      type: "decision" as const,
      title: "API Architecture Decision",
      project: "Personal Finance App",
      description: "Choose between REST and GraphQL for the client API layer. Agent recommends GraphQL for flexible queries.",
      priority: "high" as const,
    },
    {
      id: "d3",
      type: "judgment" as const,
      title: "Dashboard Layout Approval",
      project: "ML Training Pipeline",
      description: "Dashboard wireframe ready. Shows training metrics, loss curves, and GPU utilization in a grid layout.",
      priority: "medium" as const,
    },
    {
      id: "d4",
      type: "decision" as const,
      title: "Branch Strategy: Data Pipeline",
      project: "Genomic Data Pipeline",
      description: "Hypothesis A (BWA-MEM2) shows 2x speedup but higher memory. Hypothesis B (minimap2) is more stable. Choose direction.",
      priority: "medium" as const,
    },
    {
      id: "d5",
      type: "error" as const,
      title: "HPC Job Failure",
      project: "LLM Benchmark Suite",
      description: "Slurm job 48291 failed with OOM. Model too large for allocated GPU memory. Need to adjust batch size or request larger node.",
      priority: "high" as const,
    },
  ]

  const filteredItems = tab === "all"
    ? mockDecisions
    : mockDecisions.filter((d) => tab === "errors" ? d.type === "error" : d.type === tab.slice(0, -1))

  const tabs: { key: TabFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "judgments", label: "Judgments" },
    { key: "decisions", label: "Decisions" },
    { key: "errors", label: "Errors" },
  ]

  const typeIcons = {
    judgment: Eye,
    decision: GitBranch,
    error: AlertCircle,
  }

  const priorityColors = {
    high: "text-red-500",
    medium: "text-amber-500",
    low: "text-muted-foreground",
  }

  return (
    <div className="flex flex-col gap-6 p-8 px-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Judgment Queue</h1>
          <Badge className="h-7 rounded-full px-3 font-primary text-xs">
            {mockDecisions.length} pending
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors cursor-pointer",
              tab === t.key
                ? "bg-foreground text-background"
                : "border border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-3">
        {filteredItems.map((item) => {
          const Icon = typeIcons[item.type]
          return (
            <Card key={item.id} className="hover:border-primary/40 transition-colors cursor-pointer">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col gap-3 flex-1 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <Icon className={cn("h-4 w-4 shrink-0", item.type === "error" ? "text-red-500" : "text-primary")} />
                      <span className="font-medium text-sm">{item.title}</span>
                      <Badge variant={item.type === "error" ? "destructive" : item.type === "decision" ? "info" : "warning"} className="text-[10px]">
                        {item.type}
                      </Badge>
                      <span className={cn("text-[10px] font-medium", priorityColors[item.priority])}>
                        {item.priority}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                    <span className="text-xs text-muted-foreground">{item.project}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline">
                      <Clock className="h-3.5 w-3.5" />
                      Defer
                    </Button>
                    {item.type === "error" ? (
                      <Button size="sm" variant="destructive">
                        <XCircle className="h-3.5 w-3.5" />
                        Retry
                      </Button>
                    ) : (
                      <Button size="sm">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Approve
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

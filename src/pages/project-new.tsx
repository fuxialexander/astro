import { useState } from "react"
import { useNavigate } from "react-router"
import { Sparkles, Zap, Upload, Link as LinkIcon, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useProjectStore } from "@/stores/project-store"
import { useAgentStore } from "@/stores/agent-store"
import { useSettingsStore } from "@/stores/settings-store"

export function ProjectNew() {
  const [description, setDescription] = useState("")
  const navigate = useNavigate()
  const addProject = useProjectStore((s) => s.addProject)
  const startGeneration = useAgentStore((s) => s.startGeneration)
  const isGenerating = useAgentStore((s) => s.isGenerating)
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)

  function handleGenerate() {
    if (!description.trim()) return
    const id = `proj-${Date.now()}`
    addProject({
      id,
      name: description.slice(0, 50).trim() || "New Project",
      description: description.trim(),
      visionDoc: "",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    navigate(`/project/${id}`)
    // Trigger plan generation after navigation
    if (connectionStatus === "connected") {
      startGeneration(id, description.trim())
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex w-[640px] flex-col items-center gap-8">
        {/* Icon */}
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
          <Sparkles className="h-7 w-7 text-primary-foreground" />
        </div>

        {/* Heading */}
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-3xl font-bold">What are you building?</h1>
          <p className="max-w-[480px] text-center text-[15px] leading-relaxed text-muted-foreground">
            Describe your goal and we'll generate an intelligent plan with tasks, dependencies, and milestones.
          </p>
        </div>

        {/* Input area */}
        <div className="flex w-full flex-col gap-4">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="I'm building a personal finance app with AI-powered budgeting, transaction categorization, and savings goals tracking..."
            className="h-[140px] w-full resize-none rounded-xl border border-border bg-card p-4 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />

          {/* Optional context */}
          <div className="flex flex-col gap-3">
            <span className="text-[13px] font-medium text-muted-foreground">Optional context</span>
            <div className="flex gap-2.5">
              <button className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground hover:border-foreground/20 transition-colors cursor-pointer">
                <Upload className="h-4 w-4" />
                Upload docs
              </button>
              <button className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground hover:border-foreground/20 transition-colors cursor-pointer">
                <LinkIcon className="h-4 w-4" />
                Link repo
              </button>
            </div>
          </div>
        </div>

        {/* Generate button */}
        <Button
          onClick={handleGenerate}
          className="h-12 rounded-xl px-8 text-base font-semibold"
          disabled={!description.trim() || isGenerating}
        >
          {isGenerating ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" />
          ) : (
            <Zap className="h-[18px] w-[18px]" />
          )}
          {isGenerating ? "Generating..." : "Generate Plan"}
        </Button>
      </div>
    </div>
  )
}

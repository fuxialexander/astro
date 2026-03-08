import { useState, useCallback, useRef, useEffect } from "react"
import { FileText, Check, Loader2, Pencil, Eye } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { useProjectStore } from "@/stores/project-store"
import { useActivityStore } from "@/stores/activity-store"
import { cn } from "@/lib/utils"
import type { Project } from "@/types"

function VisionDocEditor({ project }: { project: Project }) {
  const updateProject = useProjectStore((s) => s.updateProject)
  const addActivity = useActivityStore((s) => s.addActivity)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle")
  const [mode, setMode] = useState<"preview" | "edit">(project.visionDoc ? "preview" : "edit")
  const [draft, setDraft] = useState(project.visionDoc ?? "")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftRef = useRef(draft)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Focus textarea when switching to edit mode
  useEffect(() => {
    if (mode === "edit") {
      textareaRef.current?.focus()
    }
  }, [mode])

  // Flush any pending debounced save immediately
  const flushSave = useCallback((value: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setSaveStatus("saving")
    updateProject(project.id, { visionDoc: value })
    addActivity({
      projectId: project.id,
      type: "vision.updated",
      title: "Updated skill.md",
      description: value.slice(0, 100) + (value.length > 100 ? "..." : ""),
    })
    setSaveStatus("saved")
    setTimeout(() => setSaveStatus("idle"), 1500)
  }, [project.id, updateProject, addActivity])

  // Debounced autosave
  const save = useCallback((value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      flushSave(value)
    }, 800)
  }, [flushSave])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setDraft(value)
    draftRef.current = value
    save(value)
  }, [save])

  // Flush pending save on unmount (don't lose edits when dialog closes)
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        flushSave(draftRef.current)
      }
    }
  }, [flushSave])

  return (
    <div className="flex-1 flex flex-col gap-2 min-h-0">
      {/* Toolbar: mode toggle + save status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors",
              mode === "preview"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors",
              mode === "edit"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        </div>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          {saveStatus === "saving" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving...
            </>
          )}
          {saveStatus === "saved" && (
            <>
              <Check className="h-3 w-3" />
              Saved
            </>
          )}
        </span>
      </div>

      {/* Content area */}
      {mode === "preview" ? (
        <div className="flex-1 min-h-[300px] overflow-auto rounded-md border border-input bg-background p-4">
          {draft ? (
            <MarkdownRenderer content={draft} className="text-sm" />
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No content yet. Click Edit to add skill context.
            </p>
          )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="flex-1 min-h-[300px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          placeholder="Define the skill context, product vision, research question, or project context here. This will be provided to all agents working on this project..."
          value={draft}
          onChange={handleChange}
        />
      )}
    </div>
  )
}

export function VisionDocDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            skill.md
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Define the skill context for agents. This is injected into every agent session as context.
          </p>
        </DialogHeader>
        {open && <VisionDocEditor project={project} />}
      </DialogContent>
    </Dialog>
  )
}

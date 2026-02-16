import { useState, useCallback } from "react"
import { FileText, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { VoiceInputButton } from "@/components/ui/voice-input-button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useProjectStore } from "@/stores/project-store"
import { useActivityStore } from "@/stores/activity-store"
import { useVoiceTranscription } from "@/hooks/use-voice-transcription"
import type { Project } from "@/types"

export function VisionDocDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
}) {
  const updateProject = useProjectStore((s) => s.updateProject)
  const addActivity = useActivityStore((s) => s.addActivity)
  const [draft, setDraft] = useState(project.visionDoc ?? "")
  const [saved, setSaved] = useState(false)

  const handleTranscript = useCallback((text: string) => {
    setDraft((prev) => {
      const newText = prev ? prev + ' ' + text : text
      return newText
    })
    setSaved(false)
  }, [])

  const {
    isRecording,
    isTranscribing,
    isAvailable,
    duration,
    toggleRecording,
  } = useVoiceTranscription({
    onTranscript: handleTranscript,
  })

  const handleSave = useCallback(() => {
    updateProject(project.id, { visionDoc: draft })
    addActivity({
      projectId: project.id,
      type: "vision.updated",
      title: "Updated vision document",
      description: draft.slice(0, 100) + (draft.length > 100 ? "..." : ""),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }, [updateProject, addActivity, project.id, draft])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Vision Document
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Describe your product vision or research question. This is injected into every agent session as context.
          </p>
        </DialogHeader>
        <div className="relative flex-1 flex flex-col">
          <textarea
            className="flex-1 min-h-[300px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            placeholder="Describe your product vision, research question, or project context here. This will be provided to all agents working on this project..."
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setSaved(false)
            }}
          />
          {/* Voice input button */}
          <div className="absolute right-3 top-3">
            <VoiceInputButton
              isRecording={isRecording}
              isTranscribing={isTranscribing}
              isAvailable={isAvailable}
              duration={duration}
              onClick={toggleRecording}
              disabled={false}
            />
          </div>
          {/* Recording indicator */}
          {isRecording && (
            <div className="absolute right-3 bottom-3 flex items-center gap-2 text-xs text-red-500">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              Recording... {Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, '0')}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {saved ? "Saved" : draft !== (project.visionDoc ?? "") ? "Unsaved changes" : ""}
          </span>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={draft === (project.visionDoc ?? "")}
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

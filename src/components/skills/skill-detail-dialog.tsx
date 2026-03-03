import { useState } from "react"
import { Zap, Pencil, Trash2, ExternalLink, Tag } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { useSkillStore, type SkillRow } from "@/stores/skill-store"
import type { OpenClawSkill } from "@/types/skill"

const sourceColors: Record<OpenClawSkill["source"], string> = {
  builtin: "bg-info/10 text-info",
  workspace: "bg-success/10 text-success",
  clawhub: "bg-primary/10 text-primary",
  plugin: "bg-warning/10 text-warning",
  user: "bg-muted/10 text-muted-foreground",
}

interface SkillDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skill: SkillRow | null
}

export function SkillDetailDialog({
  open,
  onOpenChange,
  skill,
}: SkillDetailDialogProps) {
  const toggleSkill = useSkillStore((s) => s.toggleSkill)
  const updateSkill = useSkillStore((s) => s.updateSkill)
  const removeSkill = useSkillStore((s) => s.removeSkill)

  const [isEditingInstructions, setIsEditingInstructions] = useState(false)
  const [editedInstructions, setEditedInstructions] = useState("")
  const [isEditingConfig, setIsEditingConfig] = useState(false)
  const [editedConfig, setEditedConfig] = useState("")
  const [configError, setConfigError] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Reset state when dialog opens/closes or skill changes
  const [prevResetKey, setPrevResetKey] = useState(`${skill?.name}-${open}`)
  const resetKey = `${skill?.name}-${open}`
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey)
    if (skill && open) {
      setIsEditingInstructions(false)
      setEditedInstructions(skill.instructions)
      setIsEditingConfig(false)
      setEditedConfig(JSON.stringify(skill.config || {}, null, 2))
      setConfigError(null)
      setShowDeleteConfirm(false)
    }
  }

  if (!skill) return null

  const handleToggle = () => {
    toggleSkill(skill.id)
  }

  const handleEditInstructions = () => {
    setEditedInstructions(skill.instructions)
    setIsEditingInstructions(true)
  }

  const handleSaveInstructions = () => {
    updateSkill(skill.id, { instructions: editedInstructions })
    setIsEditingInstructions(false)
  }

  const handleCancelEditInstructions = () => {
    setEditedInstructions(skill.instructions)
    setIsEditingInstructions(false)
  }

  const handleEditConfig = () => {
    setEditedConfig(JSON.stringify(skill.config || {}, null, 2))
    setConfigError(null)
    setIsEditingConfig(true)
  }

  const handleSaveConfig = () => {
    try {
      const parsedConfig = JSON.parse(editedConfig)

      // Size validation (100KB limit, server enforces 80KB)
      const configSize = new Blob([editedConfig]).size
      if (configSize > 100 * 1024) {
        setConfigError(`Configuration is too large (${Math.round(configSize / 1024)}KB). Maximum is 100KB.`)
        return
      }

      updateSkill(skill.id, { config: parsedConfig })
      setConfigError(null)
      setIsEditingConfig(false)
    } catch (err) {
      // Keep editing mode open if JSON is invalid
      const errorMessage = err instanceof Error ? err.message : 'Invalid JSON syntax'
      setConfigError(`Invalid JSON: ${errorMessage}`)
    }
  }

  const handleCancelEditConfig = () => {
    setEditedConfig(JSON.stringify(skill.config || {}, null, 2))
    setConfigError(null)
    setIsEditingConfig(false)
  }

  const handleDelete = () => {
    removeSkill(skill.id)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="flex flex-col gap-0.5">
              <DialogTitle className="flex items-center gap-2">
                {skill.name}
                {skill.version && (
                  <span className="text-xs font-normal text-muted-foreground">
                    v{skill.version}
                  </span>
                )}
              </DialogTitle>
            </div>
          </div>
          <DialogDescription>{skill.description}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="instructions">Instructions</TabsTrigger>
            <TabsTrigger value="configuration">Configuration</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex-1 flex flex-col gap-4 min-h-0">
            {/* Metadata row: source, category, tags */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={cn(
                  "text-[10px] py-0 h-4 border-0",
                  sourceColors[skill.source]
                )}
              >
                {skill.source}
              </Badge>
              {skill.category && (
                <Badge variant="outline" className="text-[10px] py-0 h-4">
                  {skill.category}
                </Badge>
              )}
              {skill.tags && skill.tags.length > 0 && (
                <>
                  {skill.tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="text-[10px] py-0 h-4 gap-1"
                    >
                      <Tag className="h-2.5 w-2.5" />
                      {tag}
                    </Badge>
                  ))}
                </>
              )}
              {skill.homepage && (
                <a
                  href={skill.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-info hover:underline"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  Homepage
                </a>
              )}
            </div>

            {/* Enable/disable toggle */}
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label
                htmlFor="skill-enabled-toggle"
                className="text-sm font-medium cursor-pointer"
              >
                Enabled
              </Label>
              <Switch
                id="skill-enabled-toggle"
                checked={skill.enabled}
                onCheckedChange={handleToggle}
              />
            </div>
          </TabsContent>

          <TabsContent value="instructions" className="flex-1 flex flex-col gap-2 min-h-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Instructions</span>
              {!isEditingInstructions && skill.source !== "builtin" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleEditInstructions}
                  className="h-7 gap-1.5 text-xs"
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </Button>
              )}
            </div>

            {isEditingInstructions ? (
              <div className="flex flex-col gap-2 flex-1 min-h-0">
                <Textarea
                  value={editedInstructions}
                  onChange={(e) => setEditedInstructions(e.target.value)}
                  className="flex-1 min-h-[200px] max-h-[40vh] font-mono text-xs resize-none"
                  placeholder="Enter skill instructions (markdown supported)..."
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={handleCancelEditInstructions}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveInstructions}>
                    Save Instructions
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-border bg-muted/30 p-4 overflow-y-auto max-h-[40vh]">
                {skill.instructions ? (
                  <MarkdownRenderer
                    content={skill.instructions}
                    className="text-sm"
                  />
                ) : (
                  <span className="text-sm text-muted-foreground italic">
                    No instructions provided.
                  </span>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="configuration" className="flex-1 flex flex-col gap-2 min-h-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Configuration</span>
              {!isEditingConfig && skill.source !== "builtin" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleEditConfig}
                  className="h-7 gap-1.5 text-xs"
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </Button>
              )}
            </div>

            {isEditingConfig ? (
              <div className="flex flex-col gap-2 flex-1 min-h-0">
                <Textarea
                  value={editedConfig}
                  onChange={(e) => setEditedConfig(e.target.value)}
                  className={cn(
                    "flex-1 min-h-[200px] max-h-[40vh] font-mono text-xs resize-none",
                    configError && "border-destructive focus-visible:ring-destructive"
                  )}
                  placeholder='{"key": "value"}'
                  disabled={skill.source === "builtin"}
                />

                {/* Hints and validation messages */}
                <div className="flex flex-col gap-1.5 text-xs">
                  {configError && (
                    <p className="text-destructive font-medium">
                      {configError}
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    Max 100KB (server enforces 80KB API limit)
                  </p>
                  {(skill.category === "k8s" ||
                    skill.name.toLowerCase().includes("k8s") ||
                    skill.name.toLowerCase().includes("kubernetes")) && (
                    <p className="text-info text-xs">
                      💡 K8s skills typically require: <code className="bg-muted px-1 py-0.5 rounded">namespace</code>, <code className="bg-muted px-1 py-0.5 rounded">pvcName</code>, <code className="bg-muted px-1 py-0.5 rounded">containerImage</code>
                    </p>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={handleCancelEditConfig}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveConfig}>
                    Save Configuration
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-border bg-muted/30 p-4 overflow-y-auto max-h-[40vh]">
                {skill.source === "builtin" && (
                  <p className="text-xs text-muted-foreground mb-2 italic">
                    Read-only (builtin skill)
                  </p>
                )}
                <pre className="text-xs font-mono">
                  {JSON.stringify(skill.config || {}, null, 2)}
                </pre>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Footer with delete confirmation */}
        {showDeleteConfirm ? (
          <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">{skill.name}</span>?
              This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete}>
                Delete Skill
              </Button>
            </div>
          </div>
        ) : (
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            {skill.source !== "builtin" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-destructive hover:text-destructive gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            ) : (
              <div />
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

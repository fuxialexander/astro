import { useState } from "react"
import { Diamond } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PlanNode } from "@/types"

interface MilestoneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  milestone?: PlanNode // If provided, we're editing; otherwise creating
  onSave: (data: {
    title: string
    description: string
    dueDate?: string
  }) => void
  onDelete?: () => void
}

export function MilestoneDialog({
  open,
  onOpenChange,
  milestone,
  onSave,
  onDelete,
}: MilestoneDialogProps) {
  // Use key prop on Dialog to reset state when milestone changes
  const dialogKey = milestone?.id || "new"
  const [title, setTitle] = useState(milestone?.title || "")
  const [description, setDescription] = useState(milestone?.description || "")
  const [dueDate, setDueDate] = useState(milestone?.dueDate || "")

  // Adjust state during render when milestone prop changes (avoids useEffect setState)
  const [prevMilestoneId, setPrevMilestoneId] = useState(milestone?.id)
  if (milestone?.id !== prevMilestoneId) {
    setPrevMilestoneId(milestone?.id)
    setTitle(milestone?.title || "")
    setDescription(milestone?.description || "")
    setDueDate(milestone?.dueDate || "")
  }

  const handleSave = () => {
    if (!title.trim()) return
    onSave({
      title: title.trim(),
      description: description.trim(),
      dueDate: dueDate || undefined,
    })
    onOpenChange(false)
  }

  const handleDelete = () => {
    if (onDelete) {
      onDelete()
      onOpenChange(false)
    }
  }

  return (
    <Dialog key={dialogKey} open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Diamond className="h-4 w-4 text-primary-foreground" />
            </div>
            <DialogTitle>{milestone ? "Edit Milestone" : "New Milestone"}</DialogTitle>
          </div>
          <DialogDescription>
            {milestone
              ? "Update milestone details and timeline."
              : "Create a new milestone to organize and track project progress."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="e.g., MVP Launch, Beta Release"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) {
                  handleSave()
                }
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              placeholder="What needs to be accomplished by this milestone?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="dueDate">Due Date</Label>
            <Input
              id="dueDate"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between">
          <div>
            {milestone && onDelete && (
              <Button variant="destructive" onClick={handleDelete}>
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!title.trim()}>
              {milestone ? "Save Changes" : "Create Milestone"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

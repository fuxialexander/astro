import { useState, useEffect } from "react"
import { MessageSquare } from "lucide-react"
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
import type { Session } from "@/types"
import { getSessionTitle } from "@/stores/session-store"

interface SessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: Session | null
  onRename: (sessionId: string, title: string) => void
  onDelete: (sessionId: string) => void
}

export function SessionDialog({
  open,
  onOpenChange,
  session,
  onRename,
  onDelete,
}: SessionDialogProps) {
  const [title, setTitle] = useState("")
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Reset state when session changes or dialog opens
  useEffect(() => {
    if (session && open) {
      setTitle(getSessionTitle(session))
      setShowDeleteConfirm(false)
    }
  }, [session?.id, open])

  const handleSave = () => {
    if (!session || !title.trim()) return
    onRename(session.id, title.trim())
    onOpenChange(false)
  }

  const handleDelete = () => {
    if (!session) return
    onDelete(session.id)
    onOpenChange(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && title.trim()) {
      handleSave()
    }
  }

  if (!session) return null

  const messageCount = session.messages.length
  const createdDate = session.createdAt.toLocaleDateString()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <MessageSquare className="h-4 w-4 text-primary-foreground" />
            </div>
            <DialogTitle>Edit Session</DialogTitle>
          </div>
          <DialogDescription>
            {messageCount} messages - Created {createdDate}
          </DialogDescription>
        </DialogHeader>

        {showDeleteConfirm ? (
          <div className="flex flex-col gap-4 py-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete this session? This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="session-title">Session Title</Label>
                <Input
                  id="session-title"
                  placeholder="Enter a title for this session"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                />
              </div>
            </div>

            <DialogFooter className="flex items-center justify-between">
              <div>
                <Button
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={!title.trim()}>
                  Save
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

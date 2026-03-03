import { useState, useEffect } from "react"
import { ArrowUpRight, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useConvertToProject } from "@/hooks/use-convert-to-project"
import type { PlanNode } from "@/types"

interface ConvertToProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  node: PlanNode
  hasGitHub: boolean
}

export function ConvertToProjectDialog({
  open,
  onOpenChange,
  node,
  hasGitHub,
}: ConvertToProjectDialogProps) {
  const [projectName, setProjectName] = useState(node.title)
  const { convert, isConverting } = useConvertToProject()

  // Reset name when node changes
  useEffect(() => {
    setProjectName(node.title)
  }, [node.id, node.title])

  const handleConvert = async () => {
    const ok = await convert({ node, projectName: projectName.trim() || node.title })
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5" />
            Turn into Project
          </DialogTitle>
          <DialogDescription>
            Convert this isolated node into a new project with an AI-generated plan.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="project-name" className="text-sm font-medium text-foreground">
              Project name
            </label>
            <input
              id="project-name"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              disabled={isConverting}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-3">
            <p className="text-sm font-medium text-foreground">What will happen:</p>
            <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                Create a new project with AI-generated plan
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                Carry over execution history &amp; comments as context
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                Remove this node from current project
              </li>
              {hasGitHub && node.prNumber && (
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                  Close PR #{node.prNumber}
                </li>
              )}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isConverting}
          >
            Cancel
          </Button>
          <Button onClick={handleConvert} disabled={isConverting || !projectName.trim()}>
            {isConverting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Converting...
              </>
            ) : (
              "Convert"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

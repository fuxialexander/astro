import { useState } from "react"
import { Cloud, Globe, Copy, Check } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

interface AddEnvironmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted p-3 font-mono text-sm">
      <code className="flex-1 text-foreground">{text}</code>
      <Button variant="ghost" size="sm" onClick={handleCopy} className="h-8 w-8 p-0 shrink-0">
        {copied ? (
          <Check className="h-4 w-4 text-success" />
        ) : (
          <Copy className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>
    </div>
  )
}

export function AddEnvironmentDialog({ open, onOpenChange }: AddEnvironmentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Add Environment</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="remote" className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="remote" className="flex-1 gap-1.5">
              <Globe className="h-4 w-4" />
              Remote
            </TabsTrigger>
            <TabsTrigger value="cloud" className="flex-1 gap-1.5">
              <Cloud className="h-4 w-4" />
              Cloud
            </TabsTrigger>
          </TabsList>

          <TabsContent value="remote" className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                On your personal computer (with SSH config), run:
              </p>
              <CopyBlock text="npx @astroanywhere/agent@latest launch" />
              <p className="text-xs text-muted-foreground">
                This sets up and starts the agent locally, then discovers remote hosts from your SSH config
                and starts agents on them automatically. <strong>Prerequisite:</strong> Key-based SSH login must be configured.
              </p>
            </div>
            <Separator />
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-foreground">Single machine only</p>
              <p className="text-xs text-muted-foreground">
                To set up only the current machine without SSH host discovery:
              </p>
              <CopyBlock text="npx @astroanywhere/agent@latest launch --no-ssh-config" />
            </div>
            <p className="text-xs text-muted-foreground">
              <strong>For HPC clusters:</strong> Install on the login node if allowed by your administrator.
              Some clusters restrict login node processes, so check your cluster's policies first.
            </p>
          </TabsContent>

          <TabsContent value="cloud" className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Cloud className="h-10 w-10 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">Coming soon</p>
                <p className="text-xs text-muted-foreground">
                  Cloud environment integration (AWS, GCP) is under development
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

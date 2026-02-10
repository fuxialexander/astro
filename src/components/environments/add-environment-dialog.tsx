import { useState } from "react"
import { Monitor, Server, Cloud, Globe, Copy, Check, Loader2 } from "lucide-react"
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
  onMachineAdded?: () => void
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

export function AddEnvironmentDialog({ open, onOpenChange, onMachineAdded }: AddEnvironmentDialogProps) {
  const [simulating, setSimulating] = useState<string | null>(null)

  const handleSimulate = async (type: "local" | "hpc", name?: string) => {
    setSimulating(type)
    try {
      const res = await fetch("/api/device/simulate-machine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name }),
      })
      if (!res.ok) throw new Error("Failed to simulate machine")
      onMachineAdded?.()
    } catch (err) {
      console.error("Failed to simulate machine:", err)
    } finally {
      setSimulating(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Add Environment</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="local" className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="local" className="flex-1 gap-1.5">
              <Monitor className="h-4 w-4" />
              Local
            </TabsTrigger>
            <TabsTrigger value="remote" className="flex-1 gap-1.5">
              <Globe className="h-4 w-4" />
              Remote
            </TabsTrigger>
            <TabsTrigger value="hpc" className="flex-1 gap-1.5">
              <Server className="h-4 w-4" />
              HPC
            </TabsTrigger>
            <TabsTrigger value="cloud" className="flex-1 gap-1.5">
              <Cloud className="h-4 w-4" />
              Cloud
            </TabsTrigger>
          </TabsList>

          <TabsContent value="local" className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Run this command on the machine you want to connect:
              </p>
              <CopyBlock text="npx @nexus/agent setup" />
            </div>
            <a
              href="/device"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              Or enter a device code manually
            </a>
            <Separator />
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">For testing and demos:</p>
              <Button
                variant="outline"
                onClick={() => handleSimulate("local")}
                disabled={simulating !== null}
              >
                {simulating === "local" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Monitor className="h-4 w-4" />
                )}
                Simulate Machine
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="remote" className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                On the remote machine, clone the repo and run:
              </p>
              <CopyBlock text="./scripts/agent-setup.sh yourdomain.com" />
            </div>
            <p className="text-xs text-muted-foreground">
              This requires a Cloudflare Tunnel running on the server.
              See <code className="font-mono bg-muted px-1 rounded">scripts/start-tunnel.sh</code> for setup.
            </p>
          </TabsContent>

          <TabsContent value="hpc" className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Run on your cluster's login node:
              </p>
              <CopyBlock text='npx @nexus/agent setup --type hpc --name "Sherlock HPC"' />
            </div>
            <Separator />
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">For testing and demos:</p>
              <Button
                variant="outline"
                onClick={() => handleSimulate("hpc", "Sherlock HPC")}
                disabled={simulating !== null}
              >
                {simulating === "hpc" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Server className="h-4 w-4" />
                )}
                Simulate HPC Cluster
              </Button>
            </div>
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

import { useState, useEffect } from "react"
import { Monitor, Cloud, Globe, Copy, Check, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useExecutionStore } from "@/stores/execution-store"
import { isServerMode } from "@/lib/app-mode"

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
  const isMultiTenant = isServerMode()
  const providers = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)

  // Load providers when dialog opens
  useEffect(() => {
    if (open && !providersLoaded) {
      loadProviders()
    }
  }, [open, providersLoaded, loadProviders])

  // Check if Claude Code or Codex is available locally
  const claudeCode = providers.find((p) => p.id === "claude-code")
  const codex = providers.find((p) => p.id === "codex")
  const hasLocalProvider = claudeCode?.available || codex?.available

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Add Environment</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue={isMultiTenant ? "remote" : "local"} className="mt-2">
          <TabsList className="w-full">
            {!isMultiTenant && (
              <TabsTrigger value="local" className="flex-1 gap-1.5">
                <Monitor className="h-4 w-4" />
                Local
              </TabsTrigger>
            )}
            <TabsTrigger value="remote" className="flex-1 gap-1.5">
              <Globe className="h-4 w-4" />
              Remote
            </TabsTrigger>
            <TabsTrigger value="cloud" className="flex-1 gap-1.5">
              <Cloud className="h-4 w-4" />
              Cloud
            </TabsTrigger>
          </TabsList>

          {!isMultiTenant && (
            <TabsContent value="local" className="mt-4 flex flex-col gap-4">
              {hasLocalProvider ? (
                // Provider detected - show ready state
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30 p-4">
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-green-900 dark:text-green-100">
                        Local environment ready
                      </p>
                      <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                        {claudeCode?.available && `Claude Code is installed and authenticated`}
                        {codex?.available && !claudeCode?.available && `Codex is installed and authenticated`}
                        {claudeCode?.available && codex?.available && ` (both Claude Code and Codex available)`}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your local machine is ready to execute tasks. You can start using it in your projects.
                  </p>
                </div>
              ) : (
                // No provider detected - show setup instructions
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-4">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                        No local agent detected
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                        Install and authenticate Claude Code or Codex to run tasks locally
                      </p>
                    </div>
                  </div>

                  {/* Claude Code setup */}
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium text-foreground">Option 1: Claude Code (Recommended)</p>
                    {claudeCode?.installed && !claudeCode.available ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-xs text-muted-foreground">Claude Code is installed but not authenticated.</p>
                        <div className="flex flex-col gap-1.5">
                          <p className="text-xs font-medium text-foreground">Run this command to authenticate:</p>
                          <CopyBlock text="claude-code auth login" />
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <p className="text-xs text-muted-foreground">Install Claude Code CLI and authenticate:</p>
                        <div className="flex flex-col gap-1.5">
                          <CopyBlock text="npm install -g @anthropics/claude-code" />
                          <CopyBlock text="claude-code auth login" />
                        </div>
                        <a
                          href="https://docs.anthropic.com/claude-code"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          View Claude Code documentation
                        </a>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Codex setup */}
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium text-foreground">Option 2: Codex</p>
                    {codex?.installed && !codex.available ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-xs text-muted-foreground">Codex is installed but not authenticated.</p>
                        <div className="flex flex-col gap-1.5">
                          <p className="text-xs font-medium text-foreground">Run this command to authenticate:</p>
                          <CopyBlock text="codex auth login" />
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <p className="text-xs text-muted-foreground">Install Codex CLI and authenticate:</p>
                        <div className="flex flex-col gap-1.5">
                          <CopyBlock text="npm install -g codex-cli" />
                          <CopyBlock text="codex auth login" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
          )}

          <TabsContent value="remote" className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                On the remote machine (server, HPC login node, etc.), run:
              </p>
              <CopyBlock text="npx @astroanywhere/agent setup" />
            </div>
            <p className="text-xs text-muted-foreground">
              <strong>For HPC clusters:</strong> Install on the login node if allowed by your administrator.
              Some clusters restrict login node processes, so check your cluster's policies first.
            </p>
            <Separator />
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-foreground">Batch adding</p>
              <p className="text-xs text-muted-foreground">
                To batch add servers from your SSH config without connecting to each machine separately, run:
              </p>
              <CopyBlock text="npx @astroanywhere/agent setup --with-ssh-config" />
              <p className="text-xs text-muted-foreground">
                You'll be prompted to choose which SSH hosts to add. <strong>Prerequisite:</strong> Key-based login must be configured for those hosts.
              </p>
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

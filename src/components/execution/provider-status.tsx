import { useEffect } from "react"
import { CheckCircle2, XCircle, RefreshCw, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useExecutionStore } from "@/stores/execution-store"
import { useSettingsStore } from "@/stores/settings-store"

interface ProviderStatusProps {
  compact?: boolean
}

export function ProviderStatus({ compact = false }: ProviderStatusProps) {
  const providers = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const redetectProviders = useExecutionStore((s) => s.redetectProviders)
  const getAvailableProvider = useExecutionStore((s) => s.getAvailableProvider)
  const defaultProvider = useSettingsStore((s) => s.defaultProvider)

  useEffect(() => {
    if (!providersLoaded) {
      loadProviders()
    }
  }, [providersLoaded, loadProviders])

  // Show the user's selected provider if set, otherwise fall back to first available
  const selectedProvider = defaultProvider
    ? providers.find((p) => p.id === defaultProvider) ?? null
    : null
  const displayProvider = selectedProvider ?? getAvailableProvider()
  const isLoading = !providersLoaded

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5">
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : displayProvider?.available ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-warning" />
              )}
              <span className="text-xs text-muted-foreground">
                {isLoading ? "Checking..." : displayProvider?.name || "No agent"}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {displayProvider?.available
              ? `${displayProvider.name} is ready for task execution`
              : displayProvider
                ? `${displayProvider.name} is not available. Check authentication.`
                : "No agent available. Install Claude Code or Codex CLI."}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Agent Providers</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={redetectProviders}
          disabled={isLoading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Detecting providers...
        </div>
      ) : providers.length === 0 ? (
        <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          No providers detected. Ensure Claude is installed.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center justify-between rounded-lg bg-muted p-3"
            >
              <div className="flex items-center gap-2">
                {provider.available ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : (
                  <XCircle className="h-4 w-4 text-warning" />
                )}
                <span className="text-sm font-medium">{provider.name}</span>
              </div>
              <Badge
                variant={
                  provider.available
                    ? "success"
                    : provider.installed
                      ? "warning"
                      : "secondary"
                }
              >
                {provider.available
                  ? "Ready"
                  : provider.installed
                    ? "Not authenticated"
                    : "Not installed"}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {!displayProvider?.available && providersLoaded && (
        <div className="rounded-lg bg-warning/10 p-3 text-sm">
          <p className="font-medium text-warning">No agent available</p>
          <p className="text-muted-foreground mt-1">
            Install and authenticate an agent provider (Claude Code or Codex CLI).
          </p>
        </div>
      )}
    </div>
  )
}

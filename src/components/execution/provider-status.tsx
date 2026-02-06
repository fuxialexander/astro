import { useEffect } from "react"
import { CheckCircle2, XCircle, RefreshCw, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useExecutionStore } from "@/stores/execution-store"

interface ProviderStatusProps {
  compact?: boolean
}

export function ProviderStatus({ compact = false }: ProviderStatusProps) {
  const providers = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const redetectProviders = useExecutionStore((s) => s.redetectProviders)
  const getAvailableProvider = useExecutionStore((s) => s.getAvailableProvider)

  useEffect(() => {
    if (!providersLoaded) {
      loadProviders()
    }
  }, [providersLoaded, loadProviders])

  const availableProvider = getAvailableProvider()
  const isLoading = !providersLoaded

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5">
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : availableProvider ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-warning" />
              )}
              <span className="text-xs text-muted-foreground">
                {isLoading ? "Checking..." : availableProvider?.name || "No agent"}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {availableProvider
              ? `${availableProvider.name} is ready for task execution`
              : "No agent available. Ensure Claude Code is installed and authenticated."}
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
          No providers detected. Ensure Claude Code is installed.
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

      {!availableProvider && providersLoaded && (
        <div className="rounded-lg bg-warning/10 p-3 text-sm">
          <p className="font-medium text-warning">No agent available</p>
          <p className="text-muted-foreground mt-1">
            Run <code className="font-mono bg-muted px-1 rounded">claude login</code> to
            authenticate Claude Code.
          </p>
        </div>
      )}
    </div>
  )
}

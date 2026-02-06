import { Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAgentStore } from "@/stores/agent-store"
import { ScrollArea } from "@/components/ui/scroll-area"

export function GenerationOverlay() {
  const { streamText, error, abort } = useAgentStore()

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex w-[480px] flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="font-semibold">Generating plan...</span>
          </div>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={abort}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Stream output */}
        <ScrollArea className="h-[200px] rounded-lg bg-muted p-4">
          {streamText ? (
            <pre className="whitespace-pre-wrap font-primary text-xs text-muted-foreground leading-relaxed">
              {streamText}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground">Waiting for response...</p>
          )}
        </ScrollArea>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}

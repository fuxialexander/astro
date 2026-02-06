import { Terminal, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSettingsStore } from "@/stores/settings-store"

const models = [
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
]

export function Settings() {
  const { model, setModel, connectionStatus, checkConnection } = useSettingsStore()

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center border-b border-border px-6">
        <h1 className="font-semibold">Settings</h1>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-[560px] flex flex-col gap-8">
          {/* Connection Status */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Claude API Connection</h2>
            <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <div
                  className={`h-2.5 w-2.5 rounded-full ${
                    connectionStatus === "connected"
                      ? "bg-success"
                      : connectionStatus === "checking"
                        ? "bg-warning animate-pulse"
                        : "bg-destructive"
                  }`}
                />
                <span className="text-sm">
                  {connectionStatus === "connected"
                    ? "Connected"
                    : connectionStatus === "checking"
                      ? "Checking..."
                      : "Disconnected"}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={checkConnection}
                disabled={connectionStatus === "checking"}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${connectionStatus === "checking" ? "animate-spin" : ""}`} />
                Retry
              </Button>
            </div>
            {connectionStatus === "disconnected" && (
              <div className="flex items-start gap-3 rounded-lg border border-border bg-muted p-4">
                <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Authentication required</span>
                  <span className="text-xs text-muted-foreground">
                    Run <code className="rounded bg-background px-1.5 py-0.5 font-primary text-foreground">claude login</code> in
                    your terminal to authenticate with your Max plan or set an API key.
                  </span>
                </div>
              </div>
            )}
          </section>

          {/* Model Selection */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Model</h2>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Model used for plan generation and chat. Sonnet is recommended for most tasks.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from "react"
import { Terminal, RefreshCw, Monitor, Trash2, Cloud, Server, Laptop, MoreVertical, Edit2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useSettingsStore } from "@/stores/settings-store"
import { useMachinesStore, type RegisteredMachine } from "@/stores/machines-store"

const models = [
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
]

// Mock user ID - in a real app this would come from auth
const MOCK_USER_ID = "user-1"

function getEnvironmentIcon(type: string) {
  switch (type) {
    case "local":
      return <Laptop className="h-4 w-4" />
    case "hpc":
      return <Server className="h-4 w-4" />
    case "cloud":
      return <Cloud className="h-4 w-4" />
    default:
      return <Monitor className="h-4 w-4" />
  }
}

function getPlatformLabel(platform: string) {
  switch (platform) {
    case "darwin":
      return "macOS"
    case "linux":
      return "Linux"
    case "win32":
      return "Windows"
    default:
      return platform
  }
}

function formatDate(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function MachineCard({ machine, onRename }: {
  machine: RegisteredMachine
  onRename: (name: string) => void
}) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [newName, setNewName] = useState(machine.name)
  const { revokeMachine } = useMachinesStore()

  const handleRename = () => {
    if (newName.trim() && newName !== machine.name) {
      onRename(newName.trim())
    }
    setIsRenaming(false)
  }

  return (
    <Card className={machine.isRevoked ? "opacity-50" : ""}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
              {getEnvironmentIcon(machine.environmentType)}
            </div>
            <div className="flex flex-col gap-1">
              {isRenaming ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="h-7 w-40"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename()
                      if (e.key === "Escape") setIsRenaming(false)
                    }}
                  />
                  <Button size="sm" variant="outline" className="h-7" onClick={handleRename}>
                    Save
                  </Button>
                </div>
              ) : (
                <span className="font-medium">{machine.name}</span>
              )}
              <span className="text-xs text-muted-foreground">
                {machine.hostname} · {getPlatformLabel(machine.platform)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge
              variant={machine.isConnected ? "default" : "secondary"}
              className={machine.isConnected ? "bg-success text-success-foreground" : ""}
            >
              {machine.isConnected ? "Connected" : "Offline"}
            </Badge>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsRenaming(true)}>
                  <Edit2 className="mr-2 h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <Dialog>
                  <DialogTrigger asChild>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={(e) => e.preventDefault()}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Revoke Access
                    </DropdownMenuItem>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Revoke Machine Access</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                      Are you sure you want to revoke access for <strong>{machine.name}</strong>?
                      This will disconnect the machine and invalidate its tokens. You'll need to
                      re-authenticate to use this machine again.
                    </p>
                    <div className="flex justify-end gap-2">
                      <DialogClose asChild>
                        <Button variant="outline">Cancel</Button>
                      </DialogClose>
                      <DialogClose asChild>
                        <Button variant="destructive" onClick={() => revokeMachine(machine.id)}>
                          Revoke Access
                        </Button>
                      </DialogClose>
                    </div>
                  </DialogContent>
                </Dialog>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {machine.providers.map((provider) => (
            <Badge key={provider} variant="outline" className="text-xs">
              {provider}
            </Badge>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Registered {formatDate(machine.registeredAt)}</span>
          <span>Last seen {formatDate(machine.lastSeenAt)}</span>
        </div>
      </CardContent>
    </Card>
  )
}

export function Settings() {
  const { model, setModel, connectionStatus, checkConnection } = useSettingsStore()
  const { machines, loading, error, fetchMachines, renameMachine } = useMachinesStore()

  useEffect(() => {
    fetchMachines(MOCK_USER_ID)
  }, [fetchMachines])

  const activeMachines = machines.filter((m) => !m.isRevoked)

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center border-b border-border px-6">
        <h1 className="font-semibold">Settings</h1>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-[640px] flex flex-col gap-8">
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

          {/* Registered Machines */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Registered Machines</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchMachines(MOCK_USER_ID)}
                disabled={loading}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {loading && machines.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                Loading machines...
              </div>
            ) : activeMachines.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-8">
                <Monitor className="h-8 w-8 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">No machines registered</p>
                  <p className="text-sm text-muted-foreground">
                    Run <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npx @nexus/agent setup</code> on
                    a machine to register it.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {activeMachines.map((machine) => (
                  <MachineCard
                    key={machine.id}
                    machine={machine}
                    onRename={(name) => renameMachine(machine.id, name)}
                  />
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Machines registered with this workspace. Revoking a machine will disconnect it
              and invalidate its authentication tokens.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

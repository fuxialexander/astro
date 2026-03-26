/**
 * Playground Session Header
 *
 * Compact header bar showing session title, machine info, status, provider selector, and controls.
 */

import { useState, useEffect } from "react"
import { ArrowLeft, Loader2, X, Laptop, CheckCircle2, AlertCircle, FolderOpen, StopCircle, RotateCcw, Bot, ChevronDown, Pencil, Wrench, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { InlineRenameInput } from "@/components/inline-rename-input"
import { PROVIDER_NAMES } from "@/components/execution/provider-utils"
import type { ProviderStatus } from "@/types"

type PlaygroundStatus = 'running' | 'waiting' | 'completed' | 'error' | 'stopped'

interface PlaygroundHeaderProps {
  title: string
  status: PlaygroundStatus
  machineName?: string
  workingDirectory?: string
  fileSidebarOpen: boolean
  activeProvider?: string
  availableProviders?: ProviderStatus[]
  onProviderChange?: (providerId: string) => void
  onBack: () => void
  onAbort: () => void
  onRetry?: () => void
  onToggleFileSidebar: () => void
  onRename?: (newTitle: string) => void
  /** Execution start time for elapsed timer */
  startedAt?: Date
  /** Number of tool calls executed so far */
  toolCallCount?: number
  /** Model name being used */
  modelName?: string
}

/**
 * Live elapsed timer that updates every second.
 * Parent must set key={startedAt.getTime()} to reset state across session retries.
 */
function ElapsedTimer({ startedAt, status }: { startedAt: Date; status: PlaygroundStatus }) {
  const startMs = startedAt.getTime()
  const [now, setNow] = useState(() => Math.floor(performance.timeOrigin + performance.now()))

  useEffect(() => {
    if (status !== 'running' && status !== 'waiting') return
    const interval = setInterval(() => setNow(Math.floor(performance.timeOrigin + performance.now())), 1000)
    return () => clearInterval(interval)
  }, [status])

  const seconds = Math.max(0, Math.floor((now - startMs) / 1000))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return (
    <span className="tabular-nums">
      {m}:{s.toString().padStart(2, "0")}
    </span>
  )
}

export function PlaygroundHeader({
  title,
  status,
  machineName,
  workingDirectory,
  fileSidebarOpen,
  activeProvider,
  availableProviders,
  onProviderChange,
  onBack,
  onAbort,
  onRetry,
  onToggleFileSidebar,
  onRename,
  startedAt,
  toolCallCount,
  modelName,
}: PlaygroundHeaderProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const statusConfig: Record<PlaygroundStatus, { label: string; color: string; icon: React.ReactNode }> = {
    running: {
      label: "Running",
      color: "bg-primary/10 text-primary",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    waiting: {
      label: "Waiting for input",
      color: "bg-warning/10 text-warning",
      icon: <AlertCircle className="h-3 w-3" />,
    },
    completed: {
      label: "Completed",
      color: "bg-success/10 text-success",
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    error: {
      label: "Error",
      color: "bg-destructive/10 text-destructive",
      icon: <AlertCircle className="h-3 w-3" />,
    },
    stopped: {
      label: "Stopped",
      color: "bg-destructive/10 text-destructive",
      icon: <StopCircle className="h-3 w-3 fill-destructive" />,
    },
  }

  const config = statusConfig[status]
  const showProviderSelector = availableProviders && availableProviders.length > 1 && onProviderChange
  const providerLabel = activeProvider
    ? (PROVIDER_NAMES[activeProvider] || activeProvider)
    : "Auto"

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>

      <div className="flex-1 min-w-0">
        {isRenaming && onRename ? (
          <InlineRenameInput
            value={title}
            onSave={(newTitle) => {
              onRename(newTitle)
              setIsRenaming(false)
            }}
            onCancel={() => setIsRenaming(false)}
            validate={(v) => v.trim().length === 0 ? "Title cannot be empty" : null}
            className="text-sm font-semibold"
          />
        ) : (
          <div className="group/title flex items-center gap-1.5">
            <h2
              className="text-sm font-semibold truncate cursor-pointer"
              onDoubleClick={() => onRename && setIsRenaming(true)}
              title="Double-click to rename"
            >
              {title}
            </h2>
            {onRename && (
              <button
                onClick={() => setIsRenaming(true)}
                className="p-0.5 rounded opacity-0 group-hover/title:opacity-60 hover:!opacity-100 transition-opacity"
                title="Rename session"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <span className={cn("flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full font-medium", config.color)}>
            {config.icon}
            <span className="hidden md:inline">{config.label}</span>
          </span>
          {machineName && (
            <span className="hidden md:flex items-center gap-1 text-[10px] text-muted-foreground">
              <Laptop className="h-3 w-3" />
              {machineName}
            </span>
          )}
          {workingDirectory && (
            <span className="hidden md:inline text-[10px] text-muted-foreground truncate font-mono">
              {workingDirectory}
            </span>
          )}
          {/* Session stats: elapsed time, tool calls, model */}
          {startedAt && (
            <>
              <span className="text-[10px] text-muted-foreground/40 hidden md:inline">&middot;</span>
              <span className="hidden md:flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                <ElapsedTimer key={startedAt.getTime()} startedAt={startedAt} status={status} />
              </span>
            </>
          )}
          {toolCallCount != null && toolCallCount > 0 && (
            <>
              <span className="text-[10px] text-muted-foreground/40 hidden md:inline">&middot;</span>
              <span className="hidden md:flex items-center gap-1 text-[10px] text-muted-foreground">
                <Wrench className="h-3 w-3" />
                {toolCallCount} tool{toolCallCount !== 1 ? 's' : ''}
              </span>
            </>
          )}
          {modelName && (
            <>
              <span className="text-[10px] text-muted-foreground/40 hidden md:inline">&middot;</span>
              <span className="hidden md:inline text-[10px] text-muted-foreground font-mono">
                {modelName}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Provider Selector — switch AI agent between rounds */}
      {showProviderSelector && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors cursor-pointer max-w-[140px] shrink-0">
              <Bot className="h-3 w-3 shrink-0" />
              <span className="truncate">{providerLabel}</span>
              <ChevronDown className="h-2.5 w-2.5 opacity-50 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[220px]">
            <DropdownMenuLabel>AI Agent</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => onProviderChange("")}
              className="gap-2"
            >
              <Bot className="h-3.5 w-3.5" />
              <span>Auto</span>
              {!activeProvider && (
                <CheckCircle2 className="h-3.5 w-3.5 ml-auto text-primary" />
              )}
            </DropdownMenuItem>
            {availableProviders.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => onProviderChange(p.id)}
                className="gap-2"
                disabled={!p.available}
              >
                <Bot className="h-3.5 w-3.5" />
                <span>{PROVIDER_NAMES[p.id] || p.name || p.id}</span>
                {activeProvider === p.id && (
                  <CheckCircle2 className="h-3.5 w-3.5 ml-auto text-primary" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Button
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8 shrink-0", fileSidebarOpen && "bg-muted")}
        onClick={onToggleFileSidebar}
        title="Toggle file sidebar"
      >
        <FolderOpen className="h-4 w-4" />
      </Button>

      {(status === 'running' || status === 'waiting') && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAbort}
          className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0 h-8"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          <span className="hidden md:inline">Stop</span>
        </Button>
      )}

      {(status === 'stopped' || status === 'error' || status === 'completed') && onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="shrink-0 h-8 gap-1.5"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Edit & Retry</span>
          <span className="md:hidden">Retry</span>
        </Button>
      )}
    </div>
  )
}

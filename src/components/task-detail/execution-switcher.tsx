import { useEffect, useMemo, useRef } from "react"
import { ChevronDown, Check, Loader2, XCircle, Clock, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useExecutionStore } from "@/stores/execution-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useTeamStore } from "@/stores/team-store"
import { formatRelativeTime } from "@/lib/date-utils"
import { cn } from "@/lib/utils"
import type { TaskExecution } from "@/types"

interface ExecutionSwitcherProps {
  nodeId: string
  activeExecutionId: string
  onSwitch: (executionId: string) => void
}

const statusIcon: Record<string, React.ReactNode> = {
  running: <Loader2 className="h-3 w-3 animate-spin text-info" />,
  pending: <Clock className="h-3 w-3 text-muted-foreground" />,
  success: <Check className="h-3 w-3 text-success" />,
  failure: <XCircle className="h-3 w-3 text-destructive" />,
  cancelled: <XCircle className="h-3 w-3 text-muted-foreground" />,
}

export function ExecutionSwitcher({ nodeId, activeExecutionId, onSwitch }: ExecutionSwitcherProps) {
  const nodeExecutions = useExecutionStore((s) => s.nodeExecutions.get(nodeId))
  const loadNodeExecutions = useExecutionStore((s) => s.loadNodeExecutions)
  const currentUserId = useUserProfileStore((s) => s.profile.id)
  const activeTeamId = useTeamStore((s) => s.activeTeamId)
  const teamMembers = useTeamStore((s) => activeTeamId ? s.teamMembers[activeTeamId] : undefined)
  // Load all executions for this node; re-fetch when nodeId changes
  const fetchedRef = useRef<string | null>(null)
  useEffect(() => {
    if (fetchedRef.current === nodeId) return
    fetchedRef.current = nodeId
    loadNodeExecutions(nodeId)
  }, [nodeId, loadNodeExecutions])

  const executions = useMemo(() => {
    if (!nodeExecutions || nodeExecutions.length === 0) return []
    // Sort by most recent first
    return [...nodeExecutions].sort((a, b) => {
      const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0
      const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0
      return bTime - aTime
    })
  }, [nodeExecutions])

  const resolveName = (userId: string | undefined) => {
    if (!userId) return "Unknown"
    if (userId === currentUserId) return "You"
    const member = teamMembers?.find((m) => m.userId === userId)
    return member?.user?.name || "Teammate"
  }

  // Don't render if there's only one execution (or none)
  if (executions.length <= 1) return null

  const activeExec = executions.find((e) => e.executionId === activeExecutionId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <User className="h-3 w-3" />
          <span>{activeExec ? resolveName(activeExec.userId) : "Execution"}</span>
          <span className="text-muted-foreground">({executions.length})</span>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {executions.map((exec) => (
          <ExecutionMenuItem
            key={exec.executionId}
            execution={exec}
            isActive={exec.executionId === activeExecutionId}
            isMine={exec.userId === currentUserId}
            name={resolveName(exec.userId)}
            onSelect={() => onSwitch(exec.executionId)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ExecutionMenuItem({
  execution,
  isActive,
  isMine,
  name,
  onSelect,
}: {
  execution: TaskExecution
  isActive: boolean
  isMine: boolean
  name: string
  onSelect: () => void
}) {
  const time = execution.completedAt ?? execution.startedAt
  const isRunning = execution.status === "running" || execution.status === "pending"

  return (
    <DropdownMenuItem
      onClick={onSelect}
      className={cn("flex items-center gap-2 cursor-pointer", isActive && "bg-accent")}
    >
      {statusIcon[execution.status] ?? statusIcon.pending}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn("text-xs font-medium truncate", isMine && "text-primary")}>
            {name}
          </span>
          {isMine && (
            <span className="text-[9px] bg-primary/10 text-primary px-1 rounded">you</span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {isRunning ? "Running..." : time ? formatRelativeTime(time) : ""}
        </div>
      </div>
      {isActive && <Check className="h-3 w-3 text-primary shrink-0" />}
    </DropdownMenuItem>
  )
}

/**
 * Team Machines Section
 *
 * Shows machines shared with the current team (contributed by teammates),
 * and allows the user to contribute/withdraw their own machines.
 *
 * Rendered inside the Environments page when the 'team-machines' feature flag is on.
 */

import { useEffect } from "react"
import { Users, Share2, Monitor, CheckCircle2, XCircle, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { EmptyState } from "@/components/ui/empty-state"
import { useMachinesStore, type RegisteredMachine } from "@/stores/machines-store"
import { useToastStore } from "@/stores/toast-store"
import { useTeamStore } from "@/stores/team-store"
import { formatRelativeTime } from "@/lib/date-utils"

// ─── My Machine Row ─────────────────────────────────────────────────────────

function MyMachineRow({ machine, onToggleTeam }: {
  machine: RegisteredMachine
  onToggleTeam: (machineId: string, teamId: string, shared: boolean) => void
}) {
  const teams = useTeamStore((s) => s.teams)
  const teamIds = machine.teamIds ?? (machine.teamId ? [machine.teamId] : [])
  const sharedCount = teamIds.length

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/40 transition-colors">
      <div className="flex-shrink-0">
        <Monitor className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{machine.name}</span>
          {machine.isConnected
            ? <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
            : <XCircle className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
        </div>
        <div className="text-xs text-muted-foreground truncate">{machine.hostname} · {machine.platform}</div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
              <Share2 className="w-3 h-3" />
              {sharedCount === 0
                ? "Share"
                : sharedCount === 1
                  ? `Shared (1 team)`
                  : `Shared (${sharedCount} teams)`}
              <ChevronDown className="w-3 h-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="end">
            <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">Share with teams</div>
            {teams.map((team) => {
              const isShared = teamIds.includes(team.id)
              return (
                <label
                  key={team.id}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-muted/60 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={isShared}
                    onCheckedChange={() => onToggleTeam(machine.id, team.id, !isShared)}
                  />
                  <span className="text-sm truncate">{team.name}</span>
                </label>
              )
            })}
            {teams.length === 0 && (
              <div className="text-xs text-muted-foreground px-2 py-1.5">No teams available</div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

// ─── Team Machine Row ────────────────────────────────────────────────────────

function TeamMachineRow({ machine }: { machine: RegisteredMachine }) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/40 transition-colors">
      <div className="flex-shrink-0">
        <Monitor className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{machine.name}</span>
          {machine.isConnected
            ? <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
            : <XCircle className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {machine.hostname} · {machine.platform} · contributed {formatRelativeTime(new Date(machine.registeredAt))}
        </div>
      </div>
      <Badge variant="outline" className="text-xs flex-shrink-0">
        {machine.isConnected ? "Online" : "Offline"}
      </Badge>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function TeamMachinesSection() {
  const machines = useMachinesStore((s) => s.machines)
  const teamMachines = useMachinesStore((s) => s.teamMachines)
  const fetchTeamMachines = useMachinesStore((s) => s.fetchTeamMachines)
  const shareMachine = useMachinesStore((s) => s.shareMachine)
  const addToast = useToastStore((s) => s.add)
  const activeTeamId = useTeamStore((s) => s.activeTeamId)

  useEffect(() => {
    fetchTeamMachines()
  }, [fetchTeamMachines, activeTeamId])

  const handleToggleTeam = async (machineId: string, teamId: string, shared: boolean) => {
    const ok = await shareMachine(machineId, teamId, shared)
    if (ok) {
      addToast({
        type: "success",
        title: shared ? "Machine shared with team" : "Machine unshared from team",
      })
      fetchTeamMachines()
    } else {
      addToast({
        type: "error",
        title: "Failed to update sharing",
        description: "Something went wrong. Please try again.",
      })
    }
  }

  // My non-revoked machines eligible for sharing
  const myMachines = machines.filter((m) => !m.isRevoked)

  // Team machines contributed by others (exclude my own)
  const otherTeamMachines = teamMachines.filter((m) => !myMachines.some((mine) => mine.id === m.id))

  return (
    <div className="space-y-6">
      {/* My machines — share toggle */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Share2 className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Contribute your machines</h3>
        </div>
        <Card>
          <CardContent className="p-2">
            {myMachines.length === 0 ? (
              <EmptyState
                icon={Monitor}
                title="No registered machines"
                description="Register a machine via the CLI to contribute it to your team."
              />
            ) : (
              <div className="divide-y divide-border/50">
                {myMachines.map((m) => (
                  <MyMachineRow key={m.id} machine={m} onToggleTeam={handleToggleTeam} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Team machines contributed by others */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Team machines</h3>
          {otherTeamMachines.length > 0 && (
            <Badge variant="secondary" className="text-xs">{otherTeamMachines.length}</Badge>
          )}
        </div>
        <Card>
          <CardContent className="p-2">
            {otherTeamMachines.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No team machines yet"
                description="Teammates can contribute their machines above to make them available here."
              />
            ) : (
              <div className="divide-y divide-border/50">
                {otherTeamMachines.map((m) => (
                  <TeamMachineRow key={m.id} machine={m} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

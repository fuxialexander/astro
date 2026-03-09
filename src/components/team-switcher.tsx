import { useState, useCallback } from "react"
import { ChevronsUpDown, Plus, Crown, ShieldCheck, User, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTeamStore } from "@/stores/team-store"
import { useAuthStore } from "@/stores/auth-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useInitiativeStore } from "@/stores/initiative-store"
import { useActivityStore } from "@/stores/activity-store"
import { useSessionStore } from "@/stores/session-store"
import { useUsageStore } from "@/stores/usage-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useTaskChatStore } from "@/stores/task-chat-store"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

/** Deterministic hue from team name for avatar background */
function teamHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff
  return h % 360
}

function TeamAvatar({ name, size = "sm" }: { name: string; size?: "sm" | "xs" }) {
  const hue = teamHue(name)
  const initials = name.slice(0, 2).toUpperCase()
  const dim = size === "sm" ? "h-6 w-6 text-[11px]" : "h-5 w-5 text-[10px]"
  return (
    <span
      className={cn("rounded-md font-semibold shrink-0 flex items-center justify-center select-none", dim)}
      style={{ background: `hsl(${hue} 55% 48% / 0.18)`, color: `hsl(${hue} 55% 55%)` }}
    >
      {initials}
    </span>
  )
}

const roleConfig: Record<string, { icon: React.ElementType; label: string; classes: string }> = {
  owner:  { icon: Crown,        label: "owner",  classes: "bg-warning/12 text-warning border-warning/20" },
  admin:  { icon: ShieldCheck,  label: "admin",  classes: "bg-info/12 text-info border-info/20" },
  member: { icon: User,         label: "member", classes: "bg-muted text-muted-foreground border-border/50" },
}

export function TeamSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const teams = useTeamStore((s) => s.teams)
  const activeTeamId = useTeamStore((s) => s.activeTeamId)
  const setActiveTeam = useTeamStore((s) => s.setActiveTeam)
  const teamMembers = useTeamStore((s) => s.teamMembers)
  const addTeam = useTeamStore((s) => s.addTeam)
  const authUser = useAuthStore((s) => s.user)

  const [open, setOpen] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newTeamName, setNewTeamName] = useState("")
  const [newTeamDescription, setNewTeamDescription] = useState("")
  const [creating, setCreating] = useState(false)
  const [switching, setSwitching] = useState(false)

  const activeTeam = teams.find((t) => t.id === activeTeamId)

  const getUserRole = useCallback((teamId: string): string | null => {
    const members = teamMembers[teamId] || []
    const member = members.find((m) => m.userId === authUser?.id)
    return member?.role || null
  }, [teamMembers, authUser?.id])

  const handleSelectTeam = useCallback((teamId: string) => {
    if (teamId === activeTeamId) {
      setOpen(false)
      return
    }

    setSwitching(true)
    setActiveTeam(teamId)
    setOpen(false)

    // Reset dependent stores so they reload with new team context
    useProjectStore.setState({ loaded: false })
    usePlanStore.setState({ loaded: false })
    useInitiativeStore.setState({ loaded: false })
    useActivityStore.setState({ loaded: false })
    useSessionStore.setState({ loaded: false })
    useUsageStore.setState({ loaded: false })
    useExecutionStore.setState({ loaded: false })
    useTaskChatStore.setState({ loaded: false })

    // Trigger reloads
    Promise.all([
      useProjectStore.getState().load(),
      usePlanStore.getState().load(),
      useInitiativeStore.getState().load(),
      useActivityStore.getState().loadActivities(),
      useSessionStore.getState().load(),
      useUsageStore.getState().load(),
      useExecutionStore.getState().load(),
      useTaskChatStore.getState().load(),
    ]).finally(() => setSwitching(false))
  }, [activeTeamId, setActiveTeam])

  const handleCreateTeam = useCallback(async () => {
    if (!newTeamName.trim()) return
    setCreating(true)
    try {
      const team = {
        id: crypto.randomUUID(),
        name: newTeamName.trim(),
        description: newTeamDescription.trim(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      addTeam(team)
      handleSelectTeam(team.id)
      setCreateDialogOpen(false)
      setNewTeamName("")
      setNewTeamDescription("")
    } finally {
      setCreating(false)
    }
  }, [newTeamName, newTeamDescription, addTeam, handleSelectTeam])

  // Don't render if no teams
  if (teams.length === 0) return null

  if (collapsed) {
    return (
      <div className="flex justify-center py-1">
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-muted/50 transition-colors relative">
                  {switching ? (
                    <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
                  ) : activeTeam ? (
                    <TeamAvatar name={activeTeam.name} size="sm" />
                  ) : (
                    <span className="h-6 w-6 rounded-md bg-muted flex items-center justify-center text-[11px] font-semibold text-muted-foreground">?</span>
                  )}
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{activeTeam?.name || "Teams"}</TooltipContent>
          </Tooltip>
          <PopoverContent side="right" align="start" className="w-56 p-1">
            <TeamList
              teams={teams}
              activeTeamId={activeTeamId}
              getUserRole={getUserRole}
              onSelect={handleSelectTeam}
              onCreateClick={() => { setOpen(false); setCreateDialogOpen(true) }}
            />
          </PopoverContent>
        </Popover>

        <CreateTeamDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          name={newTeamName}
          onNameChange={setNewTeamName}
          description={newTeamDescription}
          onDescriptionChange={setNewTeamDescription}
          creating={creating}
          onSubmit={handleCreateTeam}
        />
      </div>
    )
  }

  return (
    <>
      <div className="px-4 pb-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors border border-border/50"
            >
              {switching ? (
                <Loader2 className="h-5 w-5 text-muted-foreground animate-spin shrink-0" />
              ) : activeTeam ? (
                <TeamAvatar name={activeTeam.name} />
              ) : (
                <span className="h-6 w-6 rounded-md bg-muted flex items-center justify-center text-[11px] text-muted-foreground shrink-0">?</span>
              )}
              <span className="flex-1 text-left truncate text-[13px]">
                {activeTeam?.name || "Select team"}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[232px] p-1">
            <TeamList
              teams={teams}
              activeTeamId={activeTeamId}
              getUserRole={getUserRole}
              onSelect={handleSelectTeam}
              onCreateClick={() => { setOpen(false); setCreateDialogOpen(true) }}
            />
          </PopoverContent>
        </Popover>
      </div>

      <CreateTeamDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        name={newTeamName}
        onNameChange={setNewTeamName}
        description={newTeamDescription}
        onDescriptionChange={setNewTeamDescription}
        creating={creating}
        onSubmit={handleCreateTeam}
      />
    </>
  )
}

function TeamList({
  teams,
  activeTeamId,
  getUserRole,
  onSelect,
  onCreateClick,
}: {
  teams: { id: string; name: string }[]
  activeTeamId: string | undefined
  getUserRole: (teamId: string) => string | null
  onSelect: (teamId: string) => void
  onCreateClick: () => void
}) {
  return (
    <div className="flex flex-col">
      <div className="px-2 pt-1 pb-1 text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">
        Workspaces
      </div>
      {teams.map((team) => {
        const role = getUserRole(team.id)
        const isActive = team.id === activeTeamId
        const cfg = roleConfig[role ?? "member"] ?? roleConfig.member
        const RoleIcon = cfg.icon
        return (
          <button
            key={team.id}
            onClick={() => onSelect(team.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors w-full text-left",
              isActive
                ? "bg-accent/70 text-accent-foreground"
                : "hover:bg-muted/50 text-foreground"
            )}
          >
            {/* Active ring indicator */}
            <span className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0 transition-all",
              isActive ? "bg-primary" : "bg-transparent"
            )} />
            <TeamAvatar name={team.name} size="xs" />
            <span className="flex-1 truncate text-[13px]">{team.name}</span>
            {role && (
              <span className={cn(
                "flex items-center gap-0.5 text-[10px] font-medium rounded px-1 py-0.5 border shrink-0",
                cfg.classes
              )}>
                <RoleIcon className="h-2.5 w-2.5" />
                {cfg.label}
              </span>
            )}
          </button>
        )
      })}
      <div className="h-px bg-border/60 my-1 mx-1" />
      <button
        onClick={onCreateClick}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors w-full text-left"
      >
        <span className="h-1.5 w-1.5 shrink-0" />
        <span className="h-5 w-5 rounded-md border border-dashed border-border/70 flex items-center justify-center shrink-0">
          <Plus className="h-3 w-3" />
        </span>
        <span>New workspace</span>
      </button>
    </div>
  )
}

function CreateTeamDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  description,
  onDescriptionChange,
  creating,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onNameChange: (name: string) => void
  description: string
  onDescriptionChange: (desc: string) => void
  creating: boolean
  onSubmit: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            Create a shared workspace to organize projects and collaborate with others.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="team-name" className="text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="team-name"
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSubmit() }}
              placeholder="e.g. Research Lab, Product Team"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="team-description" className="text-sm font-medium text-foreground">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              id="team-description"
              type="text"
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSubmit() }}
              placeholder="What does this workspace work on?"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 py-2 border border-input bg-transparent hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!name.trim() || creating}
            className="inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium h-9 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {creating ? "Creating..." : "Create workspace"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

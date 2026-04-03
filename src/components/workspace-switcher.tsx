import { useState, useCallback } from "react"
import { ChevronsUpDown, Globe, Check, Plus, Crown, ShieldCheck, User, Users, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTeamStore } from "@/stores/team-store"
import { useAuthStore } from "@/stores/auth-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useInitiativeStore } from "@/stores/initiative-store"
import { useActivityStore } from "@/stores/activity-store"
import { useUsageStore } from "@/stores/usage-store"
import { useWorkspaceFilterStore } from "@/stores/workspace-filter-store"
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

type FilterOption = {
  value: string
  label: string
  icon?: React.ReactNode
}

const roleConfig: Record<string, { icon: React.ElementType; label: string; classes: string }> = {
  owner:  { icon: Crown,        label: "owner",  classes: "bg-warning/12 text-warning border-warning/20" },
  admin:  { icon: ShieldCheck,  label: "admin",  classes: "bg-info/12 text-info border-info/20" },
  member: { icon: User,         label: "member", classes: "bg-muted text-muted-foreground border-border/50" },
}

export function WorkspaceSwitcher({ collapsed = false, iconOnly = false }: { collapsed?: boolean; iconOnly?: boolean }) {
  const teams = useTeamStore((s) => s.teams)
  const activeTeamId = useTeamStore((s) => s.activeTeamId)
  const setActiveTeam = useTeamStore((s) => s.setActiveTeam)
  const teamMembers = useTeamStore((s) => s.teamMembers)
  const addTeam = useTeamStore((s) => s.addTeam)
  const authUser = useAuthStore((s) => s.user)
  const workspaceFilter = useWorkspaceFilterStore((s) => s.workspaceFilter)
  const setWorkspaceFilter = useWorkspaceFilterStore((s) => s.setWorkspaceFilter)
  const [open, setOpen] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newTeamName, setNewTeamName] = useState("")
  const [newTeamDescription, setNewTeamDescription] = useState("")
  const [creating, setCreating] = useState(false)
  const [switching, setSwitching] = useState(false)

  const options: FilterOption[] = [
    { value: "all", label: "All Workspaces", icon: <Globe className="h-4 w-4 text-muted-foreground" /> },
    ...teams.map((t) => ({
      value: t.id,
      label: t.name,
      icon: <TeamAvatar name={t.name} size="xs" />,
    })),
  ]

  const selected = options.find((o) => o.value === workspaceFilter) ?? options[0]

  const getUserRole = useCallback((teamId: string): string | null => {
    const members = teamMembers[teamId] || []
    const member = members.find((m) => m.userId === authUser?.id)
    return member?.role || null
  }, [teamMembers, authUser?.id])

  const handleSelect = useCallback((value: string) => {
    setWorkspaceFilter(value)
    setOpen(false)

    // When selecting a specific team, also set it as active team and reload stores.
    // When "All Workspaces" is selected, activeTeamId is intentionally left unchanged —
    // "All Workspaces" is a client-side view filter over already-loaded data, and the
    // backend continues scoped to the last active team for new fetches.
    if (value !== "all") {
      if (value !== activeTeamId) {
        setSwitching(true)
        setActiveTeam(value)

        // Reset dependent stores so they reload with new team context
        useProjectStore.setState({ loaded: false })
        usePlanStore.setState({ loaded: false })
        useInitiativeStore.setState({ loaded: false })
        useActivityStore.setState({ loaded: false })
        useUsageStore.setState({ loaded: false })

        Promise.all([
          useProjectStore.getState().load(),
          usePlanStore.getState().load(),
          useInitiativeStore.getState().load(),
          useActivityStore.getState().loadActivities(),
          useUsageStore.getState().load(),
        ]).finally(() => setSwitching(false))
      }
    }
  }, [activeTeamId, setActiveTeam, setWorkspaceFilter])

  const handleCreateTeam = useCallback(async () => {
    if (!newTeamName.trim()) return
    setCreating(true)
    try {
      const team = {
        id: crypto.randomUUID(),
        name: newTeamName.trim(),
        description: newTeamDescription.trim(),
        featureFlags: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      // addTeam must complete (synchronous Zustand set) before handleSelect,
      // which calls setActiveTeam — that guards with teams.some(t => t.id === teamId).
      // Verify the team is in the store before proceeding.
      addTeam(team)
      if (!useTeamStore.getState().teams.some((t) => t.id === team.id)) {
        console.error("Failed to add team to store before selecting it")
        return
      }
      handleSelect(team.id)
      setCreateDialogOpen(false)
      setNewTeamName("")
      setNewTeamDescription("")
    } finally {
      setCreating(false)
    }
  }, [newTeamName, newTeamDescription, addTeam, handleSelect])

  /** Icon shown in collapsed mode */
  const triggerIcon = <Users className="h-4 w-4 text-muted-foreground" />

  if (collapsed || iconOnly) {
    const popoverSide = iconOnly ? "bottom" : "right"
    const popoverAlign = iconOnly ? "end" : "start"
    return (
      <div className={cn(iconOnly ? "flex" : "flex justify-center py-1")}>
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-muted/50 transition-colors">
                  {switching ? <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" /> : triggerIcon}
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side={popoverSide}>{selected.label}</TooltipContent>
          </Tooltip>
          <PopoverContent side={popoverSide} align={popoverAlign} className="w-56 p-1">
            <OptionList
              options={options}
              selected={workspaceFilter}
              onSelect={handleSelect}
              getUserRole={getUserRole}
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
              ) : (
                selected.icon
              )}
              <span className="flex-1 text-left truncate text-[13px]">
                {selected.label}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[232px] p-1">
            <OptionList
              options={options}
              selected={workspaceFilter}
              onSelect={handleSelect}
              getUserRole={getUserRole}

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

function OptionList({
  options,
  selected,
  onSelect,
  getUserRole,
  onCreateClick,
}: {
  options: FilterOption[]
  selected: string
  onSelect: (value: string) => void
  getUserRole: (teamId: string) => string | null
  onCreateClick: () => void
}) {
  return (
    <div className="flex flex-col">
      <div className="px-2 pt-1 pb-1 text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">
        Workspace
      </div>
      {options.map((option, idx) => {
        const isActive = option.value === selected
        const isTeam = option.value !== "all"
        const role = isTeam ? getUserRole(option.value) : null
        const cfg = role ? (roleConfig[role] ?? roleConfig.member) : null
        const RoleIcon = cfg?.icon
        // Add separator before team options (after "All Workspaces")
        const showSeparator = idx === 1 && options.length > 1
        return (
          <div key={option.value}>
            {showSeparator && <div className="h-px bg-border/60 my-1 mx-1" />}
            <button
              onClick={() => onSelect(option.value)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors w-full text-left",
                isActive
                  ? "bg-accent/70 text-accent-foreground"
                  : "hover:bg-muted/50 text-foreground"
              )}
            >
              <span className="shrink-0 flex items-center justify-center w-5">
                {option.icon}
              </span>
              <span className="flex-1 truncate text-[13px]">{option.label}</span>
              {cfg && RoleIcon && (
                <span className={cn(
                  "flex items-center gap-0.5 text-[10px] font-medium rounded px-1 py-0.5 border shrink-0",
                  cfg.classes
                )}>
                  <RoleIcon className="h-2.5 w-2.5" />
                  {cfg.label}
                </span>
              )}
              {isActive && (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              )}
            </button>
          </div>
        )
      })}
      <>
        <div className="h-px bg-border/60 my-1 mx-1" />
          <button
            onClick={onCreateClick}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors w-full text-left"
          >
            <span className="shrink-0 flex items-center justify-center w-5">
              <span className="h-5 w-5 rounded-md border border-dashed border-border/70 flex items-center justify-center">
                <Plus className="h-3 w-3" />
              </span>
            </span>
            <span>New workspace</span>
          </button>
        </>
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

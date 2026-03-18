import { useState } from "react"
import { ChevronsUpDown, Globe, User, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTeamStore } from "@/stores/team-store"
import { useWorkspaceFilterStore } from "@/stores/workspace-filter-store"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
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

export function WorkspaceSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const teams = useTeamStore((s) => s.teams)
  const workspaceFilter = useWorkspaceFilterStore((s) => s.workspaceFilter)
  const setWorkspaceFilter = useWorkspaceFilterStore((s) => s.setWorkspaceFilter)
  const [open, setOpen] = useState(false)

  const options: FilterOption[] = [
    { value: "all", label: "All Workspaces", icon: <Globe className="h-4 w-4 text-muted-foreground" /> },
    { value: "personal", label: "Personal", icon: <User className="h-4 w-4 text-muted-foreground" /> },
    ...teams.map((t) => ({
      value: t.id,
      label: t.name,
      icon: <TeamAvatar name={t.name} size="xs" />,
    })),
  ]

  const selected = options.find((o) => o.value === workspaceFilter) ?? options[0]

  const handleSelect = (value: string) => {
    setWorkspaceFilter(value)
    setOpen(false)
  }

  /** Icon shown in collapsed mode */
  const triggerIcon = workspaceFilter === "all"
    ? <Globe className="h-4 w-4 text-muted-foreground" />
    : workspaceFilter === "personal"
      ? <User className="h-4 w-4 text-muted-foreground" />
      : (() => {
          const team = teams.find((t) => t.id === workspaceFilter)
          return team ? <TeamAvatar name={team.name} size="sm" /> : <Globe className="h-4 w-4 text-muted-foreground" />
        })()

  if (collapsed) {
    return (
      <div className="flex justify-center py-1">
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-muted/50 transition-colors">
                  {triggerIcon}
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{selected.label}</TooltipContent>
          </Tooltip>
          <PopoverContent side="right" align="start" className="w-56 p-1">
            <OptionList options={options} selected={workspaceFilter} onSelect={handleSelect} />
          </PopoverContent>
        </Popover>
      </div>
    )
  }

  return (
    <div className="px-4 pb-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors border border-border/50"
          >
            {selected.icon}
            <span className="flex-1 text-left truncate text-[13px]">
              {selected.label}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[232px] p-1">
          <OptionList options={options} selected={workspaceFilter} onSelect={handleSelect} />
        </PopoverContent>
      </Popover>
    </div>
  )
}

function OptionList({
  options,
  selected,
  onSelect,
}: {
  options: FilterOption[]
  selected: string
  onSelect: (value: string) => void
}) {
  return (
    <div className="flex flex-col">
      <div className="px-2 pt-1 pb-1 text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">
        Workspace
      </div>
      {options.map((option, idx) => {
        const isActive = option.value === selected
        // Add separator before team options (after "Personal")
        const showSeparator = idx === 2 && options.length > 2
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
              {isActive && (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}

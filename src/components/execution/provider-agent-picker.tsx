import { Check } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { PROVIDER_NAMES } from "@/components/execution/provider-utils"
import { getProviderIcon } from "@/components/execution/provider-icons"

export interface ProviderAgentOption {
  id: string
  /** When false the item renders disabled (still selectable by default). */
  available?: boolean
}

interface ProviderAgentPickerProps {
  /** Available provider ids / objects. Falsy or empty hides the picker entirely. */
  providers: Array<string | ProviderAgentOption>
  /** Currently selected provider id. Empty string means "Auto". */
  value: string
  onChange: (id: string) => void
  align?: "start" | "end"
}

/**
 * Compact AI-agent (provider) picker shared between the plan-view WorkdirBar,
 * the task properties bar, and anywhere else that needs a consistent picker.
 *
 * Visual style: rounded-full pill matching the WorkdirBar. Each provider shows
 * its brand logo via `getProviderIcon` (same as the dashboard picker).
 */
export function ProviderAgentPicker({
  providers,
  value,
  onChange,
  align = "end",
}: ProviderAgentPickerProps) {
  const normalized: ProviderAgentOption[] = providers.map((p) =>
    typeof p === "string" ? { id: p } : p,
  )

  if (normalized.length === 0) return null

  const label = value ? (PROVIDER_NAMES[value] || value) : "Auto"

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-6 items-center gap-1.5 px-2.5 rounded-full border border-border hover:bg-muted transition-colors text-xs shrink-0 cursor-pointer text-muted-foreground"
            >
              {getProviderIcon(value, "h-3 w-3 shrink-0")}
              <span>{label}</span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>AI Agent</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-48 p-1" align={align}>
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">AI Agent</p>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted transition-colors cursor-pointer",
            !value && "bg-accent/50",
          )}
          onClick={() => onChange("")}
        >
          {getProviderIcon("", "h-3.5 w-3.5 shrink-0")}
          <span className="flex-1 text-left text-muted-foreground">Auto</span>
          {!value && <Check className="h-3.5 w-3.5 text-primary" />}
        </button>
        {normalized.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={p.available === false}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
              p.id === value && "bg-accent/50",
            )}
            onClick={() => onChange(p.id)}
          >
            {getProviderIcon(p.id, "h-3.5 w-3.5 shrink-0")}
            <span className="flex-1 text-left font-medium">{PROVIDER_NAMES[p.id] || p.id}</span>
            {p.id === value && <Check className="h-3.5 w-3.5 text-primary" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

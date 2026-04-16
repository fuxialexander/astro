/**
 * WorktreeToggle — tri-state worktree control.
 *
 * States (derived from `value` + `autoOn`):
 *   • value === undefined && !autoOn  → unchecked, auto-off
 *   • value === undefined &&  autoOn  → checked, auto-on (shows hint tooltip)
 *   • value === true                  → forced on (user override)
 *   • value === false                 → forced off (may show warning if autoOn)
 *
 * Clicks cycle auto → explicit opposite → back to auto.
 */

import { useMemo } from "react"
import { Check, AlertTriangle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export interface WorktreeToggleProps {
  /** undefined = auto; true/false = user override */
  value: boolean | undefined
  /** Computed default when value is undefined */
  autoOn: boolean
  /** Tooltip shown when auto-on (e.g. "branch differs from folder") */
  autoReason?: string
  /** Called with the next state (auto → !autoOn → auto). */
  onChange: (v: boolean | undefined) => void
  /** Inline warning shown when user overrode auto-on → off. */
  warning?: string
  disabled?: boolean
}

export function WorktreeToggle({ value, autoOn, autoReason, onChange, warning, disabled }: WorktreeToggleProps) {
  const isAuto = value === undefined
  const checked = isAuto ? autoOn : value === true

  const next = useMemo<boolean | undefined>(() => {
    // auto → explicit opposite of autoOn (user override)
    // explicit → back to auto
    if (isAuto) return !autoOn
    return undefined
  }, [isAuto, autoOn])

  const handleClick = () => {
    if (disabled) return
    onChange(next)
  }

  const showWarning = warning && value === false && autoOn === true

  const trigger = (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1.5 h-7 px-2 rounded-md border text-[11px] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
        checked
          ? "border-primary/40 bg-primary/5 text-primary"
          : "border-border hover:bg-muted text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center h-3.5 w-3.5 rounded border shrink-0",
          checked
            ? "bg-primary text-primary-foreground border-primary"
            : "border-border bg-background",
        )}
      >
        {checked && <Check className="h-2.5 w-2.5" />}
      </span>
      <span>worktree</span>
      {isAuto && autoOn && <span className="text-[10px] opacity-70">(auto)</span>}
    </button>
  )

  return (
    <div className="flex items-center gap-2 min-w-0">
      {autoReason ? (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent>{autoReason}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        trigger
      )}
      {showWarning && (
        <span className="flex items-center gap-1 text-[10px] text-warning min-w-0 truncate">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate">{warning}</span>
        </span>
      )}
    </div>
  )
}

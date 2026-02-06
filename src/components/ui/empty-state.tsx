import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./button"

interface EmptyStateAction {
  label: string
  onClick?: () => void
  href?: string
  variant?: "default" | "outline" | "secondary"
}

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: EmptyStateAction
  secondaryAction?: EmptyStateAction
  /** Use "success" for celebratory states (e.g., "All caught up!") */
  variant?: "default" | "success"
  className?: string
}

function renderAction(act: EmptyStateAction, isPrimary: boolean) {
  const buttonVariant = act.variant ?? (isPrimary ? "default" : "outline")

  if (act.href) {
    return (
      <Button variant={buttonVariant} size="sm" asChild>
        <a href={act.href}>{act.label}</a>
      </Button>
    )
  }

  return (
    <Button variant={buttonVariant} size="sm" onClick={act.onClick}>
      {act.label}
    </Button>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  variant = "default",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 py-12 px-6 text-center",
        className
      )}
    >
      <div
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-xl",
          variant === "success" ? "bg-success/20" : "bg-muted"
        )}
      >
        <Icon
          className={cn(
            "h-6 w-6",
            variant === "success" ? "text-success-foreground" : "text-muted-foreground"
          )}
        />
      </div>
      <div className="flex flex-col gap-1.5 max-w-sm">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      </div>
      {(action || secondaryAction) && (
        <div className="flex items-center gap-2 mt-1">
          {action && renderAction(action, true)}
          {secondaryAction && renderAction(secondaryAction, false)}
        </div>
      )}
    </div>
  )
}

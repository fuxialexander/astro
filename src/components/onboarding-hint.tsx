import { useState, type ReactNode } from "react"
import { X, type LucideIcon } from "lucide-react"

interface OnboardingHintProps {
  hintId: string
  children: ReactNode
  icon?: LucideIcon
  className?: string
}

function isDismissed(hintId: string): boolean {
  try {
    return localStorage.getItem(`astro-hint-dismissed-${hintId}`) === "true"
  } catch {
    return false
  }
}

function dismiss(hintId: string) {
  try {
    localStorage.setItem(`astro-hint-dismissed-${hintId}`, "true")
  } catch {
    // localStorage unavailable
  }
}

export function OnboardingHint({ hintId, children, icon: Icon, className }: OnboardingHintProps) {
  const [hidden, setHidden] = useState(() => isDismissed(hintId))

  if (hidden) return null

  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg border border-info/20 bg-info/5 px-3 py-2.5 text-xs text-muted-foreground ${className ?? ""}`}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-info mt-0.5" />}
      <span className="flex-1">{children}</span>
      <button
        onClick={() => {
          dismiss(hintId)
          setHidden(true)
        }}
        className="shrink-0 rounded-sm p-0.5 hover:bg-info/10 transition-colors"
        aria-label="Dismiss hint"
      >
        <X className="h-3 w-3 text-muted-foreground" />
      </button>
    </div>
  )
}

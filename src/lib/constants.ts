import { AlertTriangle, ArrowUp, Minus, ArrowDown, Circle, Send, Loader, CheckCircle2, Eye, Scissors } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { Priority, Estimate } from "@/types"
import i18n from "@/i18n/config"

export const PRIORITY_CONFIG: Record<Priority, { icon: typeof Circle; color: string; label: string }> = {
  urgent: { icon: AlertTriangle, color: "text-error", label: "Urgent" },
  high: { icon: ArrowUp, color: "text-warning", label: "High" },
  medium: { icon: Minus, color: "text-muted-foreground", label: "Medium" },
  low: { icon: ArrowDown, color: "text-info", label: "Low" },
  none: { icon: Circle, color: "text-muted-foreground", label: "None" },
}

export const ESTIMATE_POINTS: Record<Estimate, number> = {
  XS: 1,
  S: 2,
  M: 3,
  L: 5,
  XL: 8,
}

export const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low", "none"]
export const ESTIMATES: Estimate[] = ["XS", "S", "M", "L", "XL"]

export const DEFAULT_LABELS = [
  { id: "l1", name: "Frontend", color: "#4A6D8A" },
  { id: "l2", name: "Backend", color: "#5F8D6B" },
  { id: "l3", name: "Testing", color: "#A07D4F" },
  { id: "l4", name: "Infrastructure", color: "#7B6B9A" },
  { id: "l5", name: "Research", color: "#9A6878" },
]

/** Returns the i18n-translated label for a given priority. */
export function getPriorityLabel(priority: Priority): string {
  return i18n.t(`priority.${priority}`, { ns: 'common', defaultValue: PRIORITY_CONFIG[priority]?.label ?? priority })
}

/** Returns the i18n-translated label for a given estimate. */
export function getEstimateLabel(estimate: Estimate): string {
  return i18n.t(`estimate.${estimate}`, { ns: 'common', defaultValue: estimate })
}

/* ── Picker option type ── */
export interface PickerOption {
  id: string
  label: string
  icon?: LucideIcon
  iconColor?: string
  shortcut?: string
}

/* ── Priority picker options ── */
export const PRIORITY_OPTIONS: PickerOption[] = [
  { id: "none", label: "No priority", icon: PRIORITY_CONFIG.none.icon, iconColor: PRIORITY_CONFIG.none.color, shortcut: "0" },
  { id: "urgent", label: "Urgent", icon: PRIORITY_CONFIG.urgent.icon, iconColor: PRIORITY_CONFIG.urgent.color, shortcut: "1" },
  { id: "high", label: "High", icon: PRIORITY_CONFIG.high.icon, iconColor: PRIORITY_CONFIG.high.color, shortcut: "2" },
  { id: "medium", label: "Medium", icon: PRIORITY_CONFIG.medium.icon, iconColor: PRIORITY_CONFIG.medium.color, shortcut: "3" },
  { id: "low", label: "Low", icon: PRIORITY_CONFIG.low.icon, iconColor: PRIORITY_CONFIG.low.color, shortcut: "4" },
]

/* ── Estimate picker options ── */
export const ESTIMATE_OPTIONS: PickerOption[] = ESTIMATES.map((e) => ({ id: e, label: e }))

/* ── Status picker options ── */
export const STATUS_OPTIONS: PickerOption[] = [
  { id: "planned", label: "Planned", icon: Circle, iconColor: "text-muted-foreground" },
  { id: "dispatched", label: "Dispatched", icon: Send, iconColor: "text-info" },
  { id: "in_progress", label: "In Progress", icon: Loader, iconColor: "text-info" },
  { id: "auto_verified", label: "Auto Verified", icon: CheckCircle2, iconColor: "text-success" },
  { id: "awaiting_judgment", label: "Needs Review", icon: Eye, iconColor: "text-warning" },
  { id: "completed", label: "Completed", icon: CheckCircle2, iconColor: "text-success" },
  { id: "pruned", label: "Pruned", icon: Scissors, iconColor: "text-muted-foreground" },
]

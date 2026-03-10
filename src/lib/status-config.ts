import { Circle, Send, Loader, CheckCircle2, Eye, Scissors } from "lucide-react"
import type { PlanNode } from "@/types"
import i18n from "@/i18n/config"

type BadgeVariant = "default" | "secondary" | "destructive" | "warning" | "success" | "info" | "outline"

export interface StatusEntry {
  icon: typeof Circle
  label: string
  /** Text color class */
  color: string
  /** Background class for chips/badges */
  bg: string
  /** Badge component variant */
  badgeVariant: BadgeVariant
  /** Timeline bar background class */
  barClass: string
  /** Timeline progress overlay class (only for active statuses) */
  progressClass?: string
}

export const STATUS_CONFIG: Record<PlanNode["status"], StatusEntry> = {
  planned: {
    icon: Circle,
    label: "Planned",
    color: "text-muted-foreground",
    bg: "bg-muted",
    badgeVariant: "secondary",
    barClass: "bg-primary/70",
  },
  dispatched: {
    icon: Send,
    label: "Dispatched",
    color: "text-info",
    bg: "bg-info/10",
    badgeVariant: "info",
    barClass: "bg-info",
    progressClass: "bg-info/80",
  },
  in_progress: {
    icon: Loader,
    label: "In Progress",
    color: "text-info",
    bg: "bg-info/10",
    badgeVariant: "info",
    barClass: "bg-info",
    progressClass: "bg-info/80",
  },
  auto_verified: {
    icon: CheckCircle2,
    label: "Auto Verified",
    color: "text-success",
    bg: "bg-success/10",
    badgeVariant: "success",
    barClass: "bg-success",
  },
  awaiting_judgment: {
    icon: Eye,
    label: "Needs Review",
    color: "text-warning",
    bg: "bg-warning/10",
    badgeVariant: "warning",
    barClass: "bg-warning",
  },
  awaiting_approval: {
    icon: Eye,
    label: "Awaiting Approval",
    color: "text-warning",
    bg: "bg-warning/10",
    badgeVariant: "warning",
    barClass: "bg-warning",
  },
  completed: {
    icon: CheckCircle2,
    label: "Completed",
    color: "text-success",
    bg: "bg-success/10",
    badgeVariant: "success",
    barClass: "bg-success",
  },
  pruned: {
    icon: Scissors,
    label: "Pruned",
    color: "text-muted-foreground",
    bg: "bg-muted",
    badgeVariant: "secondary",
    barClass: "bg-border opacity-40",
  },
}

/** Lookup helpers derived from STATUS_CONFIG */
export const statusLabels: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_CONFIG).map(([k, v]) => [k, v.label])
)

export const statusBadgeVariants: Record<string, BadgeVariant> = Object.fromEntries(
  Object.entries(STATUS_CONFIG).map(([k, v]) => [k, v.badgeVariant])
)

export const statusBarColors: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_CONFIG).map(([k, v]) => [k, v.barClass])
)

export const statusProgressColors: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_CONFIG).filter(([, v]) => v.progressClass).map(([k, v]) => [k, v.progressClass!])
)

/**
 * Returns the i18n-translated label for a given task status.
 * Falls back to the English label from STATUS_CONFIG if translation is unavailable.
 */
export function getStatusLabel(status: PlanNode["status"]): string {
  return i18n.t(`status.${status}`, { ns: 'common', defaultValue: STATUS_CONFIG[status]?.label ?? status })
}

/**
 * Node statuses where the associated execution has finished running.
 * Used to filter out stale execution records that still show "running"
 * after a page refresh. Includes `awaiting_judgment` and `awaiting_approval`
 * because these statuses are set by the execution result — the execution
 * itself has completed; only user review is pending.
 */
export const TERMINAL_NODE_STATUSES: Set<string> = new Set([
  "completed", "auto_verified", "awaiting_judgment", "awaiting_approval", "pruned",
])

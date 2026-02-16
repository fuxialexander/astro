import { Circle, Send, Loader, CheckCircle2, Eye, Scissors } from "lucide-react"
import type { PlanNode } from "@/types"

type BadgeVariant = "default" | "secondary" | "destructive" | "warning" | "success" | "info" | "outline"

export interface StatusEntry {
  icon: typeof Circle
  label: string
  /** Text color class (e.g. "text-blue-600") */
  color: string
  /** Background class for chips/badges (e.g. "bg-blue-500/10") */
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
    color: "text-blue-600",
    bg: "bg-blue-500/10",
    badgeVariant: "info",
    barClass: "bg-blue-500",
    progressClass: "bg-blue-700",
  },
  in_progress: {
    icon: Loader,
    label: "In Progress",
    color: "text-blue-600",
    bg: "bg-blue-500/10",
    badgeVariant: "info",
    barClass: "bg-blue-500",
    progressClass: "bg-blue-700",
  },
  auto_verified: {
    icon: CheckCircle2,
    label: "Auto Verified",
    color: "text-green-600",
    bg: "bg-green-500/10",
    badgeVariant: "success",
    barClass: "bg-green-500",
  },
  awaiting_judgment: {
    icon: Eye,
    label: "Needs Review",
    color: "text-amber-600",
    bg: "bg-amber-500/10",
    badgeVariant: "warning",
    barClass: "bg-amber-500",
  },
  awaiting_approval: {
    icon: Eye,
    label: "Awaiting Approval",
    color: "text-amber-600",
    bg: "bg-amber-500/10",
    badgeVariant: "warning",
    barClass: "bg-amber-500",
  },
  completed: {
    icon: CheckCircle2,
    label: "Completed",
    color: "text-green-600",
    bg: "bg-green-500/10",
    badgeVariant: "success",
    barClass: "bg-green-500",
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

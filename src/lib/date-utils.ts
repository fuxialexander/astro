/**
 * Consolidated date formatting utilities.
 *
 * Previously duplicated across dashboard.tsx, environments.tsx, project-overview.tsx,
 * task-detail.tsx, plan-view.tsx, execution-panel.tsx, session-activity-view.tsx,
 * tool-trace-view.tsx, and view-utils.ts.
 */

/** "Jan 5, 2026" — long date with year */
export function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "\u2014"
  const d = new Date(typeof dateStr === "string" && !dateStr.includes("T") ? dateStr + "T00:00:00Z" : dateStr)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

/** "Jan 5" — short date without year */
export function formatShortDate(dateStr?: string): string {
  if (!dateStr) return ""
  const d = new Date(dateStr + "T00:00:00Z")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

/** "2:30 PM" — locale time (short) */
export function formatTimeShort(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

/** "02:30:15 PM" — locale time with seconds */
export function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/** "5s", "3m 12s", "2h 15m" — human-readable duration from start/end */
export function formatDuration(start?: Date, end?: Date): string {
  if (!start) return "-"
  const endTime = end ? new Date(end).getTime() : Date.now()
  const ms = endTime - new Date(start).getTime()
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

/** "5s ago", "3m ago", "2h ago", "3d ago", "2w ago" — relative time from now */
export function formatRelativeTime(date: Date): string {
  const diff = Date.now() - new Date(date).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}

/** Due-date with urgency coloring: { text: "Jan 5", className: "text-error" } */
export function formatDueDateShort(dateStr?: string): { text: string; className: string } {
  if (!dateStr) return { text: "\u2014", className: "text-muted-foreground" }
  const due = new Date(dateStr + "T00:00:00Z")
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffMs = due.getTime() - today.getTime()
  const diffDays = Math.ceil(diffMs / 86400000)
  const text = due.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  if (diffDays < 0) return { text, className: "text-error" }
  if (diffDays < 7) return { text, className: "text-warning" }
  return { text, className: "text-muted-foreground" }
}

/** Check if a date-string is past due for an active task */
export function isOverdue(dateStr?: string, status?: string): boolean {
  if (!dateStr || status === "completed" || status === "auto_verified" || status === "pruned") return false
  return new Date(dateStr + "T00:00:00Z") < new Date()
}

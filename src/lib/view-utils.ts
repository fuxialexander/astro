export function formatShortDate(dateStr?: string): string {
  if (!dateStr) return ""
  const d = new Date(dateStr + "T00:00:00Z")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

export function isOverdue(dateStr?: string, status?: string): boolean {
  if (!dateStr || status === "completed" || status === "auto_verified" || status === "pruned") return false
  return new Date(dateStr + "T00:00:00Z") < new Date()
}

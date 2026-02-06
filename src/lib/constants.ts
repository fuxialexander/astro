import { AlertTriangle, ArrowUp, Minus, ArrowDown, Circle } from "lucide-react"
import type { Priority, Estimate } from "@/types"

export const PRIORITY_CONFIG: Record<Priority, { icon: typeof Circle; color: string; label: string }> = {
  urgent: { icon: AlertTriangle, color: "text-red-500", label: "Urgent" },
  high: { icon: ArrowUp, color: "text-orange-500", label: "High" },
  medium: { icon: Minus, color: "text-yellow-500", label: "Medium" },
  low: { icon: ArrowDown, color: "text-blue-500", label: "Low" },
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
  { id: "l1", name: "Frontend", color: "#3b82f6" },
  { id: "l2", name: "Backend", color: "#10b981" },
  { id: "l3", name: "Testing", color: "#f59e0b" },
  { id: "l4", name: "Infrastructure", color: "#8b5cf6" },
  { id: "l5", name: "Research", color: "#ec4899" },
]

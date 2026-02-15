import { cn } from "@/lib/utils";

export interface StatusBadgeProps {
  status: "in-progress" | "awaiting" | "completed" | "error" | "planned";
  className?: string;
}

const statusConfig = {
  "in-progress": {
    bg: "bg-blue-500/10",
    dot: "bg-blue-500",
    text: "text-blue-500",
    label: "In Progress",
  },
  awaiting: {
    bg: "bg-amber-500/10",
    dot: "bg-amber-500",
    text: "text-amber-500",
    label: "Awaiting",
  },
  completed: {
    bg: "bg-green-600/10",
    dot: "bg-green-600",
    text: "text-green-600",
    label: "Completed",
  },
  error: {
    bg: "bg-red-500/10",
    dot: "bg-red-500",
    text: "text-red-500",
    label: "Error",
  },
  planned: {
    bg: "bg-gray-400/10",
    dot: "bg-gray-400",
    text: "text-gray-400",
    label: "Planned",
  },
} as const;

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1",
        config.bg,
        className
      )}
    >
      <div className={cn("h-2 w-2 rounded-full", config.dot)} />
      <span className={cn("text-xs font-semibold", config.text)}>
        {config.label}
      </span>
    </div>
  );
}

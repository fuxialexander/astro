import { cn } from "@/lib/utils";

export interface StatusBadgeProps {
  status: "in-progress" | "awaiting" | "completed" | "error" | "planned";
  className?: string;
}

const statusConfig = {
  "in-progress": {
    bg: "bg-info/10",
    dot: "bg-info",
    text: "text-info",
    label: "In Progress",
  },
  awaiting: {
    bg: "bg-warning/10",
    dot: "bg-warning",
    text: "text-warning",
    label: "Awaiting",
  },
  completed: {
    bg: "bg-success/10",
    dot: "bg-success",
    text: "text-success",
    label: "Completed",
  },
  error: {
    bg: "bg-error/10",
    dot: "bg-error",
    text: "text-error",
    label: "Error",
  },
  planned: {
    bg: "bg-muted",
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
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

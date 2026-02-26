import { ChevronRight, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIORITY_CONFIG } from "@/lib/constants";
import { STATUS_CONFIG } from "@/lib/status-config";
import { formatShortDate, isOverdue } from "@/lib/date-utils";
import type { PlanNode } from "@/types";

export interface TaskRowProps {
  task: PlanNode;
  projectName?: string;
  showProject?: boolean;
  onClick?: () => void;
  className?: string;
}

export function TaskRow({ task, projectName, showProject = false, onClick, className }: TaskRowProps) {
  const depsCount = task.dependencies?.length ?? 0;

  // Map status to border and background colors using safelist-compatible classes
  const getStatusColors = () => {
    switch (task.status) {
      case "in_progress":
      case "dispatched":
        return { border: "border-info", bg: "bg-info" };
      case "completed":
      case "auto_verified":
        return { border: "border-success", bg: "bg-success" };
      case "awaiting_judgment":
        return { border: "border-warning", bg: "bg-warning" };
      case "planned":
      case "pruned":
      default:
        return { border: "border-muted-foreground", bg: "bg-muted-foreground" };
    }
  };

  const statusColors = getStatusColors();
  const statusConfig = STATUS_CONFIG[task.status];
  const priorityConfig = task.priority ? PRIORITY_CONFIG[task.priority] : null;
  const dueDate = task.dueDate ?? task.endDate;
  const overdue = isOverdue(dueDate, task.status);

  // Collect metadata items for the bottom row
  const metaItems: { key: string; content: React.ReactNode }[] = [];

  if (statusConfig) {
    metaItems.push({
      key: "status",
      content: <span className={cn("text-xs font-medium", statusConfig.color)}>{statusConfig.label}</span>,
    });
  }

  if (priorityConfig && task.priority !== "none") {
    const PIcon = priorityConfig.icon;
    metaItems.push({
      key: "priority",
      content: (
        <span className={cn("flex items-center gap-0.5 text-xs", priorityConfig.color)}>
          <PIcon className="h-3 w-3" />
          {priorityConfig.label}
        </span>
      ),
    });
  }

  if (task.estimate) {
    metaItems.push({
      key: "estimate",
      content: <span className="text-xs font-semibold tracking-wide">{task.estimate}</span>,
    });
  }

  if (depsCount > 0) {
    metaItems.push({
      key: "deps",
      content: <span className="text-xs">{depsCount} {depsCount === 1 ? "dep" : "deps"}</span>,
    });
  }

  if (dueDate) {
    metaItems.push({
      key: "dueDate",
      content: (
        <span className={cn("flex items-center gap-0.5 text-xs", overdue ? "text-error" : "")}>
          <Calendar className="h-3 w-3" />
          {formatShortDate(dueDate)}
        </span>
      ),
    });
  }

  if (showProject && projectName) {
    metaItems.push({
      key: "project",
      content: <span className="text-xs truncate">{projectName}</span>,
    });
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3.5 rounded-2xl bg-card p-4 transition-all shadow-sm hover:shadow-md border border-border",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-left",
        className
      )}
    >
      {/* Status indicator: 28px outer circle, 2.5px border, 8px inner dot */}
      <div className="relative flex-shrink-0">
        <div
          className={cn(
            "w-7 h-7 rounded-full border-[2.5px] flex items-center justify-center",
            statusColors.border
          )}
        >
          <div className={cn("w-2 h-2 rounded-full", statusColors.bg)} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <h3 className="font-semibold text-base truncate">{task.title}</h3>
        {metaItems.length > 0 && (
          <div className="flex items-center gap-2 text-muted-foreground flex-wrap">
            {metaItems.map((item, i) => (
              <span key={item.key} className="flex items-center gap-2">
                {i > 0 && <span className="text-muted-foreground/40">·</span>}
                {item.content}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Chevron */}
      <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
    </button>
  );
}

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
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
        <h3 className="font-semibold text-base truncate">{task.number != null && <span className="text-muted-foreground font-normal mr-1.5">#{task.number}</span>}{task.title}</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {task.estimate && (
            <>
              <span className="font-semibold tracking-wide">{task.estimate}</span>
              {(depsCount > 0 || showProject) && <span>·</span>}
            </>
          )}
          {depsCount > 0 && (
            <>
              <span>{depsCount} {depsCount === 1 ? "dep" : "deps"}</span>
              {showProject && projectName && <span>·</span>}
            </>
          )}
          {showProject && projectName && <span className="truncate">{projectName}</span>}
        </div>
      </div>

      {/* Chevron */}
      <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
    </button>
  );
}

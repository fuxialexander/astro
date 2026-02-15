export interface AgentRowProps {
  taskName: string;
  machine: string;
  duration: string;
  progress: number; // 0-100
  output?: string; // last line of output
  onClick?: () => void;
}

export function AgentRow({
  taskName,
  machine,
  duration,
  progress,
  output,
  onClick,
}: AgentRowProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex flex-col gap-3 rounded-2xl bg-card shadow-sm p-4 text-left transition-colors hover:bg-accent"
    >
      {/* Top row: task name + duration */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base leading-tight truncate">{taskName}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">{machine}</p>
        </div>
        <span className="text-sm text-muted-foreground flex-shrink-0">{duration}</span>
      </div>

      {/* Progress bar: 4px height, rounded */}
      <div className="relative w-full h-1 bg-muted rounded-full overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>

      {/* Output preview: truncated, muted, monospace */}
      {output && (
        <p className="text-sm text-muted-foreground font-mono truncate leading-tight">
          {output}
        </p>
      )}
    </button>
  );
}

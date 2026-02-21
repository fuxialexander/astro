import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from "lucide-react"
import { useToastStore, type Toast } from "@/stores/toast-store"
import { cn } from "@/lib/utils"

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss)

  const icons = {
    info: Info,
    success: CheckCircle2,
    warning: AlertTriangle,
    error: AlertCircle,
  }

  const styles = {
    info: "border-blue-500/40 bg-blue-50 dark:bg-blue-950/20",
    success: "border-green-500/40 bg-green-50 dark:bg-green-950/20",
    warning: "border-amber-500/40 bg-amber-50 dark:bg-amber-950/20",
    error: "border-destructive/40 bg-red-50 dark:bg-red-950/20",
  }

  const iconStyles = {
    info: "text-blue-500",
    success: "text-green-500",
    warning: "text-amber-500",
    error: "text-destructive",
  }

  const Icon = icons[toast.type]

  return (
    <div
      className={cn(
        "rounded-lg border bg-card shadow-lg overflow-hidden transition-all",
        styles[toast.type]
      )}
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", iconStyles[toast.type])} />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{toast.title}</p>
          {toast.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{toast.description}</p>
          )}
        </div>

        <button
          onClick={() => dismiss(toast.id)}
          className="p-1 rounded hover:bg-muted transition-colors cursor-pointer shrink-0"
          title="Dismiss"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 left-4 z-50 w-[340px] flex flex-col-reverse gap-2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

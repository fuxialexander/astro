import { CheckCircle2, AlertCircle, Info, AlertTriangle, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useNotificationStore, type Notification } from "@/stores/notification-store"
import { renderMarkdownInline } from "@/lib/markdown-inline"
import { cn } from "@/lib/utils"
import { formatRelativeTime } from "@/lib/date-utils"

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
}

const cardStyles = {
  info: "border-info/30 bg-info/[0.03]",
  success: "border-success/30 bg-success/[0.03]",
  warning: "border-warning/30 bg-warning/[0.03]",
  error: "border-error/30 bg-error/[0.03]",
}

const iconStyles = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
}

function NotificationItem({ notification }: { notification: Notification }) {
  const dismiss = useNotificationStore((s) => s.dismiss)
  const Icon = icons[notification.type]

  return (
    <Card className={cn("rounded-xl border", cardStyles[notification.type])}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", iconStyles[notification.type])} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold">{notification.title}</p>
              <span className="text-[10px] text-muted-foreground/40 shrink-0">
                {formatRelativeTime(new Date(notification.createdAt))}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {renderMarkdownInline(notification.description)}
            </p>
            <div className="flex items-center gap-2 mt-3">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-border/60"
                onClick={() => dismiss(notification.id)}
              >
                OK
              </Button>
              {notification.prUrl && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground/60"
                  asChild
                >
                  <a href={notification.prUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3 w-3 mr-1" /> View PR
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function NotificationCards() {
  const notifications = useNotificationStore((s) => s.notifications)
  const dismissAll = useNotificationStore((s) => s.dismissAll)

  if (notifications.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold tracking-wide">Notifications</h2>
        {notifications.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] text-muted-foreground/60 px-2"
            onClick={dismissAll}
          >
            Dismiss All
          </Button>
        )}
      </div>
      {notifications.map((n) => (
        <NotificationItem key={n.id} notification={n} />
      ))}
    </div>
  )
}

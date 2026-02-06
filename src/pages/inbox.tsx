import { useState } from "react"
import {
  Rocket,
  Star,
  Link as LinkIcon,
  Copy,
  Loader,
  TriangleAlert,
  User,
  Flag,
  ChevronRight,
  Paperclip,
  Send,
  ListFilter,
  ArrowUpDown,
  Ellipsis,
  CheckCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface Notification {
  id: string
  agentName: string
  agentInitials: string
  projectName: string
  issueId: string
  issueTitle: string
  time: string
  status: "urgent" | "completed" | "in_progress"
}

const mockNotifications: Notification[] = [
  {
    id: "1",
    agentName: "Cyrus",
    agentInitials: "CY",
    projectName: "Nexus",
    issueId: "SUP-192",
    issueTitle: "Implement real-time notification system for agent status changes",
    time: "now",
    status: "urgent",
  },
  {
    id: "2",
    agentName: "Cyrus",
    agentInitials: "CY",
    projectName: "Nexus",
    issueId: "SUP-188",
    issueTitle: "Add WebSocket reconnection logic with exponential backoff",
    time: "5min",
    status: "in_progress",
  },
  {
    id: "3",
    agentName: "Cyrus",
    agentInitials: "CY",
    projectName: "Nexus",
    issueId: "SUP-184",
    issueTitle: "Device authentication flow and machine registration",
    time: "38min",
    status: "completed",
  },
  {
    id: "4",
    agentName: "Cyrus",
    agentInitials: "CY",
    projectName: "Research",
    issueId: "RES-42",
    issueTitle: "Benchmark analysis pipeline for protein folding predictions",
    time: "1h",
    status: "completed",
  },
]

export function Inbox() {
  const [selectedId, setSelectedId] = useState<string>(mockNotifications[0].id)
  const selected = mockNotifications.find((n) => n.id === selectedId) ?? mockNotifications[0]

  return (
    <div className="flex h-full">
      {/* Left Panel: Notification List */}
      <div className="flex w-[400px] shrink-0 flex-col border-r border-border">
        {/* List Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Inbox</span>
            <button className="text-muted-foreground hover:text-foreground">
              <Ellipsis className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button className="text-muted-foreground hover:text-foreground">
              <ListFilter className="h-4 w-4" />
            </button>
            <button className="text-muted-foreground hover:text-foreground">
              <ArrowUpDown className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Notification Items */}
        <div className="flex-1 overflow-auto">
          {mockNotifications.map((notification) => (
            <button
              key={notification.id}
              onClick={() => setSelectedId(notification.id)}
              className={cn(
                "flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/30",
                selectedId === notification.id && "bg-muted"
              )}
            >
              {/* Avatar */}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary">
                <span className="text-xs font-medium text-white">{notification.agentInitials}</span>
              </div>

              {/* Middle Content */}
              <div className="flex flex-1 flex-col gap-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{notification.agentName}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {notification.projectName}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-medium shrink-0">{notification.issueId}</span>
                  <span className="text-xs text-muted-foreground truncate">{notification.issueTitle}</span>
                </div>
              </div>

              {/* Right: Status + Time */}
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                {notification.status === "urgent" ? (
                  <div className="flex h-5 w-5 items-center justify-center rounded bg-error">
                    <TriangleAlert className="h-3 w-3 text-error-foreground" />
                  </div>
                ) : notification.status === "completed" ? (
                  <CheckCircle className="h-4 w-4 text-success" />
                ) : (
                  <Loader className="h-4 w-4 text-muted-foreground animate-spin" />
                )}
                <span className="text-[11px] text-muted-foreground">{notification.time}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right Panel: Detail View */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Detail Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            <span className="text-xs text-muted-foreground">{selected.projectName}</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-medium">{selected.issueId}</span>
            <button className="text-muted-foreground hover:text-foreground">
              <Star className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button className="text-muted-foreground hover:text-foreground">
              <LinkIcon className="h-4 w-4" />
            </button>
            <button className="text-muted-foreground hover:text-foreground">
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Detail Meta */}
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-info px-2.5 py-0.5 text-xs font-semibold text-info-foreground">
            <Loader className="h-3 w-3" />
            In Progress
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-error px-2.5 py-0.5 text-xs font-semibold text-error-foreground">
            <TriangleAlert className="h-3 w-3" />
            Urgent
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold">
            <User className="h-3 w-3" />
            fuxialexan...
          </span>
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success px-2.5 py-0.5 text-xs font-semibold text-success-foreground">
            Cyrus
          </span>
        </div>

        {/* Detail Labels */}
        <div className="flex items-center gap-2 border-b border-border px-5 py-2">
          <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium">
            Nexus
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium">
            <Flag className="h-3 w-3" />
            M4: Execution Layer
          </span>
          <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-white">
            Feature
          </span>
        </div>

        {/* Activity Section */}
        <div className="flex flex-1 flex-col overflow-auto px-5 py-4">
          {/* Activity Header */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-semibold">Activity</span>
            <button className="text-xs text-muted-foreground hover:text-foreground">Unsubscribe</button>
          </div>

          {/* Activity Items */}
          <div className="flex flex-col gap-4">
            {/* Created */}
            <div className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-xs">
                  <span className="font-medium">fuxialexander</span>
                  <span className="text-muted-foreground"> created the issue</span>
                  <span className="text-muted-foreground"> · 32min ago</span>
                </p>
              </div>
            </div>

            {/* Delegated */}
            <div className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-xs">
                  <span className="font-medium">fuxialexander</span>
                  <span className="text-muted-foreground"> delegated to </span>
                  <span className="font-medium">Cyrus</span>
                  <span className="text-muted-foreground"> · 16min ago</span>
                </p>
              </div>
            </div>

            {/* Summary Card */}
            <div className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary">
                <span className="text-[10px] font-medium text-white">CY</span>
              </div>
              <div className="flex-1">
                <div className="rounded-lg border bg-muted p-4">
                  {/* Card Header */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-medium">Cyrus</span>
                    <span className="text-[11px] text-muted-foreground">· 2min ago</span>
                  </div>

                  {/* Summary */}
                  <p className="text-xs font-semibold mb-1">Summary</p>
                  <p className="text-xs text-muted-foreground mb-4">
                    Implemented the real-time notification system with WebSocket integration.
                    Set up event listeners for agent status changes and connected them to the
                    SSE bridge for browser delivery. Added reconnection logic with exponential
                    backoff to handle connection drops gracefully.
                  </p>

                  {/* Expandable Sections */}
                  <div className="flex flex-col gap-2">
                    <button className="flex items-center gap-2 text-xs font-medium hover:text-primary transition-colors">
                      <ChevronRight className="h-3.5 w-3.5" />
                      Key Changes (4 files)
                    </button>
                    <button className="flex items-center gap-2 text-xs font-medium hover:text-primary transition-colors">
                      <ChevronRight className="h-3.5 w-3.5" />
                      Test Results
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Comment Box */}
        <div className="flex items-center gap-2 border-t border-border px-5 py-4">
          <div className="flex flex-1 items-center gap-2 rounded-lg border bg-card px-4 py-3">
            <input
              type="text"
              placeholder="Leave a comment..."
              className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            />
            <button className="text-muted-foreground hover:text-foreground">
              <Paperclip className="h-4 w-4" />
            </button>
            <button className="text-muted-foreground hover:text-primary">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

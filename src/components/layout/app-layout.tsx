import { useEffect, useCallback, useRef } from "react"
import { Outlet } from "react-router"
import { Sidebar } from "./sidebar"
import { SafetyPromptDialog } from "@/components/safety-prompt-dialog"
import { WelcomeProfileDialog } from "@/components/welcome-profile-dialog"
import { ProductTour } from "@/components/product-tour"
import { PasskeyNudgeBanner } from "@/components/passkey-nudge-banner"
import { SseDisconnectBanner } from "@/components/sse-disconnect-banner"
import { ToastContainer } from "@/components/toast-container"
import { requestNotificationPermission } from "@/lib/notifications"
import { useUIStore } from "@/stores/ui-store"

function SidebarResizeHandle() {
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const isResizing = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return
      setSidebarWidth(ev.clientX)
    }

    const onMouseUp = () => {
      isResizing.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }, [setSidebarWidth])

  return (
    <div
      onMouseDown={onMouseDown}
      className="hidden md:block absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-10"
    />
  )
}

export function AppLayout() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)

  useEffect(() => {
    requestNotificationPermission()
  }, [])

  const width = sidebarCollapsed ? 52 : sidebarWidth

  return (
    <div className="flex flex-col md:flex-row h-dvh overflow-hidden bg-background">
      {/* Sidebar with collapse transition */}
      <div
        className="hidden md:flex shrink-0 relative"
        style={{ width, transition: sidebarCollapsed ? "width 200ms" : undefined }}
      >
        <Sidebar collapsed={sidebarCollapsed} />
        {!sidebarCollapsed && <SidebarResizeHandle />}
      </div>

      <main className="flex-1 overflow-auto w-full md:w-auto">
        <SseDisconnectBanner />
        <PasskeyNudgeBanner />
        <Outlet />
      </main>
      <SafetyPromptDialog />
      <WelcomeProfileDialog />
      <ProductTour />
      <ToastContainer />
    </div>
  )
}

import { useEffect } from "react"
import { Outlet } from "react-router"
import { Sidebar } from "./sidebar"
import { SafetyPromptDialog } from "@/components/safety-prompt-dialog"
import { WelcomeProfileDialog } from "@/components/welcome-profile-dialog"
import { ProductTour } from "@/components/product-tour"
import { PasskeyNudgeBanner } from "@/components/passkey-nudge-banner"
import { ToastContainer } from "@/components/toast-container"
import { requestNotificationPermission } from "@/lib/notifications"
import { useUIStore } from "@/stores/ui-store"
import { cn } from "@/lib/utils"

export function AppLayout() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)

  useEffect(() => {
    requestNotificationPermission()
  }, [])

  return (
    <div className="flex flex-col md:flex-row h-dvh overflow-hidden bg-background">
      {/* Sidebar with collapse transition */}
      <div
        className={cn(
          "hidden md:flex shrink-0 transition-all duration-200",
          sidebarCollapsed ? "w-[52px]" : "w-[260px]"
        )}
      >
        <Sidebar collapsed={sidebarCollapsed} />
      </div>

      <main className="flex-1 overflow-auto w-full md:w-auto">
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

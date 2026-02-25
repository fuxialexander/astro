import { useEffect } from "react"
import { Outlet } from "react-router"
import { Sidebar } from "./sidebar"
import { SafetyPromptDialog } from "@/components/safety-prompt-dialog"
import { WelcomeProfileDialog } from "@/components/welcome-profile-dialog"
import { PasskeyNudgeBanner } from "@/components/passkey-nudge-banner"
import { ToastContainer } from "@/components/toast-container"
import { requestNotificationPermission } from "@/lib/notifications"

export function AppLayout() {
  useEffect(() => {
    requestNotificationPermission()
  }, [])

  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto w-full md:w-auto">
        <PasskeyNudgeBanner />
        <Outlet />
      </main>
      <SafetyPromptDialog />
      <WelcomeProfileDialog />
      <ToastContainer />
    </div>
  )
}

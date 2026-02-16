import { Outlet } from "react-router"
import { Sidebar } from "./sidebar"
import { DynamicApprovalDialog } from "@/components/dynamic-approval-dialog"
import { WelcomeProfileDialog } from "@/components/welcome-profile-dialog"

export function AppLayout() {
  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto w-full md:w-auto">
        <Outlet />
      </main>
      <DynamicApprovalDialog />
      <WelcomeProfileDialog />
    </div>
  )
}

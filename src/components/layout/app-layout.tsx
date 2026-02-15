import { Outlet } from "react-router"
import { Sidebar } from "./sidebar"

export function AppLayout() {
  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-[#F8FAFC] dark:bg-[#0A0E1A]">
      <Sidebar />
      <main className="flex-1 overflow-auto w-full md:w-auto">
        <Outlet />
      </main>
    </div>
  )
}

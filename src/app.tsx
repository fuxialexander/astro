import { useEffect } from "react"
import { BrowserRouter, Routes, Route } from "react-router"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppLayout } from "@/components/layout/app-layout"
import { CommandPalette } from "@/components/command-palette"
import { AuthGuard } from "@/components/auth-guard"
import { Dashboard } from "@/pages/dashboard"
import { Projects } from "@/pages/projects"
import { ProjectNew } from "@/pages/project-new"
import { ProjectOverview } from "@/pages/project-overview"
import { PlanView } from "@/pages/plan-view"
import { Login } from "@/pages/login"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useDisplaySettingsStore } from "@/stores/display-settings-store"
import { useTaskChatStore } from "@/stores/task-chat-store"
import { useUsageStore } from "@/stores/usage-store"
import { Settings } from "@/pages/settings"
import { DeviceAuth } from "@/pages/device-auth"
import { TaskDetail } from "@/pages/task-detail"
import { Environments } from "@/pages/environments"
import { MyTasks } from "@/pages/my-tasks"
import { Welcome } from "@/pages/welcome"

function DataLoader({ children }: { children: React.ReactNode }) {
  const loadProjects = useProjectStore((s) => s.load)
  const loadPlan = usePlanStore((s) => s.load)
  const loadSettings = useSettingsStore((s) => s.load)
  const loadUserProfile = useUserProfileStore((s) => s.load)
  const loadDisplaySettings = useDisplaySettingsStore((s) => s.load)
  const loadTaskChat = useTaskChatStore((s) => s.load)
  const loadUsage = useUsageStore((s) => s.load)
  const connectRealtime = useRealtimeStore((s) => s.connect)
  const disconnectRealtime = useRealtimeStore((s) => s.disconnect)
  const projectsLoaded = useProjectStore((s) => s.loaded)
  const planLoaded = usePlanStore((s) => s.loaded)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const userProfileLoaded = useUserProfileStore((s) => s.loaded)
  const displaySettingsLoaded = useDisplaySettingsStore((s) => s.loaded)
  const taskChatLoaded = useTaskChatStore((s) => s.loaded)
  const usageLoaded = useUsageStore((s) => s.loaded)

  useEffect(() => {
    loadProjects()
    loadPlan()
    loadSettings()
    loadUserProfile()
    loadDisplaySettings()
    loadTaskChat()
    loadUsage()
    connectRealtime()
    return () => disconnectRealtime()
  }, [loadProjects, loadPlan, loadSettings, loadUserProfile, loadDisplaySettings, loadTaskChat, loadUsage, connectRealtime, disconnectRealtime])

  if (!projectsLoaded || !planLoaded || !settingsLoaded || !userProfileLoaded || !displaySettingsLoaded || !taskChatLoaded || !usageLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading...
      </div>
    )
  }

  return <>{children}</>
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="light">
      <TooltipProvider>
        <BrowserRouter>
          <DataLoader>
            <CommandPalette />
            <Routes>
              {/* Public routes (no auth required) */}
              <Route path="login" element={<Login />} />
              <Route path="device" element={<DeviceAuth />} />
              <Route path="welcome" element={<Welcome />} />

              {/* Authenticated routes */}
              <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
                <Route index element={<Dashboard />} />
                <Route path="projects" element={<Projects />} />
                <Route path="projects/new" element={<ProjectNew />} />
                <Route path="project/:id" element={<ProjectOverview />} />
                <Route path="project/:id/plan" element={<PlanView />} />
                <Route path="project/:id/task/:nodeId" element={<TaskDetail />} />
                <Route path="tasks" element={<MyTasks />} />
                <Route path="environments" element={<Environments />} />
                <Route path="settings" element={<Settings />} />
              </Route>
            </Routes>
          </DataLoader>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  )
}

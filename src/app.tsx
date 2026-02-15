import { useEffect } from "react"
import { BrowserRouter, Routes, Route } from "react-router"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppLayout } from "@/components/layout/app-layout"
import { CommandPalette } from "@/components/command-palette"
import { GenerationToasts } from "@/components/generation-toasts"
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
import { useSessionStore } from "@/stores/session-store"
import { useAuthStore } from "@/stores/auth-store"
import { shouldUseSupabase } from "@/lib/supabase-client"
import { Settings } from "@/pages/settings"
import { DeviceAuth } from "@/pages/device-auth"
import { TaskDetail } from "@/pages/task-detail"
import { Environments } from "@/pages/environments"
import { MyTasks } from "@/pages/my-tasks"
import { Welcome } from "@/pages/welcome"

function DataLoader({ children }: { children: React.ReactNode }) {
  const session = useAuthStore((s) => s.session)
  const authInitialized = useAuthStore((s) => s.initialized)
  const loadProjects = useProjectStore((s) => s.load)
  const loadPlan = usePlanStore((s) => s.load)
  const loadSettings = useSettingsStore((s) => s.load)
  const loadUserProfile = useUserProfileStore((s) => s.load)
  const loadDisplaySettings = useDisplaySettingsStore((s) => s.load)
  const loadTaskChat = useTaskChatStore((s) => s.load)
  const loadUsage = useUsageStore((s) => s.load)
  const loadSessions = useSessionStore((s) => s.load)
  const connectRealtime = useRealtimeStore((s) => s.connect)
  const disconnectRealtime = useRealtimeStore((s) => s.disconnect)
  const projectsLoaded = useProjectStore((s) => s.loaded)
  const planLoaded = usePlanStore((s) => s.loaded)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const userProfileLoaded = useUserProfileStore((s) => s.loaded)
  const displaySettingsLoaded = useDisplaySettingsStore((s) => s.loaded)
  const taskChatLoaded = useTaskChatStore((s) => s.loaded)
  const usageLoaded = useUsageStore((s) => s.loaded)
  const sessionsLoaded = useSessionStore((s) => s.loaded)

  // Only load data if authenticated or in IndexedDB-only mode
  const shouldLoadData = !shouldUseSupabase() || (authInitialized && session)

  useEffect(() => {
    console.log('[DataLoader] shouldLoadData:', shouldLoadData, '{ authInitialized:', authInitialized, 'session:', session ? 'present' : 'none', '}')
    if (!shouldLoadData) return

    console.log('[DataLoader] Loading all stores...')
    loadProjects()
    loadPlan()
    loadSettings()
    loadUserProfile()
    loadDisplaySettings()
    loadTaskChat()
    loadUsage()
    loadSessions()
    connectRealtime()
    return () => disconnectRealtime()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shouldLoadData already captures authInitialized and session
  }, [shouldLoadData, loadProjects, loadPlan, loadSettings, loadUserProfile, loadDisplaySettings, loadTaskChat, loadUsage, loadSessions, connectRealtime, disconnectRealtime])

  const allLoaded = projectsLoaded && planLoaded && settingsLoaded && userProfileLoaded && displaySettingsLoaded && taskChatLoaded && usageLoaded && sessionsLoaded

  // Show loading state only if we should load data and it's not loaded yet
  if (shouldLoadData && !allLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading...
      </div>
    )
  }

  return <>{children}</>
}

export default function App() {
  const initializeAuth = useAuthStore((s) => s.initialize)

  // Initialize auth on mount
  useEffect(() => {
    initializeAuth()
  }, [initializeAuth])

  return (
    <ThemeProvider defaultTheme="light">
      <TooltipProvider>
        <BrowserRouter>
          <DataLoader>
            <CommandPalette />
            <GenerationToasts />
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

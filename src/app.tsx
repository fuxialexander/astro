import { useEffect } from "react"
import { BrowserRouter, Routes, Route } from "react-router"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppLayout } from "@/components/layout/app-layout"
import { MobileLayout } from "@/components/layout/mobile-layout"
import { CommandPalette } from "@/components/command-palette"
import { GenerationToasts } from "@/components/generation-toasts"
import { AuthGuard } from "@/components/auth-guard"
import { Dashboard } from "@/pages/dashboard"
import { Projects } from "@/pages/projects"
import { ProjectNew } from "@/pages/project-new"
import { PlanView } from "@/pages/plan-view"
import Initiatives from "@/pages/initiatives"
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
import { useInitiativeStore } from "@/stores/initiative-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useAgentStore } from "@/stores/agent-store"
import { useActivityStore } from "@/stores/activity-store"
import { useAuthStore } from "@/stores/auth-store"
import { useSidebarStore } from "@/stores/sidebar-store"
import { isLocalMode } from "@/lib/app-mode"
import { usePluginStore } from "@/stores/plugin-store"
import { useSkillStore } from "@/stores/skill-store"
import { PluginLoader } from "@/components/plugin-loader"
import { PluginRoutes } from "@/components/plugin-routes"
import { getBrowserHostname } from "@/lib/path-utils"
import { Settings } from "@/pages/settings"
import { DeviceAuth } from "@/pages/device-auth"
import { TaskDetail } from "@/pages/task-detail"
import { Environments } from "@/pages/environments"
import { Agents } from "@/pages/agents"
import { MyTasks } from "@/pages/my-tasks"
import { Welcome } from "@/pages/welcome"
import { Workflows } from "@/pages/workflows"
import { TeamInvite } from "@/pages/team-invite"

/**
 * ResponsiveLayout switches between desktop (sidebar) and mobile (bottom tab bar) layouts.
 * Uses CSS media queries at the md breakpoint (768px) to show/hide appropriate chrome.
 *
 * Both AppLayout and MobileLayout contain their own <Outlet />, but CSS ensures only one
 * is visible at a time, so routing works correctly.
 */
function ResponsiveLayout() {
  return (
    <>
      {/* Desktop layout - shown on md breakpoint and up */}
      <div className="hidden md:block h-screen">
        <AppLayout />
      </div>

      {/* Mobile layout - shown below md breakpoint, has md:hidden built-in */}
      <MobileLayout />
    </>
  )
}

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
  const loadInitiatives = useInitiativeStore((s) => s.load)
  const loadExecutions = useExecutionStore((s) => s.load)
  const loadAgent = useAgentStore((s) => s.load)
  const loadActivities = useActivityStore((s) => s.loadActivities)
  const loadSidebar = useSidebarStore((s) => s.load)
  const loadPlugins = usePluginStore((s) => s.load)
  const loadSkills = useSkillStore((s) => s.load)
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
  const initiativesLoaded = useInitiativeStore((s) => s.loaded)
  const executionsLoaded = useExecutionStore((s) => s.loaded)
  const agentLoaded = useAgentStore((s) => s.loaded)
  const activitiesLoaded = useActivityStore((s) => s.loaded)
  const sidebarLoaded = useSidebarStore((s) => s.loaded)
  const pluginsLoaded = usePluginStore((s) => s.loaded)
  const skillsLoaded = useSkillStore((s) => s.loaded)

  // Only load data if authenticated or in local mode
  const shouldLoadData = isLocalMode() || !!(authInitialized && session)

  useEffect(() => {
    if (!shouldLoadData) return

    // Only load if not already loaded (prevents duplicate API calls on re-renders)
    if (!projectsLoaded) loadProjects()
    if (!planLoaded) loadPlan()
    if (!settingsLoaded) loadSettings()
    if (!userProfileLoaded) loadUserProfile()
    if (!displaySettingsLoaded) loadDisplaySettings()
    if (!taskChatLoaded) loadTaskChat()
    if (!usageLoaded) loadUsage()
    if (!sessionsLoaded) loadSessions()
    if (!initiativesLoaded) loadInitiatives()
    if (!executionsLoaded) loadExecutions()
    if (!agentLoaded) loadAgent()
    if (!activitiesLoaded) loadActivities()
    if (!sidebarLoaded) loadSidebar()
    if (!pluginsLoaded) loadPlugins()
    if (!skillsLoaded) loadSkills()

    connectRealtime()

    // Pre-cache browser hostname for file URL building
    getBrowserHostname().catch((err) => {
      console.warn('[DataLoader] Failed to cache browser hostname:', err)
    })

    return () => disconnectRealtime()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run once when shouldLoadData becomes true
  }, [shouldLoadData])

  const allLoaded = projectsLoaded && planLoaded && settingsLoaded && userProfileLoaded && displaySettingsLoaded && taskChatLoaded && usageLoaded && sessionsLoaded && initiativesLoaded && executionsLoaded && agentLoaded && activitiesLoaded && sidebarLoaded && pluginsLoaded && skillsLoaded

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
            <PluginLoader>
            <CommandPalette />
            <GenerationToasts />
            <Routes>
              {/* Public routes (no auth required) */}
              <Route path="login" element={<Login />} />
              <Route path="device" element={<DeviceAuth />} />
              <Route path="welcome" element={<Welcome />} />
              <Route path="invite/:token" element={<TeamInvite />} />

              {/* Authenticated routes - Responsive */}
              <Route element={<AuthGuard><ResponsiveLayout /></AuthGuard>}>
                <Route index element={<MyTasks />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="projects" element={<Projects />} />
                <Route path="projects/new" element={<ProjectNew />} />
                <Route path="project/:id" element={<PlanView />} />
                <Route path="project/:id/graph" element={<PlanView />} />
                <Route path="project/:id/list" element={<PlanView />} />
                <Route path="project/:id/timeline" element={<PlanView />} />
                <Route path="project/:id/board" element={<PlanView />} />
                <Route path="project/:id/overview" element={<PlanView />} />
                <Route path="project/:id/task/:nodeId" element={<TaskDetail />} />
                <Route path="initiatives" element={<Initiatives />} />
                <Route path="tasks" element={<MyTasks />} />
                <Route path="agents" element={<Agents />} />
                <Route path="environments" element={<Environments />} />
                <Route path="workflows" element={<Workflows />} />
                <Route path="settings" element={<Settings />} />
                <Route path="plugins/*" element={<PluginRoutes />} />
              </Route>
            </Routes>
            </PluginLoader>
          </DataLoader>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  )
}

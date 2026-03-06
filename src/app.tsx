import { useEffect, useRef } from "react"
import { useIOSKeyboardFix } from "@/hooks/use-ios-keyboard-fix"
import { BrowserRouter, Routes, Route, Navigate } from "react-router"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppLayout } from "@/components/layout/app-layout"
import { MobileLayout } from "@/components/layout/mobile-layout"
import { CommandPalette } from "@/components/command-palette"
import { AuthGuard } from "@/components/auth-guard"
import { Dashboard } from "@/pages/dashboard"
import { Projects } from "@/pages/projects"
// ProjectNew removed — inline creation now happens on /projects page
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
import { useActivityStore } from "@/stores/activity-store"
import { useAuthStore } from "@/stores/auth-store"
import { useSidebarStore } from "@/stores/sidebar-store"
import { isLocalMode } from "@/lib/app-mode"
import { usePluginStore } from "@/stores/plugin-store"
import { useSkillStore } from "@/stores/skill-store"
import { useTemplateStore } from "@/stores/template-store"
import { useAgentStore } from "@/stores/agent-store"
import { useTeamStore } from "@/stores/team-store"
import { setActiveTeamId } from "@/lib/data-client"
import { setActiveTeamId as setApiActiveTeamId } from "@/lib/api-client"
import { PluginLoader } from "@/components/plugin-loader"
import { PluginRoutes } from "@/components/plugin-routes"
import { getBrowserHostname } from "@/lib/path-utils"
import { refreshAllFileTrees } from "@/hooks/use-file-tree-refresh"
import { useGitHubStore } from "@/stores/github-store"
import { useConnectedAccountsStore } from "@/stores/connected-accounts-store"
import { useApiKeysStore } from "@/stores/api-keys-store"
import { Settings } from "@/pages/settings"
import { DeviceAuth } from "@/pages/device-auth"
import { TaskDetail } from "@/pages/task-detail"
import { Environments } from "@/pages/environments"

import { MyTasks } from "@/pages/my-tasks"
import { Workflows } from "@/pages/workflows"
import { ActiveTasks } from "@/pages/active-tasks"
import { TeamInvite } from "@/pages/team-invite"
import { ProjectNewPlan } from "@/pages/project-new-plan"
import { Playground } from "@/pages/playground"
import { ShareImport } from "@/pages/share-import"
import { Examples } from "@/pages/examples"
import { Community } from "@/pages/community"
import { CommunityPlanDetail } from "@/pages/community-plan-detail"

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
      <div className="hidden md:block h-dvh">
        <AppLayout />
      </div>

      {/* Mobile layout - shown below md breakpoint, has md:hidden built-in */}
      <MobileLayout />
    </>
  )
}

/**
 * Reset all data stores' loaded flags so DataLoader re-fetches everything.
 * Called when the authenticated user changes (sign-out → sign-in as different user).
 */
function resetAllStores() {
  // Reset team store FIRST — clears stale team ID from API headers
  useTeamStore.setState({ teams: [], teamMembers: {}, loaded: false })
  setActiveTeamId(undefined)
  setApiActiveTeamId(undefined)
  // Clear all data arrays/maps to prevent cross-user data leakage
  useProjectStore.setState({ projects: [], loaded: false })
  usePlanStore.setState({ nodes: [], edges: [], loaded: false })
  useSettingsStore.setState({ loaded: false })
  useUserProfileStore.setState({ loaded: false })
  useDisplaySettingsStore.setState({ loaded: false })
  useTaskChatStore.setState({ loaded: false })
  useUsageStore.setState({ loaded: false })
  useSessionStore.setState({ sessions: new Map(), loaded: false })
  useInitiativeStore.setState({ initiatives: [], loaded: false })
  useExecutionStore.setState({ executions: new Map(), pendingApprovals: new Map(), batchExecutions: new Map(), loaded: false })
  useActivityStore.setState({ activities: [], loaded: false })
  useSidebarStore.setState({ loaded: false })
  usePluginStore.setState({ loaded: false })
  useSkillStore.setState({ loaded: false })
  useTemplateStore.setState({ templates: [], categories: [], loaded: false })
  useAgentStore.setState({ sessions: new Map(), loaded: false })
  // Reset external integration stores
  useGitHubStore.setState({ connected: false, user: null, connectedAt: null, repos: [], selectedRepoIds: [], lastSyncedAt: null })
  useConnectedAccountsStore.setState({ accounts: [], loaded: false })
  useApiKeysStore.setState({ encryptedKeys: [], decryptedKeys: new Map(), loaded: false })
}

function DataLoader({ children }: { children: React.ReactNode }) {
  const session = useAuthStore((s) => s.session)
  const authInitialized = useAuthStore((s) => s.initialized)
  const loadTeams = useTeamStore((s) => s.load)
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
  const loadActivities = useActivityStore((s) => s.loadActivities)
  const loadSidebar = useSidebarStore((s) => s.load)
  const loadPlugins = usePluginStore((s) => s.load)
  const loadSkills = useSkillStore((s) => s.load)
  const loadTemplates = useTemplateStore((s) => s.load)
  const loadAgent = useAgentStore((s) => s.load)
  const connectRealtime = useRealtimeStore((s) => s.connect)
  const disconnectRealtime = useRealtimeStore((s) => s.disconnect)
  const fetchGitHubStatus = useGitHubStore((s) => s.fetchStatus)
  const gitHubConnected = useGitHubStore((s) => s.connected)
  const fetchGitHubRepos = useGitHubStore((s) => s.fetchRepos)
  const teamsLoaded = useTeamStore((s) => s.loaded)
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
  const activitiesLoaded = useActivityStore((s) => s.loaded)
  const sidebarLoaded = useSidebarStore((s) => s.loaded)
  const pluginsLoaded = usePluginStore((s) => s.loaded)
  const skillsLoaded = useSkillStore((s) => s.loaded)
  const templatesLoaded = useTemplateStore((s) => s.loaded)
  const agentLoaded = useAgentStore((s) => s.loaded)

  // Only load data if authenticated or in local mode
  const shouldLoadData = isLocalMode() || !!(authInitialized && session)
  const userId = session?.user?.id ?? null

  // Track the last user ID to detect user changes (sign-out → sign-in as different user)
  const lastUserIdRef = useRef<string | null>(null)

  // Phase 1: Load teams first (sets X-Team-Id header for all subsequent API calls)
  useEffect(() => {
    if (!shouldLoadData) return

    const userChanged = lastUserIdRef.current !== null && lastUserIdRef.current !== userId
    if (userChanged) {
      resetAllStores()
    }
    lastUserIdRef.current = userId

    // Teams must load first — they set the X-Team-Id header used by all other API calls
    if (userChanged || !teamsLoaded) loadTeams()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Re-run when auth state or user changes
  }, [shouldLoadData, userId])

  // Phase 2: Load all other stores once teams are loaded (so X-Team-Id is correct)
  useEffect(() => {
    if (!shouldLoadData || !teamsLoaded) return

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
    if (!activitiesLoaded) loadActivities()
    if (!sidebarLoaded) loadSidebar()
    if (!pluginsLoaded) loadPlugins()
    if (!skillsLoaded) loadSkills()
    if (!templatesLoaded) loadTemplates()
    if (!agentLoaded) loadAgent()

    connectRealtime()

    // Pre-cache browser hostname for file URL building
    getBrowserHostname().catch((err) => {
      console.warn('[DataLoader] Failed to cache browser hostname:', err)
    })

    return () => disconnectRealtime()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Re-run when teams loaded or auth changes
  }, [shouldLoadData, teamsLoaded])

  // Background-refresh file trees after projects load.
  // In local mode (no relay), fire immediately when projects load.
  // In server mode, also re-trigger when machines connect via realtime (SSE),
  // since the relay must register machines before file-list requests succeed.
  const realtimeMachines = useRealtimeStore((s) => s.machines)

  useEffect(() => {
    if (!projectsLoaded) return
    // In local mode there are no realtime machines — refresh immediately.
    // In server mode, wait until at least one machine connects.
    if (isLocalMode() || realtimeMachines.size > 0) {
      refreshAllFileTrees()
    }
  }, [projectsLoaded, realtimeMachines.size])

  // Auto-sync GitHub: check connection status on load, fetch repos if connected
  useEffect(() => {
    if (!shouldLoadData || !teamsLoaded) return
    fetchGitHubStatus().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldLoadData, teamsLoaded])

  useEffect(() => {
    if (gitHubConnected) fetchGitHubRepos().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitHubConnected])

  // Critical stores: must load before rendering (navigation + core data)
  const criticalLoaded = teamsLoaded && projectsLoaded && planLoaded && userProfileLoaded && sidebarLoaded
  // Non-critical stores load in background — page renders without them
  const allLoaded = criticalLoaded && settingsLoaded && displaySettingsLoaded && taskChatLoaded && usageLoaded && sessionsLoaded && initiativesLoaded && executionsLoaded && agentLoaded && activitiesLoaded && pluginsLoaded && skillsLoaded && templatesLoaded

  // Only block page render on critical stores
  if (shouldLoadData && !criticalLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading...
      </div>
    )
  }

  // Log if non-critical stores are still loading (for debugging)
  if (shouldLoadData && !allLoaded) {
    console.log('[DataLoader] Rendering with non-critical stores still loading')
  }

  return <>{children}</>
}

/**
 * Root route: redirect to dashboard if authenticated, landing page if not.
 * In local mode (no auth), always go to dashboard.
 */
function RootRedirect() {
  const session = useAuthStore((s) => s.session)
  const initialized = useAuthStore((s) => s.initialized)
  const local = isLocalMode()

  useEffect(() => {
    if (!local && initialized && !session) {
      window.location.href = '/landing/'
    }
  }, [local, initialized, session])

  if (local) {
    return <Navigate to="/plan" replace />
  }

  if (!initialized || !session) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      </div>
    )
  }

  return <Navigate to="/plan" replace />
}

export default function App() {
  const initializeAuth = useAuthStore((s) => s.initialize)

  // Initialize auth on mount
  useEffect(() => {
    initializeAuth()
  }, [initializeAuth])

  // Prevent iOS/iPadOS page shift when keyboard/toolbar appears
  useIOSKeyboardFix()

  return (
    <ThemeProvider defaultTheme="light">
      <TooltipProvider>
        <BrowserRouter>
          {/* Public routes that must render immediately (no DataLoader dependency) */}
          <Routes>
            <Route path="login" element={<Login />} />
            <Route path="device" element={<DeviceAuth />} />
            <Route path="invite/:token" element={<TeamInvite />} />
            <Route path="*" element={
          <DataLoader>
            <PluginLoader>
            <CommandPalette />
            <Routes>
              {/* Root: landing if unauthenticated, dashboard if authenticated */}
              <Route index element={<RootRedirect />} />

              {/* Authenticated routes - Responsive */}
              <Route element={<AuthGuard><ResponsiveLayout /></AuthGuard>}>
                <Route path="welcome" element={<ProjectNewPlan />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="projects" element={<Projects />} />
                <Route path="plan" element={<ProjectNewPlan />} />
                <Route path="projects/new" element={<Navigate to="/projects" replace />} />
                <Route path="projects/new/plan" element={<Navigate to="/plan" replace />} />
                <Route path="project/:id" element={<PlanView />} />
                <Route path="project/:id/graph" element={<PlanView />} />
                <Route path="project/:id/list" element={<PlanView />} />
                <Route path="project/:id/timeline" element={<PlanView />} />
                <Route path="project/:id/board" element={<PlanView />} />
                <Route path="project/:id/overview" element={<PlanView />} />
                <Route path="project/:id/knowledge" element={<PlanView />} />
                <Route path="project/:id/task/:nodeId" element={<TaskDetail />} />
                <Route path="initiatives" element={<Initiatives />} />
                <Route path="tasks" element={<MyTasks />} />
                <Route path="active" element={<ActiveTasks />} />

                <Route path="playground" element={<Playground />} />
                <Route path="environments" element={<Environments />} />
                <Route path="workflows" element={<Workflows />} />
                <Route path="examples" element={<Examples />} />
                <Route path="templates" element={<Navigate to="/examples" replace />} />
                <Route path="community" element={<Community />} />
                <Route path="community/plans/:id" element={<CommunityPlanDetail />} />
                <Route path="share/:id" element={<ShareImport />} />
                <Route path="settings" element={<Settings />} />
                <Route path="plugins/*" element={<PluginRoutes />} />
              </Route>
            </Routes>
            </PluginLoader>
          </DataLoader>
            } />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  )
}

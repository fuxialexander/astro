import { useEffect, useRef, Suspense, lazy } from "react"
import { useIOSKeyboardFix } from "@/hooks/use-ios-keyboard-fix"
import { BrowserRouter, Routes, Route, Navigate } from "react-router"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppLayout } from "@/components/layout/app-layout"
import { CommandPalette } from "@/components/command-palette"
import { AuthGuard } from "@/components/auth-guard"
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
import { setupRealtimeSync } from "@/lib/realtime-sync"
import { usePluginStore } from "@/stores/plugin-store"
import { useSkillStore } from "@/stores/skill-store"
import { useExampleStore } from "@/stores/example-store"
import { useAgentStore } from "@/stores/agent-store"
import { useTeamStore } from "@/stores/team-store"
import { useReferenceStore } from "@/stores/reference-store"
import { useScheduleStore } from "@/stores/schedule-store"
import { setActiveTeamId } from "@/lib/data-client"
import { setActiveTeamId as setApiActiveTeamId } from "@/lib/api-client"
import { PluginLoader } from "@/components/plugin-loader"
import { PluginRoutes } from "@/components/plugin-routes"
import { getBrowserHostname } from "@/lib/path-utils"
import { refreshAllFileTrees } from "@/hooks/use-file-tree-refresh"
import { AppErrorBoundary } from "@/components/app-error-boundary"
import { useGitHubStore } from "@/stores/github-store"
import { useGitHubAppStore } from "@/stores/github-app-store"
import { useToastStore } from "@/stores/toast-store"
import { useFeatureFlag } from "@/hooks/use-feature-flag"
import { HipaaRoute } from "@/components/HipaaRoute"
import { useConnectedAccountsStore } from "@/stores/connected-accounts-store"
import { useApiKeysStore } from "@/stores/api-keys-store"
import { Settings } from "@/pages/settings"
import { StatsPage } from "@/pages/stats"
import { DeviceAuth } from "@/pages/device-auth"
import { Pair } from "@/pages/pair"
import { SignIn } from "@/pages/signin"
import { isDesktop } from "@/lib/desktop-detect"
import { TaskDetail } from "@/pages/task-detail"
import { Environments } from "@/pages/environments"

import { MyTasks } from "@/pages/my-tasks"
import { Workflows } from "@/pages/workflows"
import { ActiveTasks } from "@/pages/active-tasks"
import { Workspace } from "@/pages/workspace"
import { TeamInvite } from "@/pages/team-invite"
import DemoPlanNodeList from "@/pages/demo-plan-node-list"
import { Playground } from "@/pages/playground"
import { ShareImport } from "@/pages/share-import"
import { Community } from "@/pages/community"
import { CommunityPlanDetail } from "@/pages/community-plan-detail"
import { References } from "@/pages/references"
import { Sessions } from "@/pages/sessions"
import { Scheduled } from "@/pages/scheduled"
import { OnboardingWorkflows } from "@/pages/onboarding-workflows"
import { CalendarPage } from "@/pages/calendar"

const LazyInboxHome = lazy(() => import("@/pages/inbox-home").then((m) => ({ default: m.InboxHome })))

function HomeRouter() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full" />}>
      <LazyInboxHome />
    </Suspense>
  )
}

function FeatureFlagRoute({ flag, children }: { flag: string; children: React.ReactNode }) {
  const enabled = useFeatureFlag(flag)
  if (!enabled) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

/**
 * ResponsiveLayout renders AppLayout which handles both desktop and mobile.
 * On mobile, the sidebar is always collapsed (icon rail) and a bottom tab bar is shown.
 */
function ResponsiveLayout() {
  return (
    <div className="h-dvh">
      <AppLayout />
    </div>
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
  useExampleStore.setState({ templates: [], categories: [], loaded: false })
  useAgentStore.setState({ sessions: new Map(), loaded: false })
  // Reset external integration stores
  useGitHubStore.setState({ connected: false, user: null, connectedAt: null, repos: [], selectedRepoIds: [], lastSyncedAt: null })
  useGitHubAppStore.setState({ installations: [], loading: false, error: null })
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
  const loadTemplates = useExampleStore((s) => s.load)
  const loadAgent = useAgentStore((s) => s.load)
  const connectRealtime = useRealtimeStore((s) => s.connect)
  const disconnectRealtime = useRealtimeStore((s) => s.disconnect)
  const fetchGitHubAppInstallations = useGitHubAppStore((s) => s.fetchInstallations)
  const loadReferenceLibrary = useReferenceStore((s) => s.loadLibrary)
  const loadAllSchedules = useScheduleStore((s) => s.loadAllSchedules)
  const allSchedulesLoaded = useScheduleStore((s) => s.allLoaded)
  const gitHubEnabled = useFeatureFlag('github-integration')
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
  const templatesLoaded = useExampleStore((s) => s.loaded)
  const agentLoaded = useAgentStore((s) => s.loaded)

  // Only load data if authenticated or in local mode
  const shouldLoadData = isLocalMode() || !!(authInitialized && session)
  const userId = session?.user?.id ?? null

  // Track the last user ID to detect user changes (sign-out → sign-in as different user)
  const lastUserIdRef = useRef<string | null>(null)

  // Phase 1: Load teams first so the app has membership data and a default
  // team context before team-owned settings/resources are loaded.
  useEffect(() => {
    if (!shouldLoadData) return

    const userChanged = lastUserIdRef.current !== null && lastUserIdRef.current !== userId
    if (userChanged) {
      resetAllStores()
    }
    lastUserIdRef.current = userId

    // Teams must load first so team-owned writes/settings have the correct default context.
    if (userChanged || !teamsLoaded) loadTeams()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Re-run when auth state or user changes
  }, [shouldLoadData, userId])

  // Phase 2: Load the rest of the app once memberships/default context are ready.
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
    // Sidebar is loaded in a separate effect after user profile (it reads sidebarConfig from profile)
    if (!pluginsLoaded) loadPlugins()
    if (!skillsLoaded) loadSkills()
    if (!templatesLoaded) loadTemplates()
    if (!agentLoaded) loadAgent()
    void loadReferenceLibrary()
    if (!allSchedulesLoaded) void loadAllSchedules()

    connectRealtime()

    // Realtime subscriptions follow the user's cross-team read scope.
    setupRealtimeSync()

    // Pre-cache browser hostname for file URL building
    getBrowserHostname().catch((err) => {
      console.warn('[DataLoader] Failed to cache browser hostname:', err)
    })

    return () => disconnectRealtime()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Re-run when teams loaded or auth changes
  }, [shouldLoadData, teamsLoaded])

  // Phase 2b: Load sidebar after user profile — sidebar reads sidebarConfig from the profile,
  // so waiting avoids a duplicate /api/data/profile fetch.
  useEffect(() => {
    if (!shouldLoadData || !teamsLoaded || !userProfileLoaded) return
    if (!sidebarLoaded) loadSidebar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldLoadData, teamsLoaded, userProfileLoaded])

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

  // Reconcile running tasks after both plan + execution stores are loaded.
  // After page refresh, plan nodes may have status=in_progress with an executionId
  // from the DB, but the execution store and realtime store lose their in-memory
  // entries. This bootstraps task streams and execution entries so the dashboard
  // and active-tasks page show running tasks correctly.
  const reconcileRunningTasks = useRealtimeStore((s) => s.reconcileRunningTasks)
  useEffect(() => {
    if (!planLoaded || !executionsLoaded) return
    reconcileRunningTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Run once after both stores load
  }, [planLoaded, executionsLoaded])

  // Auto-sync GitHub App: fetch installations and check OAuth status on load
  const fetchGitHubOAuthStatus = useGitHubStore((s) => s.fetchStatus)
  const addToast = useToastStore((s) => s.add)

  useEffect(() => {
    if (!shouldLoadData || !teamsLoaded || !gitHubEnabled) return
    fetchGitHubAppInstallations().catch(() => {})
    fetchGitHubOAuthStatus().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldLoadData, teamsLoaded, gitHubEnabled])

  // Show one-time migration toast for OAuth users without GitHub App
  const oauthConnected = useGitHubStore((s) => s.connected)
  const appInstallations = useGitHubAppStore((s) => s.installations)
  const migrationToastShownRef = useRef(false)

  useEffect(() => {
    if (migrationToastShownRef.current) return
    if (!gitHubEnabled || !oauthConnected) return
    // Wait until app installations have been fetched (loading = false means fetch completed)
    const appLoading = useGitHubAppStore.getState().loading
    if (appLoading) return
    if (appInstallations.length === 0) {
      migrationToastShownRef.current = true
      addToast({
        type: 'warning',
        title: 'Switch to GitHub App',
        description: 'Your GitHub OAuth token is deprecated. Go to Settings → Connected Accounts to install the GitHub App.',
        duration: 10000,
      })
    }
  }, [oauthConnected, appInstallations, gitHubEnabled, addToast])

  // Critical stores: must load before rendering (navigation + core data + display settings to avoid view flash)
  const criticalLoaded = teamsLoaded && projectsLoaded && planLoaded && userProfileLoaded && sidebarLoaded && displaySettingsLoaded
  // Non-critical stores load in background — page renders without them
  const allLoaded = criticalLoaded && settingsLoaded && taskChatLoaded && usageLoaded && sessionsLoaded && initiativesLoaded && executionsLoaded && agentLoaded && activitiesLoaded && pluginsLoaded && skillsLoaded && templatesLoaded

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
  const desktop = isDesktop()

  useEffect(() => {
    if (local || desktop) return
    // Browser-only: send unauthenticated users to the marketing landing page.
    // The Electron app routes to <Navigate to="/signin"> below instead — its
    // users have already chosen the product, no need for a marketing pitch.
    if (initialized && !session) {
      window.location.href = '/landing/'
    }
  }, [local, desktop, initialized, session])

  if (local) {
    return <Navigate to="/dashboard" replace />
  }

  if (!initialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      </div>
    )
  }

  if (!session) {
    if (desktop) return <Navigate to="/signin" replace />
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      </div>
    )
  }

  return <Navigate to="/dashboard" replace />
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
    <AppErrorBoundary>
    <Suspense fallback={null}>
    <ThemeProvider defaultTheme="system">
      <TooltipProvider delayDuration={125}>
        <BrowserRouter>
          {/* Public routes that must render immediately (no DataLoader dependency) */}
          <Routes>
            <Route path="login" element={<Login />} />
            <Route path="device" element={<DeviceAuth />} />
            <Route path="pair" element={<Pair />} />
            <Route path="signin" element={<SignIn />} />
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
                <Route path="welcome" element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<HomeRouter />} />
                <Route path="github" element={<FeatureFlagRoute flag="github-integration"><Workspace /></FeatureFlagRoute>} />
                <Route path="workspace" element={<Navigate to="/github" replace />} />
                <Route path="projects" element={<Projects />} />
                <Route path="plan" element={<Navigate to="/dashboard" replace />} />
                <Route path="projects/new" element={<Navigate to="/projects" replace />} />
                <Route path="projects/new/plan" element={<Navigate to="/dashboard" replace />} />
                <Route path="project/:id" element={<PlanView />} />
                <Route path="project/:id/graph" element={<PlanView />} />
                <Route path="project/:id/list" element={<PlanView />} />
                <Route path="project/:id/timeline" element={<PlanView />} />
                <Route path="project/:id/board" element={<PlanView />} />
                <Route path="project/:id/overview" element={<PlanView />} />
                <Route path="project/:id/knowledge" element={<PlanView />} />
                <Route path="project/:id/repo" element={<PlanView />} />
                <Route path="project/:id/task/:nodeId" element={<TaskDetail />} />
                <Route path="initiatives" element={<Initiatives />} />
                <Route path="tasks" element={<MyTasks />} />
                <Route path="active" element={<ActiveTasks />} />

                <Route path="onboarding" element={<OnboardingWorkflows />} />
                <Route path="sessions" element={<Sessions />} />
                <Route path="scheduled" element={<Scheduled />} />
                <Route path="calendar" element={<CalendarPage />} />
                <Route path="playground" element={<Playground />} />
                <Route path="environments" element={<Environments />} />
                <Route path="workflows" element={<Workflows />} />
                <Route path="examples" element={<Navigate to="/dashboard" replace />} />
                <Route path="templates" element={<Navigate to="/dashboard" replace />} />
                <Route path="references" element={<References />} />
                <Route path="community" element={<HipaaRoute><Community /></HipaaRoute>} />
                <Route path="community/plans/:id" element={<HipaaRoute><CommunityPlanDetail /></HipaaRoute>} />
                <Route path="share/:id" element={<HipaaRoute><ShareImport /></HipaaRoute>} />
                <Route path="settings" element={<Settings />} />
                <Route path="stats" element={<StatsPage />} />
                <Route path="plugins/*" element={<PluginRoutes />} />
                <Route path="demo/plan-node-list" element={<DemoPlanNodeList />} />
                <Route path="panes" element={<Navigate to="/dashboard" replace />} />
              </Route>
            </Routes>
            </PluginLoader>
          </DataLoader>
            } />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
    </Suspense>
    </AppErrorBoundary>
  )
}

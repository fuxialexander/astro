import { useEffect } from "react"
import { BrowserRouter, Routes, Route } from "react-router"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppLayout } from "@/components/layout/app-layout"
import { CommandPalette } from "@/components/command-palette"
import { Dashboard } from "@/pages/dashboard"
import { Projects } from "@/pages/projects"
import { ProjectNew } from "@/pages/project-new"
import { ProjectOverview } from "@/pages/project-overview"
import { JudgmentQueue } from "@/pages/judgment-queue"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { Settings } from "@/pages/settings"
import { DeviceAuth } from "@/pages/device-auth"
import { TaskDetail } from "@/pages/task-detail"
import { Environments } from "@/pages/environments"
import { Inbox } from "@/pages/inbox"

function DataLoader({ children }: { children: React.ReactNode }) {
  const loadProjects = useProjectStore((s) => s.load)
  const loadPlan = usePlanStore((s) => s.load)
  const loadSettings = useSettingsStore((s) => s.load)
  const connectRealtime = useRealtimeStore((s) => s.connect)
  const disconnectRealtime = useRealtimeStore((s) => s.disconnect)
  const projectsLoaded = useProjectStore((s) => s.loaded)
  const planLoaded = usePlanStore((s) => s.loaded)
  const settingsLoaded = useSettingsStore((s) => s.loaded)

  useEffect(() => {
    loadProjects()
    loadPlan()
    loadSettings()
    connectRealtime()
    return () => disconnectRealtime()
  }, [loadProjects, loadPlan, loadSettings, connectRealtime, disconnectRealtime])

  if (!projectsLoaded || !planLoaded || !settingsLoaded) {
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
              {/* Device auth page - standalone without app layout */}
              <Route path="device" element={<DeviceAuth />} />

              <Route element={<AppLayout />}>
                <Route index element={<Dashboard />} />
                <Route path="projects" element={<Projects />} />
                <Route path="projects/new" element={<ProjectNew />} />
                <Route path="project/:id" element={<ProjectOverview />} />
                <Route path="project/:id/task/:nodeId" element={<TaskDetail />} />
                <Route path="judgment" element={<JudgmentQueue />} />
                <Route path="inbox" element={<Inbox />} />
                <Route path="attention" element={<Dashboard />} />
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

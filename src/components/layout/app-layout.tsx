import { useEffect, useCallback, useRef, useState } from "react"
import { Outlet } from "react-router"
import { PanelRightClose, PanelLeft, Search } from "lucide-react"
/**
 * Shared class strings for titlebar buttons so sidebar-toggle, search,
 * close-all-panels, and the panel menu all share one visual language.
 */
const TITLEBAR_BTN =
  "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground " +
  "transition-colors duration-[120ms] hover:bg-foreground/[0.06] hover:text-foreground " +
  "disabled:opacity-30 disabled:pointer-events-none"
const TITLEBAR_BTN_ACTIVE = "bg-foreground/[0.06] text-foreground"

import { Sidebar } from "./sidebar"
import { SafetyPromptDialog } from "@/components/safety-prompt-dialog"
import { WelcomeProfileDialog } from "@/components/welcome-profile-dialog"
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow"
import { PasskeyNudgeBanner } from "@/components/passkey-nudge-banner"
import { SseDisconnectBanner } from "@/components/sse-disconnect-banner"
import { ToastContainer } from "@/components/toast-container"
import { requestNotificationPermission } from "@/lib/notifications"
import { useUIStore } from "@/stores/ui-store"
import { useMediaQuery } from "@/hooks/use-media-query"
import { isDesktop } from "@/lib/desktop-detect"
import { desktopBridge } from "@/lib/desktop-bridge"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/stores/project-store"
import { useParams } from "react-router"
import { PanelStack } from "@/components/panes/panel-stack"
import { PanelMenu } from "@/components/panes/panel-menu"

function SidebarResizeHandle() {
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const setIsSidebarResizing = useUIStore((s) => s.setIsSidebarResizing)
  const isResizing = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    setIsSidebarResizing(true)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return
      setSidebarWidth(ev.clientX)
    }

    const onMouseUp = () => {
      isResizing.current = false
      setIsSidebarResizing(false)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }, [setSidebarWidth, setIsSidebarResizing])

  return (
    <div
      onMouseDown={onMouseDown}
      className="group hidden md:flex absolute right-0 top-0 bottom-0 w-3 translate-x-1/2 cursor-col-resize z-10 items-center justify-center"
    >
      <div
        className={cn(
          "h-10 w-[3px] rounded-full bg-muted-foreground/20",
          "opacity-0 group-hover:opacity-100 group-active:opacity-100",
          "group-hover:bg-muted-foreground/50 group-active:bg-primary/60",
          "transition-all duration-150",
        )}
      />
    </div>
  )
}

export function AppLayout() {
  const params = useParams()
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const dockviewWidth = useUIStore((s) => s.dockviewWidth)
  const isSidebarResizing = useUIStore((s) => s.isSidebarResizing)
  const setDockviewWidth = useUIStore((s) => s.setDockviewWidth)
  const rightPanelStack = useUIStore((s) => s.rightPanelStack)
  const clearRightPanels = useUIStore((s) => s.clearRightPanels)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const isMobile = !useMediaQuery("(min-width: 768px)")
  const project = useProjectStore((s) =>
    params.id ? s.projects.find((item) => item.id === params.id) ?? s.projects[0] : s.projects[0],
  )

  const desktop = isDesktop()
  const hasCwd = !!project?.workingDirectory
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)

  useEffect(() => {
    requestNotificationPermission()
  }, [])

  useEffect(() => {
    if (!desktop) return
    return desktopBridge.updater.onReady(({ version }) => setUpdateVersion(version))
  }, [desktop])

  useEffect(() => {
    if (!desktop) return
    const onKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      // Shift+Cmd/Ctrl+E → file-browser (requires cwd)
      if (meta && e.shiftKey && e.code === 'KeyE') {
        if (!hasCwd) return
        e.preventDefault()
        toggleRightPanel('file-browser')
        return
      }
      // Shift+Cmd/Ctrl+D → git (requires cwd)
      if (meta && e.shiftKey && e.code === 'KeyD') {
        if (!hasCwd) return
        e.preventDefault()
        toggleRightPanel('git')
        return
      }
      // Ctrl+` → terminal (requires cwd)
      if (e.ctrlKey && (e.code === 'Backquote' || e.key === '`')) {
        if (!hasCwd) return
        e.preventDefault()
        toggleRightPanel('terminal')
      }
    }
    // Use capture phase so our handler fires before xterm's element-level
    // listener — otherwise Ctrl+` reaches the shell and may cause side effects.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [toggleRightPanel, hasCwd])

  const isEmbedded =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("embedded") === "1"

  const effectiveCollapsed = isMobile || sidebarCollapsed
  const showPanelStack = desktop && !isMobile && rightPanelStack.length > 0
  const width = effectiveCollapsed ? 52 : sidebarWidth

  // Panel stack resize
  const panelStackRef = useRef<HTMLDivElement>(null)
  const resizeActive = useRef(false)
  const resizeFrame = useRef<number | null>(null)
  const pendingWidth = useRef<number>(dockviewWidth)

  const clampWidth = useCallback((next: number) => {
    const minWidth = 320
    const maxWidth = typeof window === "undefined"
      ? 1200
      : Math.max(minWidth, Math.min(1200, window.innerWidth - width - 120))
    return Math.max(minWidth, Math.min(maxWidth, next))
  }, [width])

  const resolvedWidth = clampWidth(dockviewWidth)
  const maxWidth = typeof window === "undefined"
    ? 1200
    : Math.max(320, Math.min(1200, window.innerWidth - width - 120))

  useEffect(() => {
    if (resizeActive.current) return
    const pane = panelStackRef.current
    if (!pane) return
    pane.style.width = `${resolvedWidth}px`
    pane.style.maxWidth = `${maxWidth}px`
  }, [maxWidth, resolvedWidth, showPanelStack])

  useEffect(() => {
    if (!showPanelStack) return
    const next = clampWidth(dockviewWidth)
    if (next !== dockviewWidth) {
      setDockviewWidth(next)
    }
  }, [clampWidth, dockviewWidth, setDockviewWidth, showPanelStack])

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizeActive.current = true
    const startX = e.clientX
    const startWidth = resolvedWidth
    pendingWidth.current = startWidth
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizeActive.current) return
      const delta = startX - ev.clientX
      pendingWidth.current = clampWidth(startWidth + delta)
      if (resizeFrame.current !== null) return
      resizeFrame.current = window.requestAnimationFrame(() => {
        resizeFrame.current = null
        const pane = panelStackRef.current
        if (!pane) return
        pane.style.width = `${pendingWidth.current}px`
      })
    }

    const onMouseUp = () => {
      resizeActive.current = false
      if (resizeFrame.current !== null) {
        window.cancelAnimationFrame(resizeFrame.current)
        resizeFrame.current = null
      }
      setDockviewWidth(pendingWidth.current)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }, [clampWidth, resolvedWidth, setDockviewWidth])

  useEffect(() => {
    return () => {
      if (resizeFrame.current !== null) {
        window.cancelAnimationFrame(resizeFrame.current)
      }
    }
  }, [])

  if (isEmbedded) {
    return (
      <div className="flex h-dvh w-dvw flex-col overflow-hidden bg-background">
        <main className="flex-1 min-h-0 overflow-auto">
          <Outlet />
        </main>
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* Titlebar — desktop only: absolute overlay for window drag with
          sidebar-toggle + search (left) and panel-menu (right). On web the
          sidebar header provides branding + search instead. */}
      {desktop && (
        <div
          className="flex justify-between px-2 z-40 shrink-0 absolute top-0 left-0 right-0 h-10 items-start pt-[10px] pointer-events-none"
          style={{ ['WebkitAppRegion' as never]: 'drag' }}
        >
          <div
            className="flex items-center gap-1 pointer-events-auto ml-[72px]"
            style={{ ['WebkitAppRegion' as never]: 'no-drag' }}
          >
            <button
              onClick={toggleSidebar}
              title={effectiveCollapsed ? "Show sidebar" : "Hide sidebar"}
              className={cn(TITLEBAR_BTN, !effectiveCollapsed && TITLEBAR_BTN_ACTIVE)}
            >
              <PanelLeft className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              onClick={() => setCommandPaletteOpen(true)}
              title="Search (⌘K)"
              className={TITLEBAR_BTN}
            >
              <Search className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
          <div
            className="flex items-center gap-1 pointer-events-auto"
            style={{ ['WebkitAppRegion' as never]: 'no-drag' }}
          >
            {showPanelStack && (
              <button
                onClick={() => clearRightPanels()}
                title="Close all panels"
                className={TITLEBAR_BTN}
              >
                <PanelRightClose className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
            <PanelMenu disabled={!project} hasCwd={hasCwd} />
          </div>
        </div>
      )}

      {/* Main row: sidebar (flex item) + content + optional panel stack */}
      <div className={cn("flex min-h-0 flex-1 overflow-hidden", desktop && "pb-3")}>
        {/* Sidebar column — normal flex item, not absolute. On desktop it
            gets top padding to clear the titlebar; collapsed = 52px. */}
        <div
          className="flex shrink-0 relative"
          style={{
            width: desktop ? (effectiveCollapsed ? 52 + 12 : width + 12) : width,
            transition: (desktop && !isSidebarResizing) ? 'width 420ms cubic-bezier(0.22, 1, 0.36, 1)' : undefined,
          }}
        >
          {!desktop && (
            <>
              <Sidebar collapsed={effectiveCollapsed} />
              {!effectiveCollapsed && <SidebarResizeHandle />}
            </>
          )}
        </div>

        {/* Desktop sidebar — positioned as a floating card inside the flex
            column. On web, the sidebar renders inline above. */}
        {desktop && (
          <div
            className={cn(
              "absolute z-30",
              effectiveCollapsed
                ? "top-11 bottom-3 left-3"
                : "top-11 bottom-3 left-3",
            )}
            style={{
              width: effectiveCollapsed ? 52 : sidebarWidth,
              transition: isSidebarResizing
                ? 'top 420ms cubic-bezier(0.22, 1, 0.36, 1), bottom 420ms cubic-bezier(0.22, 1, 0.36, 1), left 420ms cubic-bezier(0.22, 1, 0.36, 1)'
                : 'top 420ms cubic-bezier(0.22, 1, 0.36, 1), bottom 420ms cubic-bezier(0.22, 1, 0.36, 1), left 420ms cubic-bezier(0.22, 1, 0.36, 1), width 420ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <Sidebar collapsed={effectiveCollapsed} />
            {!effectiveCollapsed && <SidebarResizeHandle />}
          </div>
        )}

        <main className={cn(
          "flex-1 min-w-0 flex flex-col overflow-hidden bg-background",
          desktop && "pt-8 pl-3 pr-3",
        )}>
          <SseDisconnectBanner />
          <PasskeyNudgeBanner />
          <div className="flex-1 overflow-auto min-h-0">
            <Outlet />
          </div>
        </main>

        {showPanelStack && (
          <div
            ref={panelStackRef}
            className={cn(
              "relative hidden md:flex shrink-0 bg-background",
              desktop && "pt-8 pr-2",
            )}
            style={{
              width: resolvedWidth,
              maxWidth,
            }}
          >
            <div
              onMouseDown={onResizeStart}
              className="group absolute left-0 top-0 bottom-0 w-3 -translate-x-1/2 cursor-col-resize z-20 flex items-center justify-center"
            >
              <div
                className={cn(
                  "h-10 w-[3px] rounded-full bg-muted-foreground/20",
                  "opacity-0 group-hover:opacity-100 group-active:opacity-100",
                  "group-hover:bg-muted-foreground/50 group-active:bg-primary/60",
                  "transition-all duration-150",
                )}
              />
            </div>
            <PanelStack project={project} className="h-full w-full min-w-0" />
          </div>
        )}
      </div>

      <SafetyPromptDialog />
      <WelcomeProfileDialog />
      <OnboardingFlow />
      <ToastContainer />

      {/* Update banner — appears at the bottom when electron-updater has
          downloaded a new version and is ready to install. */}
      {updateVersion && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg text-sm">
          <span className="text-muted-foreground">
            Astro {updateVersion} is ready to install.
          </span>
          <button
            onClick={() => desktopBridge.updater.install()}
            className="font-medium text-primary hover:underline"
          >
            Restart now
          </button>
          <button
            onClick={() => setUpdateVersion(null)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

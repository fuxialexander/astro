/**
 * WorkspaceLayout — Codex-like three-panel layout shell.
 *
 * Panels (left → right):
 *   1. Sidebar (default 280 px, collapsible) — project list + navigation
 *   2. Main panel (flex-1) — active content via <Outlet /> + bottom terminal
 *   3. Review panel (default 400 px, collapsible) — activity / changes / file
 *
 * Keyboard shortcuts:
 *   Cmd+B  toggle sidebar
 *   Cmd+J  toggle bottom terminal
 *   Cmd+1  focus sidebar
 *   Cmd+2  focus main
 *   Cmd+3  focus review panel
 *   Cmd+K  open command palette
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Outlet, useParams, useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

import { useLayoutStore } from '@desktop/stores/layout-store'
import { useProjectStore } from '@desktop/stores/project-store'
import { ProjectSidebar } from '@desktop/components/sidebar/ProjectSidebar'
import { FileBrowser } from '@desktop/components/files/FileBrowser'
import { GitChangesPanel } from '@desktop/components/git/GitChangesPanel'
import { ResizeHandle } from '@desktop/components/layout/ResizeHandle'
import { WorkspaceHeader } from '@desktop/components/layout/WorkspaceHeader'
import { StatusBar } from '@desktop/components/layout/StatusBar'
import { CommandPalette } from '@desktop/components/common/CommandPalette'
import { TerminalPanel } from '@desktop/components/terminal/TerminalPanel'

// Smooth 200 ms ease-in-out for collapse/expand
const PANEL_TRANSITION = { duration: 0.2, ease: [0.4, 0, 0.2, 1] as number[] }
// No animation during manual resize — instant feedback
const NO_TRANSITION = { duration: 0 }

export function WorkspaceLayout() {
  const {
    sidebarWidth,
    reviewWidth,
    terminalHeight,
    sidebarOpen,
    reviewOpen,
    terminalOpen,
    setSidebarWidth,
    setReviewWidth,
    setTerminalHeight,
    toggleSidebar,
    toggleReview,
    toggleTerminal,
    setActivePanel,
    toggleCommandPalette,
  } = useLayoutStore()

  const { id: projectId } = useParams<{ id: string }>()
  const projects = useProjectStore((s) => s.projects)

  // Derive the working directory from the active project
  const activeProject = projects.find((p) => p.id === projectId)
  const workingDirectory = activeProject?.workingDirectory ?? null

  const setDiffStats = useLayoutStore((s) => s.setDiffStats)

  // Track whether user is currently dragging a resize handle
  const [isResizing, setIsResizing] = useState(false)

  // When a file is selected in the file browser, open the review panel
  const handleFileSelect = useCallback(
    (_path: string) => {
      if (!reviewOpen) toggleReview()
    },
    [reviewOpen, toggleReview],
  )

  // Refs used only inside event handlers — no renders needed
  const resizingPanelRef = useRef<'sidebar' | 'review' | 'terminal' | null>(null)
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const startWidthRef = useRef(0)
  const startHeightRef = useRef(0)

  const navigate = useNavigate()

  // ── Keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const shift = e.shiftKey

      // Non-modifier shortcuts (vim-style) — only when not in input/textarea
      if (!mod && !shift) {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return

        switch (e.key) {
          case '/':
            e.preventDefault()
            // Focus sidebar search input
            document.querySelector<HTMLInputElement>('[data-sidebar-search]')?.focus()
            break
          case 'Escape':
            // Blur any focused input
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
            break
        }
        return
      }

      if (!mod) return

      // Cmd+Shift combinations
      if (shift) {
        switch (e.key.toUpperCase()) {
          case 'D':
            e.preventDefault()
            navigate('/')
            break
          case 'E':
            e.preventDefault()
            navigate('/environments')
            break
          case 'G':
            e.preventDefault()
            toggleReview()
            break
        }
        return
      }

      // Cmd combinations
      switch (e.key) {
        case 'b':
          e.preventDefault()
          toggleSidebar()
          break
        case 'j':
          e.preventDefault()
          toggleTerminal()
          break
        case '`':
          e.preventDefault()
          toggleTerminal()
          break
        case '1':
          e.preventDefault()
          setActivePanel('sidebar')
          break
        case '2':
          e.preventDefault()
          setActivePanel('main')
          break
        case '3':
          e.preventDefault()
          setActivePanel('review')
          break
        case 'k':
          e.preventDefault()
          toggleCommandPalette()
          break
        case 'n':
          e.preventDefault()
          navigate('/')
          // Trigger new project mode via a custom event
          window.dispatchEvent(new CustomEvent('astro:new-project'))
          break
        case 's':
          e.preventDefault()
          // Trigger git commit via custom event
          window.dispatchEvent(new CustomEvent('astro:git-commit'))
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleSidebar, toggleTerminal, toggleReview, setActivePanel, toggleCommandPalette, navigate])

  // ── Resize drag handling ────────────────────────────────────────────
  const startResize = (panel: 'sidebar' | 'review' | 'terminal', e: React.MouseEvent) => {
    e.preventDefault()
    resizingPanelRef.current = panel
    startXRef.current = e.clientX
    startYRef.current = e.clientY
    startWidthRef.current = panel === 'sidebar' ? sidebarWidth : reviewWidth
    startHeightRef.current = terminalHeight
    setIsResizing(true)
    document.body.style.cursor = panel === 'terminal' ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingPanelRef.current) return
      if (resizingPanelRef.current === 'terminal') {
        const delta = startYRef.current - e.clientY
        setTerminalHeight(startHeightRef.current + delta)
      } else if (resizingPanelRef.current === 'sidebar') {
        setSidebarWidth(startWidthRef.current + (e.clientX - startXRef.current))
      } else {
        setReviewWidth(startWidthRef.current - (e.clientX - startXRef.current))
      }
    }

    const onMouseUp = () => {
      if (!resizingPanelRef.current) return
      resizingPanelRef.current = null
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [setSidebarWidth, setReviewWidth, setTerminalHeight])

  const transition = isResizing ? NO_TRANSITION : PANEL_TRANSITION

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      {/* Global command palette — rendered once, globally accessible */}
      <CommandPalette />

      <div className="flex flex-1 min-h-0 overflow-hidden">

      {/* ── Sidebar ───────────────────────────────────────────────── */}
      <motion.div
        animate={{ width: sidebarOpen ? sidebarWidth : 0 }}
        transition={transition}
        style={{ overflow: 'hidden', flexShrink: 0, minWidth: 0 }}
        onClick={() => setActivePanel('sidebar')}
      >
        <div
          style={{ width: sidebarWidth, height: '100%', minWidth: sidebarWidth }}
          className="border-r flex flex-col"
        >
          {/* Traffic-light drag region */}
          <div className="h-[52px] flex-shrink-0" data-tauri-drag-region />
          <div className="flex-1 min-h-0 flex flex-col">
            <ProjectSidebar />
            {projectId && workingDirectory && (
              <div className="border-t flex-1 min-h-0 overflow-hidden">
                <FileBrowser
                  rootPath={workingDirectory}
                  onFileSelect={handleFileSelect}
                />
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Sidebar resize handle */}
      {sidebarOpen && (
        <ResizeHandle onMouseDown={(e) => startResize('sidebar', e)} />
      )}

      {/* ── Main panel ────────────────────────────────────────────── */}
      <div
        className="flex-1 min-w-0 flex flex-col"
        onClick={() => setActivePanel('main')}
      >
        {/* Traffic-light drag region — only when no project is open (welcome screen).
            When a project is open, WorkspaceHeader provides its own draggable spacer. */}
        {!projectId && <div className="h-[52px] flex-shrink-0" data-tauri-drag-region />}

        {/* ── Workspace header — full-width, never compressed by review panel ── */}
        {projectId && <WorkspaceHeader />}

        {/* ── Workspace + review panel side by side ── */}
        <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
          <div className="flex-1 min-w-0 overflow-hidden relative">
            <Outlet />
          </div>

          {/* Review panel resize handle — inside content area */}
          {reviewOpen && (
            <ResizeHandle onMouseDown={(e) => startResize('review', e)} />
          )}

          {/* ── Review panel ── */}
          <motion.div
            animate={{ width: reviewOpen ? reviewWidth : 0 }}
            transition={transition}
            style={{ overflow: 'hidden', flexShrink: 0, minWidth: 0 }}
            onClick={() => setActivePanel('review')}
          >
            <div
              style={{ width: reviewWidth, height: '100%', minWidth: reviewWidth }}
              className="border-l flex flex-col"
            >
              <GitChangesPanel
                repoPath={workingDirectory}
                onStatsChange={setDiffStats}
              />
            </div>
          </motion.div>
        </div>

        {/* ── Bottom terminal resize handle ─── */}
        {terminalOpen && (
          <div
            className="h-1 flex-shrink-0 cursor-row-resize hover:bg-primary/30 transition-colors group border-t"
            onMouseDown={(e) => startResize('terminal', e)}
          >
            <div className="w-8 h-0.5 bg-muted-foreground/20 group-hover:bg-primary/50 mx-auto mt-0.5 rounded-full transition-colors" />
          </div>
        )}

        {/* ── Bottom terminal ─────────────────── */}
        <motion.div
          animate={{ height: terminalOpen ? terminalHeight : 0 }}
          transition={transition}
          style={{ overflow: 'hidden', flexShrink: 0 }}
        >
          <div style={{ height: terminalHeight }} className="flex flex-col border-t bg-background">
            <div className="flex items-center gap-2 px-3 h-8 flex-shrink-0 bg-muted/30 border-b">
              <span className="text-[11px] text-muted-foreground font-medium">Terminal</span>
              <div className="flex-1" />
              <button
                onClick={toggleTerminal}
                className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Close terminal (⌘J)"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <TerminalPanel cwd={workingDirectory} />
            </div>
          </div>
        </motion.div>
      </div>
      </div>

      {/* ── Global bottom status bar ───────────────────── */}
      <StatusBar />
    </div>
  )
}

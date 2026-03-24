/**
 * WorkspaceLayout — Codex-like three-panel layout shell.
 *
 * Panels (left → right):
 *   1. Sidebar (default 280 px, collapsible) — project list + navigation
 *   2. Main panel (flex-1) — active content via <Outlet />
 *   3. Review panel (default 400 px, collapsible) — review / diff / context
 *
 * Keyboard shortcuts:
 *   Cmd+B  toggle sidebar
 *   Cmd+J  toggle review panel
 *   Cmd+1  focus sidebar
 *   Cmd+2  focus main
 *   Cmd+3  focus review panel
 *   Cmd+K  open command palette
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Outlet, useParams } from 'react-router'
import { motion } from 'framer-motion'
import { PanelRightOpen } from 'lucide-react'

import { useLayoutStore } from '@desktop/stores/layout-store'
import { useProjectStore } from '@desktop/stores/project-store'
import { useFileStore } from '@desktop/stores/file-store'
import { ProjectSidebar } from '@desktop/components/sidebar/ProjectSidebar'
import { FileBrowser } from '@desktop/components/files/FileBrowser'
import { DiffViewer } from '@desktop/components/review/DiffViewer'
import { ResizeHandle } from '@desktop/components/layout/ResizeHandle'
import { PanelHeader } from '@desktop/components/layout/PanelHeader'
import { CommandPalette } from '@desktop/components/common/CommandPalette'
import { ActivityFeed } from '@desktop/components/activity/ActivityFeed'
import { cn } from '@desktop/lib/utils'

// Smooth 200 ms ease-in-out for collapse/expand
const PANEL_TRANSITION = { duration: 0.2, ease: [0.4, 0, 0.2, 1] as number[] }
// No animation during manual resize — instant feedback
const NO_TRANSITION = { duration: 0 }

export function WorkspaceLayout() {
  const {
    sidebarWidth,
    reviewWidth,
    sidebarOpen,
    reviewOpen,
    activePanel,
    setSidebarWidth,
    setReviewWidth,
    toggleSidebar,
    toggleReview,
    setActivePanel,
    toggleCommandPalette,
  } = useLayoutStore()

  const { id: projectId } = useParams<{ id: string }>()
  const projects = useProjectStore((s) => s.projects)
  const selectedFile = useFileStore((s) => s.selectedFile)
  const setSelectedFile = useFileStore((s) => s.setSelectedFile)

  // Derive the working directory from the active project
  const activeProject = projects.find((p) => p.id === projectId)
  const workingDirectory = activeProject?.workingDirectory ?? null

  // Track whether user is currently dragging a resize handle
  const [isResizing, setIsResizing] = useState(false)
  // Track whether the review panel is showing a file (DiffViewer) or activity
  const [reviewMode, setReviewMode] = useState<'activity' | 'file'>('activity')

  // When a file is selected in the file browser, open it in the review panel
  const handleFileSelect = useCallback(
    (path: string) => {
      setSelectedFile(path)
      setReviewMode('file')
      if (!reviewOpen) {
        toggleReview()
      }
    },
    [setSelectedFile, reviewOpen, toggleReview],
  )

  // Refs used only inside event handlers — no renders needed
  const resizingPanelRef = useRef<'sidebar' | 'review' | null>(null)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  // ── Keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      switch (e.key) {
        case 'b':
          e.preventDefault()
          toggleSidebar()
          break
        case 'j':
          e.preventDefault()
          toggleReview()
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
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleSidebar, toggleReview, setActivePanel, toggleCommandPalette])

  // ── Resize drag handling ────────────────────────────────────────────
  const startResize = (panel: 'sidebar' | 'review', e: React.MouseEvent) => {
    e.preventDefault()
    resizingPanelRef.current = panel
    startXRef.current = e.clientX
    startWidthRef.current = panel === 'sidebar' ? sidebarWidth : reviewWidth
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingPanelRef.current) return
      const delta = e.clientX - startXRef.current
      if (resizingPanelRef.current === 'sidebar') {
        setSidebarWidth(startWidthRef.current + delta)
      } else {
        setReviewWidth(startWidthRef.current - delta)
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
  }, [setSidebarWidth, setReviewWidth])

  const transition = isResizing ? NO_TRANSITION : PANEL_TRANSITION

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Global command palette — rendered once, globally accessible */}
      <CommandPalette />

      {/* ── Sidebar ───────────────────────────────────────────────── */}
      <motion.div
        animate={{ width: sidebarOpen ? sidebarWidth : 0 }}
        transition={transition}
        style={{ overflow: 'hidden', flexShrink: 0, minWidth: 0 }}
        onClick={() => setActivePanel('sidebar')}
      >
        {/* Inner div holds the actual sidebar at full width so content */}
        {/* doesn't squeeze during animation — the outer clips it. */}
        <div
          style={{ width: sidebarWidth, height: '100%', minWidth: sidebarWidth }}
          className="border-r flex flex-col"
        >
          <div className="flex-1 min-h-0 flex flex-col">
            <ProjectSidebar />
            {/* File browser — shown when a project is active */}
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
        <ResizeHandle
          onMouseDown={(e) => startResize('sidebar', e)}
        />
      )}

      {/* ── Main panel ────────────────────────────────────────────── */}
      <div
        className={cn(
          'flex-1 min-w-0 overflow-hidden flex flex-col',
          activePanel === 'main' && 'ring-inset ring-0',
        )}
        onClick={() => setActivePanel('main')}
      >
        <Outlet />
      </div>

      {/* Review panel resize handle */}
      {reviewOpen && (
        <ResizeHandle
          onMouseDown={(e) => startResize('review', e)}
        />
      )}

      {/* ── Review panel ──────────────────────────────────────────── */}
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
          {/* Review panel tab bar */}
          <div className="flex items-center border-b flex-shrink-0">
            <button
              onClick={() => setReviewMode('activity')}
              className={cn(
                'px-3 py-2 text-xs transition-colors duration-100',
                reviewMode === 'activity'
                  ? 'text-foreground border-b-2 border-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Activity
            </button>
            <button
              onClick={() => setReviewMode('file')}
              className={cn(
                'px-3 py-2 text-xs transition-colors duration-100',
                reviewMode === 'file'
                  ? 'text-foreground border-b-2 border-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              File
            </button>
            <div className="flex-1" />
            <PanelHeader
              title=""
              side="right"
              onCollapse={toggleReview}
            />
          </div>
          <div className="flex-1 overflow-hidden">
            {reviewMode === 'activity' ? (
              <ActivityFeed />
            ) : (
              <DiffViewer
                filePath={selectedFile}
                onClose={() => {
                  setSelectedFile(null)
                  setReviewMode('activity')
                }}
              />
            )}
          </div>
        </div>
      </motion.div>

      {/* Review panel open button (when closed) */}
      {!reviewOpen && (
        <button
          onClick={toggleReview}
          className={cn(
            'flex-shrink-0 flex items-center justify-center w-7',
            'border-l text-muted-foreground',
            'hover:bg-muted hover:text-foreground',
            'transition-colors duration-150',
          )}
          title="Open review panel (⌘J)"
        >
          <PanelRightOpen className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

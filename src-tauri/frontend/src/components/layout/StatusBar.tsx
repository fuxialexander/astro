/**
 * StatusBar — VS Code-style bottom status bar.
 *
 * Always visible. Shows:
 *   - Working directory picker (left)
 *   - Git branch indicator (center-left)
 *   - Sidecar connection status (center-right)
 *   - Open in editor dropdown (right)
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import {
  Monitor, GitBranch, ChevronDown, Check, FolderOpen, GitFork, Cloud,
  ExternalLink, Folder, Terminal,
} from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import { useProjectStore } from '@desktop/stores/project-store'
import { getBaseUrl } from '@desktop/lib/api-client'
import {
  openInEditor, detectEditors, pickDirectory, gitCurrentBranch,
} from '@desktop/lib/tauri-bridge'

const EDITOR_LABELS: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  cursor:   { label: 'Cursor',   Icon: ExternalLink },
  code:     { label: 'VS Code',  Icon: ExternalLink },
  finder:   { label: 'Finder',   Icon: Folder },
  terminal: { label: 'Terminal', Icon: Terminal },
  iterm2:   { label: 'iTerm2',   Icon: Terminal },
  ghostty:  { label: 'Ghostty',  Icon: Terminal },
  xcode:    { label: 'Xcode',    Icon: ExternalLink },
}

export function StatusBar() {
  const project = useProjectStore((s) => s.currentProject)
  const updateProject = useProjectStore((s) => s.updateProject)
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject)

  const [sidecarOk, setSidecarOk] = useState<boolean | null>(null)
  const [currentBranch, setCurrentBranch] = useState('')
  const [editorMenuOpen, setEditorMenuOpen] = useState(false)
  const [editors, setEditors] = useState<string[]>([])
  const [envMenuOpen, setEnvMenuOpen] = useState(false)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)

  const editorMenuRef = useRef<HTMLDivElement>(null)
  const envMenuRef = useRef<HTMLDivElement>(null)
  const branchMenuRef = useRef<HTMLDivElement>(null)

  const hasWorkingDir = !!project?.workingDirectory

  // Health check
  useEffect(() => {
    const check = () =>
      fetch(`${getBaseUrl()}/api/health`, { signal: AbortSignal.timeout(3000) })
        .then((r) => setSidecarOk(r.ok))
        .catch(() => setSidecarOk(false))
    check()
    const interval = setInterval(check, 30_000)
    return () => clearInterval(interval)
  }, [])

  // Branch tracking
  const refreshBranch = useCallback((dir: string) => {
    void gitCurrentBranch(dir).then(setCurrentBranch).catch(() => setCurrentBranch(''))
  }, [])

  useEffect(() => {
    if (project?.workingDirectory) refreshBranch(project.workingDirectory)
    else setCurrentBranch('')
  }, [project?.workingDirectory, refreshBranch])

  // Outside-click to close menus
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (editorMenuRef.current && !editorMenuRef.current.contains(e.target as Node)) setEditorMenuOpen(false)
      if (envMenuRef.current && !envMenuRef.current.contains(e.target as Node)) setEnvMenuOpen(false)
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target as Node)) setBranchMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Load editors lazily
  useEffect(() => {
    if (editorMenuOpen && editors.length === 0)
      void detectEditors().then(setEditors).catch(() => setEditors(['finder', 'terminal']))
  }, [editorMenuOpen, editors.length])

  const handlePickDirectory = useCallback(async () => {
    const dir = await pickDirectory()
    if (dir && project) {
      await updateProject(project.id, { workingDirectory: dir })
      setCurrentProject({ ...project, workingDirectory: dir })
      refreshBranch(dir)
    }
    setEnvMenuOpen(false)
  }, [project, updateProject, setCurrentProject, refreshBranch])

  return (
    <footer className="flex items-center h-6 border-t bg-muted/20 text-[11px] px-2 flex-shrink-0 select-none gap-px">
      {/* Workdir picker */}
      <div className="relative" ref={envMenuRef}>
        <button
          onClick={() => setEnvMenuOpen((o) => !o)}
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
            'text-muted-foreground hover:bg-muted hover:text-foreground',
            envMenuOpen && 'bg-muted text-foreground',
          )}
        >
          <Monitor className="w-3 h-3" />
          <span className="max-w-[180px] truncate">
            {project?.workingDirectory ? project.workingDirectory.split('/').pop() : 'No directory'}
          </span>
          <ChevronDown className="w-2.5 h-2.5 opacity-60" />
        </button>
        {envMenuOpen && (
          <div className="absolute bottom-full mb-1 left-0 z-50 w-72 rounded-lg border bg-popover shadow-xl overflow-hidden">
            <div className="px-3 pt-2.5 pb-1.5 text-[11px] text-muted-foreground font-medium">Continue in</div>
            <button onClick={() => setEnvMenuOpen(false)} className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] text-left hover:bg-muted transition-colors">
              <Monitor className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="flex-1">Local project</span>
              {project?.workingDirectory && <Check className="w-3.5 h-3.5 text-foreground" />}
            </button>
            <button onClick={() => void handlePickDirectory()} className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] text-left hover:bg-muted transition-colors">
              <FolderOpen className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="flex-1">{project?.workingDirectory ?? 'Set working directory...'}</span>
            </button>
            <button disabled={!project?.workingDirectory} className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] text-left hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-default">
              <GitFork className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="flex-1">New worktree</span>
            </button>
            <div className="my-1 border-t" />
            <button disabled className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] text-left opacity-40 cursor-default">
              <Cloud className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="flex-1">Send to cloud</span>
            </button>
          </div>
        )}
      </div>

      {/* Separator */}
      <div className="w-px h-3 bg-border mx-1" />

      {/* Branch indicator */}
      {hasWorkingDir && currentBranch && (
        <div className="relative" ref={branchMenuRef}>
          <button
            onClick={() => setBranchMenuOpen((o) => !o)}
            className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
              'text-muted-foreground hover:bg-muted hover:text-foreground',
              branchMenuOpen && 'bg-muted text-foreground',
            )}
          >
            <GitBranch className="w-3 h-3" />
            <span className="max-w-[140px] truncate">{currentBranch}</span>
          </button>
          {branchMenuOpen && (
            <div className="absolute bottom-full mb-1 left-0 z-50 w-56 rounded-lg border bg-popover shadow-xl overflow-hidden">
              <div className="px-3 pt-2.5 pb-1.5 text-[11px] text-muted-foreground font-medium">Current branch</div>
              <div className="flex items-center gap-2.5 px-3 py-2 text-[12px]">
                <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="flex-1 font-mono truncate">{currentBranch}</span>
                <Check className="w-3.5 h-3.5 text-foreground" />
              </div>
              <div className="px-3 pb-1.5 text-[11px] text-muted-foreground truncate">{project?.workingDirectory}</div>
            </div>
          )}
        </div>
      )}

      <div className="flex-1" />

      {/* Sidecar status */}
      <div className="flex items-center gap-1 px-1.5 text-muted-foreground">
        <span className={cn(
          'w-1.5 h-1.5 rounded-full',
          sidecarOk === null ? 'bg-yellow-400 animate-pulse' : sidecarOk ? 'bg-green-500' : 'bg-red-500',
        )} />
        <span>{sidecarOk === null ? 'Checking...' : sidecarOk ? 'Connected' : 'Offline'}</span>
      </div>

      {/* Separator */}
      {hasWorkingDir && <div className="w-px h-3 bg-border mx-1" />}

      {/* Open in editor */}
      {hasWorkingDir && (
        <div className="relative" ref={editorMenuRef}>
          <button
            onClick={() => setEditorMenuOpen((o) => !o)}
            className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
              'text-muted-foreground hover:bg-muted hover:text-foreground',
              editorMenuOpen && 'bg-muted text-foreground',
            )}
          >
            <ExternalLink className="w-3 h-3" />
            <span>Open</span>
            <ChevronDown className="w-2.5 h-2.5 opacity-60" />
          </button>
          {editorMenuOpen && (
            <div className="absolute bottom-full mb-1 right-0 z-50 min-w-[160px] rounded-lg border bg-popover shadow-xl overflow-hidden">
              {(editors.length > 0 ? editors : ['finder', 'terminal']).map((editorId) => {
                const meta = EDITOR_LABELS[editorId]
                if (!meta) return null
                return (
                  <button
                    key={editorId}
                    onClick={() => { void openInEditor(project!.workingDirectory!, editorId); setEditorMenuOpen(false) }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-left hover:bg-muted transition-colors"
                  >
                    <meta.Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    {meta.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </footer>
  )
}

/**
 * WorkspaceHeader — full-width header + status bar for the workspace.
 * Rendered in WorkspaceLayout ABOVE the content+review-panel row so it
 * never gets compressed when the diff panel slides in.
 */
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router'
import {
  ArrowLeft, MessageSquare, LayoutGrid, GitCommit, ChevronDown,
  Upload, GitPullRequest, GitBranch, Terminal, PanelRight,
} from 'lucide-react'
import { useProjectStore } from '@desktop/stores/project-store'
import { useLayoutStore } from '@desktop/stores/layout-store'
import { cn } from '@desktop/lib/utils'
import { gitCommit, gitPush, gitCreateBranch } from '@desktop/lib/tauri-bridge'

export function WorkspaceHeader() {
  const navigate = useNavigate()
  const project = useProjectStore((s) => s.currentProject)

  const {
    terminalOpen, toggleTerminal,
    toggleReview, reviewOpen,
    diffAdditions, diffDeletions,
    workspaceTab, setWorkspaceTab,
  } = useLayoutStore()

  // Git state
  const [gitMenuOpen, setGitMenuOpen] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [branchName, setBranchName] = useState('')
  const [gitAction, setGitAction] = useState<'commit' | 'branch' | null>(null)
  const [gitRunning, setGitRunning] = useState(false)
  const [gitResult, setGitResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const gitMenuRef = useRef<HTMLDivElement>(null)

  // Outside-click to close menus
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (gitMenuRef.current && !gitMenuRef.current.contains(e.target as Node)) { setGitMenuOpen(false); setGitAction(null) }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Keyboard shortcuts (⌘P toggle chat/plan)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') { e.preventDefault(); setWorkspaceTab(workspaceTab === 'chat' ? 'plan' : 'chat') }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [workspaceTab, setWorkspaceTab])

  // Listen for git commit shortcut (⌘S) from WorkspaceLayout
  useEffect(() => {
    const handler = () => {
      if (project?.workingDirectory) {
        setGitMenuOpen(true)
        setGitAction('commit')
      }
    }
    window.addEventListener('astro:git-commit', handler)
    return () => window.removeEventListener('astro:git-commit', handler)
  }, [project?.workingDirectory])

  // Git handlers
  const runGitCommit = async () => {
    if (!project?.workingDirectory || !commitMsg.trim()) return
    setGitRunning(true); setGitResult(null)
    try {
      const out = await gitCommit(project.workingDirectory, commitMsg.trim())
      setGitResult({ ok: true, msg: out || 'Committed successfully' }); setCommitMsg(''); setGitAction(null)
    } catch (err) { setGitResult({ ok: false, msg: String(err) }) }
    finally { setGitRunning(false) }
  }
  const runGitPush = async () => {
    if (!project?.workingDirectory) return
    setGitRunning(true); setGitResult(null)
    try { const out = await gitPush(project.workingDirectory); setGitResult({ ok: true, msg: out || 'Pushed' }) }
    catch (err) { setGitResult({ ok: false, msg: String(err) }) }
    finally { setGitRunning(false) }
  }
  const runGitCreateBranch = async () => {
    if (!project?.workingDirectory || !branchName.trim()) return
    setGitRunning(true); setGitResult(null)
    try {
      await gitCreateBranch(project.workingDirectory, branchName.trim())
      setGitResult({ ok: true, msg: `Created branch: ${branchName.trim()}` }); setBranchName(''); setGitAction(null)
    } catch (err) { setGitResult({ ok: false, msg: String(err) }) }
    finally { setGitRunning(false) }
  }

  const hasWorkingDir = !!project?.workingDirectory

  if (!project) return <div className="h-11 flex-shrink-0 border-b" data-tauri-drag-region />

  return (
    <>
      {/* ── Header bar ──────────────────────────────────────────── */}
      <header className="flex items-center gap-2 px-3 h-11 border-b flex-shrink-0">
        <button
          onClick={() => navigate('/')}
          className="p-1.5 rounded-md text-muted-foreground flex-shrink-0 hover:bg-muted hover:text-foreground transition-colors duration-150"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>

        <span className="text-base flex-shrink-0">{project.icon ?? '📋'}</span>
        <h1 className="text-sm font-semibold truncate">{project.name}</h1>

        <nav className="flex items-center gap-0.5 ml-1">
          <TabButton icon={MessageSquare} label="Chat" active={workspaceTab === 'chat'} onClick={() => setWorkspaceTab('chat')} shortcut="⌘P" />
          <TabButton icon={LayoutGrid}   label="Plan" active={workspaceTab === 'plan'} onClick={() => setWorkspaceTab('plan')} shortcut="⌘P" />
        </nav>

        {/* Draggable spacer — only the empty middle area allows window dragging */}
        <div className="flex-1" data-tauri-drag-region />

        {/* Git actions */}
        {hasWorkingDir && (
          <div className="relative flex-shrink-0" ref={gitMenuRef}>
            <button
              onClick={() => { setGitMenuOpen((o) => !o); setGitResult(null) }}
              className={cn('flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-150', gitMenuOpen && 'bg-muted text-foreground')}
              title="Git actions"
            >
              <GitCommit className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Git</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {gitMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border bg-popover shadow-lg overflow-hidden">
                {gitResult && (
                  <div className={cn('px-3 py-1.5 text-[11px] border-b', gitResult.ok ? 'text-green-600 bg-green-500/5' : 'text-red-500 bg-red-500/5')}>
                    {gitResult.msg}
                  </div>
                )}
                {gitAction === 'commit' ? (
                  <div className="p-2">
                    <input autoFocus type="text" value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void runGitCommit(); if (e.key === 'Escape') setGitAction(null) }}
                      placeholder="Commit message…" className="w-full bg-muted rounded px-2 py-1 text-xs outline-none placeholder:text-muted-foreground text-foreground mb-1.5" />
                    <div className="flex gap-1">
                      <button onClick={() => void runGitCommit()} disabled={!commitMsg.trim() || gitRunning} className="flex-1 py-1 rounded text-xs bg-primary text-primary-foreground disabled:opacity-40">{gitRunning ? 'Committing…' : 'Commit all'}</button>
                      <button onClick={() => setGitAction(null)} className="px-2 py-1 rounded text-xs text-muted-foreground hover:bg-muted">Cancel</button>
                    </div>
                  </div>
                ) : gitAction === 'branch' ? (
                  <div className="p-2">
                    <input autoFocus type="text" value={branchName} onChange={(e) => setBranchName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void runGitCreateBranch(); if (e.key === 'Escape') setGitAction(null) }}
                      placeholder="Branch name…" className="w-full bg-muted rounded px-2 py-1 text-xs outline-none placeholder:text-muted-foreground text-foreground mb-1.5" />
                    <div className="flex gap-1">
                      <button onClick={() => void runGitCreateBranch()} disabled={!branchName.trim() || gitRunning} className="flex-1 py-1 rounded text-xs bg-primary text-primary-foreground disabled:opacity-40">{gitRunning ? 'Creating…' : 'Create branch'}</button>
                      <button onClick={() => setGitAction(null)} className="px-2 py-1 rounded text-xs text-muted-foreground hover:bg-muted">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="py-1">
                    <GitMenuItem icon={GitCommit} label="Commit…" onClick={() => setGitAction('commit')} />
                    <GitMenuItem icon={Upload} label="Push" onClick={() => void runGitPush()} loading={gitRunning} />
                    <GitMenuItem icon={GitPullRequest} label="Create PR" onClick={() => { if (project.repository) window.open(`${project.repository}/compare`, '_blank'); setGitMenuOpen(false) }} disabled={!project.repository} />
                    <GitMenuItem icon={GitBranch} label="New branch…" onClick={() => setGitAction('branch')} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Diff stats pill */}
        <button
          onClick={toggleReview}
          className={cn('flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors duration-150 text-muted-foreground hover:bg-muted hover:text-foreground', reviewOpen && 'bg-muted text-foreground')}
          title="Toggle diff panel (⌥⌘B)"
        >
          <PanelRight className="w-3.5 h-3.5" />
          {(diffAdditions > 0 || diffDeletions > 0) && (
            <span className="flex items-center gap-1 font-mono">
              {diffAdditions > 0 && <span className="text-green-600">+{diffAdditions.toLocaleString()}</span>}
              {diffDeletions > 0 && <span className="text-red-500">-{diffDeletions.toLocaleString()}</span>}
            </span>
          )}
        </button>

        {/* Terminal toggle */}
        <button onClick={toggleTerminal}
          className={cn('flex items-center justify-center p-1.5 rounded-md text-muted-foreground flex-shrink-0 hover:bg-muted hover:text-foreground transition-colors duration-150', terminalOpen && 'bg-muted text-foreground')}
          title="Toggle terminal (⌘J)">
          <Terminal className="w-3.5 h-3.5" />
        </button>
      </header>
    </>
  )
}

function TabButton({ icon: Icon, label, active, onClick, shortcut }: {
  icon: React.ComponentType<{ className?: string }>; label: string; active: boolean; onClick: () => void; shortcut?: string
}) {
  return (
    <button onClick={onClick}
      className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors duration-150', active ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground')}
      title={shortcut ? `${label} (${shortcut})` : label}>
      <Icon className="w-3.5 h-3.5" />{label}
    </button>
  )
}

function GitMenuItem({ icon: Icon, label, onClick, loading, disabled }: {
  icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; loading?: boolean; disabled?: boolean
}) {
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={cn('flex items-center gap-2.5 w-full px-3 py-2 text-xs text-left transition-colors duration-100', disabled || loading ? 'text-muted-foreground/40 cursor-default' : 'text-foreground hover:bg-muted')}>
      <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      {loading ? `${label.replace('…', '')}ing…` : label}
    </button>
  )
}

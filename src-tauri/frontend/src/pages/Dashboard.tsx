/**
 * Dashboard — rich home page mirroring the web app dashboard.
 *
 * Shows greeting, quick actions, approval cards, task summary,
 * project health cards, and activity feed.
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { Play, Loader2 } from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import { useProjectStore } from '@desktop/stores/project-store'
import { usePlanStore } from '@desktop/stores/plan-store'
import { useActivityStore } from '@desktop/stores/activity-store'
import { useLayoutStore } from '@desktop/stores/layout-store'
import { QuickActions } from '@desktop/components/dashboard/QuickActions'
import { ProjectHealthCard } from '@desktop/components/dashboard/ProjectHealthCard'
import { ActiveTasksSummary } from '@desktop/components/dashboard/ActiveTasksSummary'
import { ActivityFeedPanel } from '@desktop/components/dashboard/ActivityFeedPanel'
import { ApprovalCards } from '@desktop/components/dashboard/ApprovalCards'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function Dashboard() {
  const navigate = useNavigate()
  const { projects, loadProjects } = useProjectStore()
  const { nodes, loadNodes } = usePlanStore()
  const events = useActivityStore((s) => s.events)
  const { toggleCommandPalette } = useLayoutStore()

  const [newProjectMode, setNewProjectMode] = useState(false)
  const [newName, setNewName] = useState('')
  const createProject = useProjectStore((s) => s.createProject)

  // Session input state
  const [goalText, setGoalText] = useState('')
  const [isStarting, setIsStarting] = useState(false)

  // Load data on mount
  useEffect(() => {
    void loadProjects()
    void loadNodes()
  }, [loadProjects, loadNodes])

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === 'active'),
    [projects],
  )

  // Group nodes by project for health cards
  const nodesByProject = useMemo(() => {
    const map = new Map<string, typeof nodes>()
    for (const node of nodes) {
      const list = map.get(node.projectId) ?? []
      list.push(node)
      map.set(node.projectId, list)
    }
    return map
  }, [nodes])

  // Count running tasks per project
  const runningByProject = useMemo(() => {
    const map = new Map<string, number>()
    for (const node of nodes) {
      if (node.status === 'in_progress' || node.status === 'dispatched') {
        map.set(node.projectId, (map.get(node.projectId) ?? 0) + 1)
      }
    }
    return map
  }, [nodes])

  const handleNewProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    const project = await createProject(newName)
    setNewProjectMode(false)
    setNewName('')
    if (project) navigate(`/project/${project.id}`)
  }

  const handleStartSession = useCallback(async () => {
    if (!goalText.trim() || isStarting) return
    setIsStarting(true)
    try {
      const name = goalText.trim().split('\n')[0].slice(0, 60) || 'New Session'
      const project = await createProject(name)
      if (project) {
        navigate(`/project/${project.id}`)
      }
    } finally {
      setIsStarting(false)
    }
  }, [goalText, isStarting, createProject, navigate])

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="max-w-[900px] w-full mx-auto px-8 py-8 flex flex-col gap-6">
        {/* Greeting */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{getGreeting()}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {activeProjects.length} active project{activeProjects.length !== 1 ? 's' : ''}
              {nodes.filter((n) => n.status === 'in_progress').length > 0 && (
                <span className="text-info">
                  {' '} · {nodes.filter((n) => n.status === 'in_progress').length} task{nodes.filter((n) => n.status === 'in_progress').length !== 1 ? 's' : ''} running
                </span>
              )}
            </p>
          </div>
          <QuickActions
            onNewProject={() => setNewProjectMode(true)}
            onOpenPalette={toggleCommandPalette}
          />
        </div>

        {/* Session input */}
        <div
          className={cn(
            'flex flex-col rounded-lg border bg-background overflow-hidden',
            'focus-within:ring-1 focus-within:ring-ring/50 transition-all duration-200',
          )}
        >
          <textarea
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleStartSession()
              }
            }}
            placeholder="Describe what you want to do, or say 'help me plan to ...' to generate a structured plan"
            rows={3}
            className="w-full px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none resize-none bg-transparent"
          />
          <div className="flex items-center justify-end px-4 pb-3">
            <button
              onClick={() => void handleStartSession()}
              disabled={!goalText.trim() || isStarting}
              className={cn(
                'flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium',
                'bg-primary text-primary-foreground',
                'disabled:opacity-40 transition-opacity duration-150',
              )}
            >
              {isStarting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
              {isStarting ? 'Starting...' : 'Start'}
              {!isStarting && <kbd className="ml-1 text-[10px] opacity-50 font-sans">↵</kbd>}
            </button>
          </div>
        </div>

        {/* New project form */}
        {newProjectMode && (
          <form onSubmit={(e) => void handleNewProject(e)} className="flex items-center gap-2 p-3 rounded-xl border bg-card">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setNewProjectMode(false); setNewName('') } }}
              placeholder="Project name..."
              className="flex-1 bg-muted rounded-md px-3 py-1.5 text-sm outline-none text-foreground placeholder:text-muted-foreground"
            />
            <button type="submit" disabled={!newName.trim()} className="px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground disabled:opacity-40">
              Create
            </button>
            <button type="button" onClick={() => { setNewProjectMode(false); setNewName('') }} className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-muted">
              Cancel
            </button>
          </form>
        )}

        {/* Approval cards */}
        <ApprovalCards
          nodes={nodes}
          projects={projects}
          onNavigate={(projectId) => navigate(`/project/${projectId}`)}
        />

        {/* Active tasks summary */}
        <ActiveTasksSummary nodes={nodes} />

        {/* Project health cards */}
        {activeProjects.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Projects
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {activeProjects.map((project) => (
                <ProjectHealthCard
                  key={project.id}
                  project={project}
                  nodes={nodesByProject.get(project.id) ?? []}
                  runningCount={runningByProject.get(project.id) ?? 0}
                  onClick={() => navigate(`/project/${project.id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Activity feed */}
        <ActivityFeedPanel events={events} />

        {/* Keyboard shortcut reference */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-2 pb-4">
          <ShortcutHint keys="⌘B" label="Toggle sidebar" />
          <ShortcutHint keys="⌘J" label="Terminal" />
          <ShortcutHint keys="⌘K" label="Command palette" />
          <ShortcutHint keys="⌘P" label="Chat / Plan" />
          <ShortcutHint keys="⌘N" label="New project" />
          <ShortcutHint keys="⌘⇧D" label="Home" />
          <ShortcutHint keys="j/k" label="Navigate" />
          <ShortcutHint keys="/" label="Search" />
        </div>
      </div>
    </div>
  )
}

function ShortcutHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="font-mono text-[10px] border rounded px-1 py-0.5">{keys}</kbd>
      {label}
    </span>
  )
}

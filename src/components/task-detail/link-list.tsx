import { useState, useCallback, useMemo } from 'react'
import {
  Link2,
  Plus,
  X,
  ExternalLink,
  GitPullRequest,
  CircleDot,
  CheckCircle2,
  GitMerge,
  Search,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { TaskLink, PlanNode } from '@/types'

interface LinkListProps {
  links: TaskLink[]
  nodes: PlanNode[]
  projectId: string
  onAdd: (link: TaskLink) => void
  onRemove: (linkId: string) => void
  readOnly?: boolean
}

function getLinkIcon(link: TaskLink) {
  switch (link.type) {
    case 'github_pr':
      return link.state === 'merged' ? GitMerge : GitPullRequest
    case 'github_issue':
      return link.state === 'closed' ? CheckCircle2 : CircleDot
    case 'task':
      return ArrowRight
    default:
      return ExternalLink
  }
}

function getLinkStateColor(link: TaskLink) {
  if (link.state === 'merged') return 'text-purple-500'
  if (link.state === 'closed') return 'text-red-500'
  if (link.state === 'open') return 'text-green-500'
  return 'text-muted-foreground'
}

function parseGitHubUrl(url: string): { type: 'github_issue' | 'github_pr' | 'url'; number?: number; repo?: string } {
  const prMatch = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  if (prMatch) {
    return { type: 'github_pr', number: parseInt(prMatch[2]), repo: prMatch[1] }
  }

  const issueMatch = url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/)
  if (issueMatch) {
    return { type: 'github_issue', number: parseInt(issueMatch[2]), repo: issueMatch[1] }
  }

  return { type: 'url' }
}

export function LinkList({
  links,
  nodes,
  projectId,
  onAdd,
  onRemove,
  readOnly = false,
}: LinkListProps) {
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [linkType, setLinkType] = useState<'url' | 'task'>('url')
  const [urlInput, setUrlInput] = useState('')
  const [titleInput, setTitleInput] = useState('')
  const [taskSearch, setTaskSearch] = useState('')
  const [selectedTask, setSelectedTask] = useState<PlanNode | null>(null)

  // Filter tasks that can be linked (not the current task, same project)
  const linkableTasks = useMemo(() => {
    return nodes.filter(
      (n) =>
        n.projectId === projectId &&
        n.type === 'task' &&
        !links.some((l) => l.targetId === n.id)
    )
  }, [nodes, projectId, links])

  const filteredTasks = useMemo(() => {
    if (!taskSearch) return linkableTasks.slice(0, 10)
    const search = taskSearch.toLowerCase()
    return linkableTasks
      .filter(
        (n) =>
          n.title.toLowerCase().includes(search) ||
          (n.number?.toString() || '').includes(search)
      )
      .slice(0, 10)
  }, [linkableTasks, taskSearch])

  const handleAddUrl = useCallback(() => {
    if (!urlInput.trim()) return

    const parsed = parseGitHubUrl(urlInput)
    const link: TaskLink = {
      id: crypto.randomUUID(),
      type: parsed.type,
      url: urlInput,
      title: titleInput || parsed.repo || urlInput,
      number: parsed.number,
      state: 'open', // Default to open, could be fetched via API
    }

    onAdd(link)
    setUrlInput('')
    setTitleInput('')
    setShowAddDialog(false)
  }, [urlInput, titleInput, onAdd])

  const handleAddTask = useCallback(() => {
    if (!selectedTask) return

    const link: TaskLink = {
      id: crypto.randomUUID(),
      type: 'task',
      url: `/project/${projectId}/task/${selectedTask.id}`,
      title: selectedTask.title,
      targetId: selectedTask.id,
      number: selectedTask.number,
    }

    onAdd(link)
    setSelectedTask(null)
    setTaskSearch('')
    setShowAddDialog(false)
  }, [selectedTask, projectId, onAdd])

  const groupedLinks = useMemo(() => {
    const groups = {
      github_pr: links.filter((l) => l.type === 'github_pr'),
      github_issue: links.filter((l) => l.type === 'github_issue'),
      task: links.filter((l) => l.type === 'task'),
      other: links.filter((l) => l.type === 'url' || l.type === 'linear_issue'),
    }
    return groups
  }, [links])

  return (
    <div className="space-y-4">
      {/* Add link button */}
      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddDialog(true)}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add link
        </Button>
      )}

      {/* Grouped links */}
      {groupedLinks.github_pr.length > 0 && (
        <LinkGroup title="Pull Requests" links={groupedLinks.github_pr} onRemove={onRemove} readOnly={readOnly} />
      )}

      {groupedLinks.github_issue.length > 0 && (
        <LinkGroup title="GitHub Issues" links={groupedLinks.github_issue} onRemove={onRemove} readOnly={readOnly} />
      )}

      {groupedLinks.task.length > 0 && (
        <LinkGroup
          title="Related Tasks"
          links={groupedLinks.task}
          onRemove={onRemove}
          readOnly={readOnly}
          isInternal
        />
      )}

      {groupedLinks.other.length > 0 && (
        <LinkGroup title="Other Links" links={groupedLinks.other} onRemove={onRemove} readOnly={readOnly} />
      )}

      {/* Empty state */}
      {links.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Link2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No links yet</p>
          {!readOnly && (
            <p className="text-xs mt-1">
              Link GitHub issues, PRs, or other tasks
            </p>
          )}
        </div>
      )}

      {/* Add link dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Link</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Link type toggle */}
            <div className="flex gap-2">
              <Button
                variant={linkType === 'url' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLinkType('url')}
                className="flex-1"
              >
                <ExternalLink className="h-4 w-4 mr-1.5" />
                URL / GitHub
              </Button>
              <Button
                variant={linkType === 'task' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLinkType('task')}
                className="flex-1"
              >
                <ArrowRight className="h-4 w-4 mr-1.5" />
                Task
              </Button>
            </div>

            {linkType === 'url' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    URL
                  </label>
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://github.com/..."
                    className="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    GitHub issues and PRs are automatically detected
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Title (optional)
                  </label>
                  <input
                    type="text"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    placeholder="Display title"
                    className="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <Button
                  onClick={handleAddUrl}
                  disabled={!urlInput.trim()}
                  className="w-full"
                >
                  Add Link
                </Button>
              </div>
            )}

            {linkType === 'task' && (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={taskSearch}
                    onChange={(e) => setTaskSearch(e.target.value)}
                    placeholder="Search tasks..."
                    className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div className="max-h-[200px] overflow-auto space-y-1">
                  {filteredTasks.map((task) => (
                    <button
                      key={task.id}
                      onClick={() => setSelectedTask(task)}
                      className={cn(
                        'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
                        selectedTask?.id === task.id
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      )}
                    >
                      <span className="text-muted-foreground mr-1.5">
                        #{task.number}
                      </span>
                      {task.title}
                    </button>
                  ))}
                  {filteredTasks.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No tasks found
                    </p>
                  )}
                </div>

                <Button
                  onClick={handleAddTask}
                  disabled={!selectedTask}
                  className="w-full"
                >
                  Link Task
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LinkGroup({
  title,
  links,
  onRemove,
  readOnly,
  isInternal,
}: {
  title: string
  links: TaskLink[]
  onRemove: (id: string) => void
  readOnly?: boolean
  isInternal?: boolean
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        {title} ({links.length})
      </h4>
      <div className="space-y-1.5">
        {links.map((link) => {
          const Icon = getLinkIcon(link)
          const stateColor = getLinkStateColor(link)

          return (
            <div
              key={link.id}
              className="flex items-center gap-2 p-2 rounded-md border border-border hover:bg-muted/50 transition-colors"
            >
              <Icon className={cn('h-4 w-4 shrink-0', stateColor)} />
              <div className="flex-1 min-w-0">
                {isInternal ? (
                  <a
                    href={link.url}
                    className="text-sm hover:underline truncate block"
                  >
                    {link.number && (
                      <span className="text-muted-foreground mr-1">
                        #{link.number}
                      </span>
                    )}
                    {link.title}
                  </a>
                ) : (
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm hover:underline truncate block"
                  >
                    {link.number && (
                      <span className="text-muted-foreground mr-1">
                        #{link.number}
                      </span>
                    )}
                    {link.title}
                  </a>
                )}
              </div>
              {link.state && (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] shrink-0',
                    link.state === 'merged' && 'border-purple-500/30 text-purple-500',
                    link.state === 'closed' && 'border-red-500/30 text-red-500',
                    link.state === 'open' && 'border-green-500/30 text-green-500'
                  )}
                >
                  {link.state}
                </Badge>
              )}
              {!readOnly && (
                <button
                  onClick={() => onRemove(link.id)}
                  className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                  title="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

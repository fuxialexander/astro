import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Github,
  Plus,
  Link2,
  Unlink,
  Search,
  Loader2,
  ExternalLink,
  CircleDot,
  CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { usePlanStore } from '@/stores/plan-store'
import { cn } from '@/lib/utils'
import { apiUrl } from '@/lib/api-url'
import { getAccessToken } from '@/lib/supabase-client'
import type { PlanNode, Project } from '@/types'

interface GitHubIssueActionsProps {
  node: PlanNode
  project: Project
}

interface GitHubIssue {
  number: number
  title: string
  state: string
  html_url: string
  labels: Array<{ name: string; color: string }>
}

export function GitHubIssueActions({ node, project }: GitHubIssueActionsProps) {
  const updateNode = usePlanStore((s) => s.updateNode)
  const [isCreating, setIsCreating] = useState(false)
  const [isLinking, setIsLinking] = useState(false)
  const [isUnlinking, setIsUnlinking] = useState(false)
  const [showLinkDialog, setShowLinkDialog] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<GitHubIssue[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isGitHubProject = project.projectType === 'github' && !!project.githubOwner && !!project.githubRepo
  const isLinked = !!node.githubIssueNumber

  const handleCreateIssue = useCallback(async () => {
    setIsCreating(true)
    setError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = await getAccessToken()
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(apiUrl('/api/github/issues'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          nodeId: node.id,
          projectId: project.id,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create issue')
      }

      const data = await res.json()

      // Update local store
      updateNode(node.id, {
        githubIssueNumber: data.issue.number,
        githubIssueUrl: data.issue.url,
        links: [
          ...(node.links || []),
          {
            id: `gh-${data.issue.number}`,
            type: 'github_issue' as const,
            url: data.issue.url,
            title: data.issue.title,
            state: (data.issue.state as 'open' | 'closed' | 'merged') || 'open',
            number: data.issue.number,
          },
        ],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create issue')
    } finally {
      setIsCreating(false)
    }
  }, [node.id, node.links, project.id, updateNode])

  const handleLinkIssue = useCallback(async (issue: GitHubIssue) => {
    setIsLinking(true)
    setError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = await getAccessToken()
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(apiUrl('/api/github/issues/link'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          nodeId: node.id,
          projectId: project.id,
          issueNumber: issue.number,
          issueUrl: issue.html_url,
          issueTitle: issue.title,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to link issue')
      }

      // Update local store
      const existingLinks = (node.links || []).filter(
        (l) => l.id !== `gh-${issue.number}`
      )
      updateNode(node.id, {
        githubIssueNumber: issue.number,
        githubIssueUrl: issue.html_url,
        links: [
          ...existingLinks,
          {
            id: `gh-${issue.number}`,
            type: 'github_issue' as const,
            url: issue.html_url,
            title: issue.title,
            state: (issue.state as 'open' | 'closed' | 'merged') || 'open',
            number: issue.number,
          },
        ],
      })

      setShowLinkDialog(false)
      setSearchQuery('')
      setSearchResults([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link issue')
    } finally {
      setIsLinking(false)
    }
  }, [node.id, node.links, project.id, updateNode])

  const handleUnlink = useCallback(async () => {
    setIsUnlinking(true)
    setError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = await getAccessToken()
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(apiUrl('/api/github/issues/unlink'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          nodeId: node.id,
          projectId: project.id,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to unlink issue')
      }

      // Update local store
      const filteredLinks = (node.links || []).filter(
        (l) => !(l.type === 'github_issue' && l.id === `gh-${node.githubIssueNumber}`)
      )
      updateNode(node.id, {
        githubIssueNumber: undefined,
        githubIssueUrl: undefined,
        links: filteredLinks,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlink issue')
    } finally {
      setIsUnlinking(false)
    }
  }, [node.id, node.githubIssueNumber, node.links, project.id, updateNode])

  const searchIssues = useCallback(async (q: string) => {
    setIsSearching(true)
    try {
      const params = new URLSearchParams({ projectId: project.id })
      if (q) params.set('q', q)

      const searchHeaders: Record<string, string> = {}
      const searchToken = await getAccessToken()
      if (searchToken) searchHeaders['Authorization'] = `Bearer ${searchToken}`

      const res = await fetch(apiUrl(`/api/github/issues/search?${params}`), { headers: searchHeaders })
      if (!res.ok) {
        throw new Error('Failed to search issues')
      }

      const data = await res.json()
      setSearchResults(data.issues || [])
    } catch {
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }, [project.id])

  // Debounced search
  useEffect(() => {
    if (!showLinkDialog) return

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    searchTimeoutRef.current = setTimeout(() => {
      searchIssues(searchQuery)
    }, 300)

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [searchQuery, showLinkDialog, searchIssues])

  // Load issues when dialog opens
  useEffect(() => {
    if (showLinkDialog) {
      searchIssues('')
    }
  }, [showLinkDialog, searchIssues])

  // Not a GitHub-linked project — render nothing
  if (!isGitHubProject) {
    return null
  }

  return (
    <div className="space-y-2">
      {/* Current link status */}
      {isLinked && (
        <a
          href={node.githubIssueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-md border border-border hover:bg-muted/50 transition-colors text-sm"
        >
          <Github className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">
            <span className="text-muted-foreground">#{node.githubIssueNumber}</span>
            {' '}
            <span className="text-muted-foreground text-xs">
              {project.githubOwner}/{project.githubRepo}
            </span>
          </span>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </a>
      )}

      {/* Actions dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={isCreating || isUnlinking}
          >
            {(isCreating || isUnlinking) ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Github className="h-4 w-4 mr-1.5" />
            )}
            {isLinked ? 'GitHub Issue' : 'Link GitHub Issue'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {!isLinked && (
            <>
              <DropdownMenuItem onClick={handleCreateIssue} disabled={isCreating}>
                <Plus className="h-4 w-4 mr-2" />
                Create new issue
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowLinkDialog(true)}>
                <Link2 className="h-4 w-4 mr-2" />
                Link existing issue
              </DropdownMenuItem>
            </>
          )}
          {isLinked && (
            <>
              <DropdownMenuItem asChild>
                <a
                  href={node.githubIssueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open #{node.githubIssueNumber} on GitHub
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleUnlink}
                disabled={isUnlinking}
                className="text-destructive focus:text-destructive"
              >
                <Unlink className="h-4 w-4 mr-2" />
                Unlink issue
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Error message */}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {/* Link existing issue dialog */}
      <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Link GitHub Issue from {project.githubOwner}/{project.githubRepo}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Search input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search issues..."
                className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {/* Results */}
            <div className="max-h-[300px] overflow-auto space-y-1">
              {searchResults.map((issue) => (
                <button
                  key={issue.number}
                  onClick={() => handleLinkIssue(issue)}
                  disabled={isLinking}
                  className={cn(
                    'w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors hover:bg-muted',
                    'flex items-start gap-2'
                  )}
                >
                  {issue.state === 'open' ? (
                    <CircleDot className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-purple-500 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground font-mono text-xs">
                        #{issue.number}
                      </span>
                      <span className="truncate">{issue.title}</span>
                    </div>
                    {issue.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {issue.labels.slice(0, 3).map((label) => {
                          const safeColor = /^[0-9a-fA-F]{6}$/.test(label.color) ? label.color : '888888'
                          return (
                          <Badge
                            key={label.name}
                            variant="outline"
                            className="text-[10px] py-0"
                            style={{
                              borderColor: `#${safeColor}40`,
                              color: `#${safeColor}`,
                            }}
                          >
                            {label.name}
                          </Badge>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </button>
              ))}
              {!isSearching && searchResults.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No issues found
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

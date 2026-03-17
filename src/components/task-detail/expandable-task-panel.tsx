import { useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  ArrowLeft,
  Maximize2,
  Minimize2,
  X,
  SplitSquareVertical,
  Square,
  Paperclip,
  Link2,
  Save,
  Loader2,
  ExternalLink,
  Clock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { RichTextEditor, type RichTextEditorRef } from '@/components/ui/rich-text-editor'
import { usePlanStore } from '@/stores/plan-store'
import { useProjectStore } from '@/stores/project-store'
import { statusBadgeVariants } from '@/lib/status-config'
import { cn, getShortId } from '@/lib/utils'
import { sanitizeHtml } from '@/lib/sanitize-html'
import type { PlanNode, TaskAttachment, TaskLink } from '@/types'
import { AttachmentList } from './attachment-list'
import { LinkList } from './link-list'
import { GitHubIssueActions } from './github-issue-actions'
import { ScheduleForm } from '@/components/schedule/schedule-form'
import { RunHistory } from '@/components/schedule/run-history'
import { useScheduleStore } from '@/stores/schedule-store'
import { useRef, useEffect } from 'react'

export type PanelSize = 'split' | 'three-quarter' | 'full'

interface ExpandableTaskPanelProps {
  node: PlanNode
  projectId: string
  initialSize?: PanelSize
  onClose?: () => void
  children?: React.ReactNode // Activity/trace/files content
}

const sizeConfig = {
  split: {
    width: 'w-1/2',
    label: 'Split',
    icon: SplitSquareVertical,
  },
  'three-quarter': {
    width: 'w-3/4',
    label: '3/4 Page',
    icon: Maximize2,
  },
  full: {
    width: 'w-full',
    label: 'Full Page',
    icon: Square,
  },
}

export function ExpandableTaskPanel({
  node,
  projectId,
  initialSize = 'split',
  onClose,
  children,
}: ExpandableTaskPanelProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [size, setSize] = useState<PanelSize>(initialSize)
  const [activeTab, setActiveTab] = useState<'content' | 'attachments' | 'links' | 'activity' | 'schedule'>('content')
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const editorRef = useRef<RichTextEditorRef>(null)

  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const updateNode = usePlanStore((s) => s.updateNode)
  const nodes = usePlanStore((s) => s.nodes)
  const schedules = useScheduleStore((s) => s.schedules)
  const loadSchedules = useScheduleStore((s) => s.loadSchedules)
  const nodeSchedule = schedules.find((s) => s.scope === 'node' && s.nodeId === node.id)

  useEffect(() => {
    loadSchedules(projectId)
  }, [projectId, loadSchedules])

  const [draftContent, setDraftContent] = useState(node.content || '')

  // Sync draft content when node.content arrives async (slim → full load transition).
  useEffect(() => {
    const latest = node.content || ''
    if (latest !== draftContent && !hasChanges) {
      setDraftContent(latest)
    }
  }, [node.content]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleContentChange = useCallback((html: string) => {
    setDraftContent(html)
    setHasChanges(html !== (node.content || ''))
  }, [node.content])

  const handleSave = useCallback(async () => {
    if (!hasChanges) return
    setIsSaving(true)
    try {
      await updateNode(node.id, { content: draftContent })
      setHasChanges(false)
    } catch (err) {
      console.error('Failed to save task content:', err)
    } finally {
      setIsSaving(false)
    }
  }, [node.id, draftContent, hasChanges, updateNode])

  const handleAddAttachment = useCallback((attachment: TaskAttachment) => {
    const currentAttachments = node.attachments || []
    updateNode(node.id, {
      attachments: [...currentAttachments, attachment],
    })
    // Insert image into editor if it's an image
    if (attachment.mimeType.startsWith('image/') && editorRef.current) {
      editorRef.current.insertImage(attachment.url, attachment.name)
    }
  }, [node.id, node.attachments, updateNode])

  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    const currentAttachments = node.attachments || []
    updateNode(node.id, {
      attachments: currentAttachments.filter((a) => a.id !== attachmentId),
    })
  }, [node.id, node.attachments, updateNode])

  const handleAddLink = useCallback((link: TaskLink) => {
    const currentLinks = node.links || []
    updateNode(node.id, {
      links: [...currentLinks, link],
    })
  }, [node.id, node.links, updateNode])

  const handleRemoveLink = useCallback((linkId: string) => {
    const currentLinks = node.links || []
    updateNode(node.id, {
      links: currentLinks.filter((l) => l.id !== linkId),
    })
  }, [node.id, node.links, updateNode])

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose()
    } else {
      const returnView = searchParams.get('from') || 'list'
      navigate(`/project/${projectId}/${returnView}`)
    }
  }, [onClose, searchParams, navigate, projectId])

  const cycleSize = useCallback(() => {
    const sizes: PanelSize[] = ['split', 'three-quarter', 'full']
    const currentIndex = sizes.indexOf(size)
    setSize(sizes[(currentIndex + 1) % sizes.length])
  }, [size])

  const SizeIcon = sizeConfig[size].icon

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-card border-l border-border transition-all duration-300',
        sizeConfig[size].width,
        size === 'full' && 'border-l-0'
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose}>
          {size === 'full' ? <ArrowLeft className="h-4 w-4" /> : <X className="h-4 w-4" />}
        </Button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm font-mono">{getShortId(node.id)}</span>
            <h2 className="font-semibold truncate">{node.title}</h2>
            <Badge variant={statusBadgeVariants[node.status] || 'secondary'} className="text-[10px]">
              {node.status.replace(/_/g, ' ')}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {project?.name} &middot; {node.type}
          </p>
        </div>

        <div className="flex items-center gap-1">
          {hasChanges && (
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="h-8"
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span className="ml-1.5">Save</span>
            </Button>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={cycleSize}>
                <SizeIcon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {sizeConfig[size].label} (click to cycle)
            </TooltipContent>
          </Tooltip>

          {size !== 'full' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setSize('full')}
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Expand to full page</TooltipContent>
            </Tooltip>
          )}

          {size === 'full' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setSize('split')}
                >
                  <Minimize2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Collapse to split view</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-4 mt-3 w-fit shrink-0">
          <TabsTrigger value="content" className="text-xs">
            Content
          </TabsTrigger>
          <TabsTrigger value="attachments" className="text-xs">
            <Paperclip className="h-3.5 w-3.5 mr-1" />
            {(node.attachments?.length || 0) > 0 && `(${node.attachments?.length})`}
          </TabsTrigger>
          <TabsTrigger value="links" className="text-xs">
            <Link2 className="h-3.5 w-3.5 mr-1" />
            {(node.links?.length || 0) > 0 && `(${node.links?.length})`}
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-xs">
            Activity
          </TabsTrigger>
          <TabsTrigger value="schedule" className="text-xs">
            <Clock className="h-3.5 w-3.5 mr-1" />
            Schedule
          </TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="flex-1 m-0 min-h-0 overflow-auto p-4">
          <div className="space-y-4">
            {/* Description (read-only task instructions) */}
            {(node.content || node.description) && (
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Task Instructions
                </h3>
                {node.content ? (
                  <div className="text-sm text-foreground prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(node.content) }} />
                ) : (
                  <p className="text-sm text-foreground whitespace-pre-wrap">{node.description}</p>
                )}
              </div>
            )}

            {/* Rich content editor */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Notes & Details
              </h3>
              <RichTextEditor
                ref={editorRef}
                content={draftContent}
                onChange={handleContentChange}
                placeholder="Add notes, context, or additional details about this task..."
                className="min-h-[300px]"
              />
            </div>

            {/* Quick links preview */}
            {(node.links?.length || 0) > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Linked Items
                </h3>
                <div className="flex flex-wrap gap-2">
                  {node.links?.slice(0, 5).map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted hover:bg-accent text-xs transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {link.title}
                    </a>
                  ))}
                  {(node.links?.length || 0) > 5 && (
                    <button
                      onClick={() => setActiveTab('links')}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      +{(node.links?.length || 0) - 5} more
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="attachments" className="flex-1 m-0 min-h-0 overflow-auto p-4">
          <AttachmentList
            attachments={node.attachments || []}
            onAdd={handleAddAttachment}
            onRemove={handleRemoveAttachment}
          />
        </TabsContent>

        <TabsContent value="links" className="flex-1 m-0 min-h-0 overflow-auto p-4">
          {/* GitHub issue actions */}
          {project && project.projectType === 'github' && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                GitHub
              </h4>
              <GitHubIssueActions node={node} project={project} />
            </div>
          )}
          <LinkList
            links={node.links || []}
            nodes={nodes}
            projectId={projectId}
            onAdd={handleAddLink}
            onRemove={handleRemoveLink}
          />
        </TabsContent>

        <TabsContent value="activity" className="flex-1 m-0 min-h-0">
          {children}
        </TabsContent>

        <TabsContent value="schedule" className="flex-1 m-0 min-h-0 overflow-auto p-4">
          <div className="space-y-4">
            {nodeSchedule ? (
              <>
                <ScheduleForm
                  projectId={projectId}
                  scope="node"
                  nodeId={node.id}
                  schedule={nodeSchedule}
                  onSave={() => loadSchedules(projectId)}
                />
                <RunHistory scheduleId={nodeSchedule.id} />
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Set up a recurring schedule for this task.
                </p>
                <ScheduleForm
                  projectId={projectId}
                  scope="node"
                  nodeId={node.id}
                  onSave={() => loadSchedules(projectId)}
                />
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

import { useState, useCallback, useRef } from 'react'
import { Save, Loader2, ExternalLink, Paperclip, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RichTextEditor, type RichTextEditorRef } from '@/components/ui/rich-text-editor'
import { AttachmentList } from './attachment-list'
import { LinkList } from './link-list'
import { usePlanStore } from '@/stores/plan-store'
import { cn } from '@/lib/utils'
import type { PlanNode, TaskAttachment, TaskLink } from '@/types'
import type { PanelSize } from '@/pages/task-detail'

interface TaskContentTabProps {
  node: PlanNode
  projectId: string
  panelSize: PanelSize
}

export function TaskContentTab({ node, projectId, panelSize }: TaskContentTabProps) {
  const updateNode = usePlanStore((s) => s.updateNode)
  const nodes = usePlanStore((s) => s.nodes)
  const editorRef = useRef<RichTextEditorRef>(null)

  const [draftContent, setDraftContent] = useState(node.content || '')
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [activeSection, setActiveSection] = useState<'content' | 'attachments' | 'links'>('content')

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

  // Layout changes based on panel size
  const isWide = panelSize === 'three-quarter' || panelSize === 'full'

  return (
    <div className="p-4 md:p-6">
      {/* Save button - sticky at top when content changes */}
      {hasChanges && (
        <div className="sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-2 mb-4 bg-background/95 backdrop-blur border-b border-border flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Unsaved changes
          </span>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1.5" />
            )}
            Save
          </Button>
        </div>
      )}

      <div className={cn(
        'space-y-6',
        isWide && 'grid grid-cols-3 gap-6 space-y-0'
      )}>
        {/* Main content area */}
        <div className={cn(isWide && 'col-span-2 space-y-6')}>
          {/* Task Instructions (read-only description) */}
          {node.description && (
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Task Instructions
              </h3>
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {node.description}
              </p>
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
              placeholder="Add notes, context, or additional details about this task. You can include images, links, and formatting..."
              className={cn(
                'min-h-[300px]',
                isWide && 'min-h-[400px]'
              )}
            />
          </div>

          {/* Quick links preview (only shown on narrow layout) */}
          {!isWide && (node.links?.length || 0) > 0 && (
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
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted hover:bg-accent text-xs transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {link.title}
                    {link.number && <span className="text-muted-foreground">#{link.number}</span>}
                  </a>
                ))}
                {(node.links?.length || 0) > 5 && (
                  <button
                    onClick={() => setActiveSection('links')}
                    className="text-xs text-primary hover:underline"
                  >
                    +{(node.links?.length || 0) - 5} more
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar for attachments and links (wide layout) */}
        {isWide && (
          <div className="space-y-6">
            {/* Section tabs */}
            <div className="flex border-b border-border">
              <button
                onClick={() => setActiveSection('attachments')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
                  activeSection === 'attachments'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <Paperclip className="h-3.5 w-3.5" />
                Attachments
                {(node.attachments?.length || 0) > 0 && (
                  <span className="ml-1 text-muted-foreground">({node.attachments?.length})</span>
                )}
              </button>
              <button
                onClick={() => setActiveSection('links')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
                  activeSection === 'links'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <Link2 className="h-3.5 w-3.5" />
                Links
                {(node.links?.length || 0) > 0 && (
                  <span className="ml-1 text-muted-foreground">({node.links?.length})</span>
                )}
              </button>
            </div>

            {/* Section content */}
            {activeSection === 'attachments' && (
              <AttachmentList
                attachments={node.attachments || []}
                onAdd={handleAddAttachment}
                onRemove={handleRemoveAttachment}
              />
            )}
            {activeSection === 'links' && (
              <LinkList
                links={node.links || []}
                nodes={nodes}
                projectId={projectId}
                onAdd={handleAddLink}
                onRemove={handleRemoveLink}
              />
            )}
          </div>
        )}

        {/* Attachments and links (narrow layout - collapsible) */}
        {!isWide && (
          <>
            <div>
              <button
                onClick={() => setActiveSection(activeSection === 'attachments' ? 'content' : 'attachments')}
                className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors"
              >
                <Paperclip className="h-3.5 w-3.5" />
                Attachments
                {(node.attachments?.length || 0) > 0 && (
                  <span>({node.attachments?.length})</span>
                )}
              </button>
              {activeSection === 'attachments' && (
                <AttachmentList
                  attachments={node.attachments || []}
                  onAdd={handleAddAttachment}
                  onRemove={handleRemoveAttachment}
                />
              )}
            </div>

            <div>
              <button
                onClick={() => setActiveSection(activeSection === 'links' ? 'content' : 'links')}
                className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors"
              >
                <Link2 className="h-3.5 w-3.5" />
                Links
                {(node.links?.length || 0) > 0 && (
                  <span>({node.links?.length})</span>
                )}
              </button>
              {activeSection === 'links' && (
                <LinkList
                  links={node.links || []}
                  nodes={nodes}
                  projectId={projectId}
                  onAdd={handleAddLink}
                  onRemove={handleRemoveLink}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

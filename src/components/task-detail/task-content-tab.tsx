import { useState, useCallback, useRef, useMemo } from 'react'
import { stripHtml } from '@/lib/html-utils'
import { Save, Loader2, ExternalLink, Paperclip, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RichTextEditor, type RichTextEditorRef } from '@/components/ui/rich-text-editor'
import { AttachmentList } from './attachment-list'
import { LinkList } from './link-list'
import { CommentSection } from './comment-section'
import { usePlanStore } from '@/stores/plan-store'
import { useUserProfileStore } from '@/stores/user-profile-store'
import { dataClient } from '@/lib/data-client'
import { fileToBase64 } from '@/lib/html-utils'
import { cn } from '@/lib/utils'
import type { PlanNode, TaskAttachment, TaskLink } from '@/types'
import type { MentionSuggestionItem } from '@/components/ui/mention-suggestion'
import type { PanelSize } from '@/pages/task-detail'

interface TaskContentTabProps {
  node: PlanNode
  projectId: string
  panelSize: PanelSize
  fileTree?: string[]
}

export function TaskContentTab({ node, projectId, panelSize, fileTree }: TaskContentTabProps) {
  const updateNode = usePlanStore((s) => s.updateNode)
  const nodes = usePlanStore((s) => s.nodes)
  const profile = useUserProfileStore((s) => s.profile)
  const editorRef = useRef<RichTextEditorRef>(null)

  // Initialize with content or fall back to description for backward compat
  const initialContent = node.content || (node.description ? `<p>${node.description}</p>` : '')
  const [draftContent, setDraftContent] = useState(initialContent)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [activeSection, setActiveSection] = useState<'content' | 'attachments' | 'links'>('content')

  // Build mention items from sibling plan nodes + file tree
  const mentionItems = useMemo<MentionSuggestionItem[]>(() => {
    const taskItems: MentionSuggestionItem[] = nodes
      .filter((n) => n.projectId === projectId && n.id !== node.id && !n.deletedAt)
      .map((n) => ({
        id: n.id,
        label: n.title,
        type: 'task' as const,
      }))
    const fileItems: MentionSuggestionItem[] = (fileTree || []).map((f) => ({
      id: f,
      label: f,
      type: 'file' as const,
    }))
    return [...taskItems, ...fileItems]
  }, [nodes, projectId, node.id, fileTree])

  const handleContentChange = useCallback((html: string) => {
    setDraftContent(html)
    setHasChanges(html !== initialContent)
  }, [initialContent])

  const handleSave = useCallback(async () => {
    if (!hasChanges) return
    setIsSaving(true)
    try {
      await updateNode(node.id, { content: draftContent, description: stripHtml(draftContent) })
      setHasChanges(false)
    } finally {
      setIsSaving(false)
    }
  }, [node.id, draftContent, hasChanges, updateNode])

  const handleImageUpload = useCallback(async (file: File): Promise<string | null> => {
    try {
      const base64 = await fileToBase64(file)
      const blobId = await dataClient.uploadBlob(
        base64,
        file.type,
        file.size,
        file.name,
        node.id,
        projectId
      )
      return dataClient.getBlobUrl(blobId)
    } catch (err) {
      console.error('Failed to upload image:', err)
      return null
    }
  }, [node.id, projectId])

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
          {/* Rich content editor */}
          <div>
            <RichTextEditor
              ref={editorRef}
              content={draftContent}
              onChange={handleContentChange}
              placeholder="Add task instructions, notes, and details. Use @ to mention tasks. Paste or drop images..."
              mentionItems={mentionItems}
              onImageUpload={handleImageUpload}
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

          {/* Comments section */}
          <CommentSection
            nodeId={node.id}
            projectId={projectId}
            userName={profile?.name || 'User'}
          />
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

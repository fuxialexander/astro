import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Loader2, ExternalLink, Paperclip, Link2, CircleCheck } from 'lucide-react'
import { RichTextEditor, type RichTextEditorRef } from '@/components/ui/rich-text-editor'
import { AttachmentList } from './attachment-list'
import { LinkList } from './link-list'
import { CommentSection } from './comment-section'
import { usePlanStore } from '@/stores/plan-store'
import { useUserProfileStore } from '@/stores/user-profile-store'
import { useContentSaveStore } from '@/stores/content-save-store'
import { dataClient } from '@/lib/data-client'
import { fileToBase64, looksLikeMarkdown, markdownToHtml } from '@/lib/html-utils'
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
  const registerPendingSave = useContentSaveStore((s) => s.registerPendingSave)
  const editorRef = useRef<RichTextEditorRef>(null)
  const mountedRef = useRef(true)

  // Initialize with content or fall back to description for backward compat.
  // When `content` (HTML) is absent but `description` exists (e.g., GitHub-synced
  // issues store raw markdown in `description`), convert markdown → HTML so the
  // tiptap editor renders formatting correctly instead of showing raw markdown text.
  const initialContent = useMemo(() => {
    if (node.content) return node.content
    if (!node.description) return ''
    if (looksLikeMarkdown(node.description)) {
      return markdownToHtml(node.description)
    }
    // Plain text fallback — wrap in <p> tag
    return `<p>${node.description}</p>`
  }, [node.content, node.description])
  const [draftContent, setDraftContent] = useState(initialContent)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [activeSection, setActiveSection] = useState<'content' | 'attachments' | 'links'>('content')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef<Promise<void> | null>(null)

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
    if (html === initialContent) return

    if (debounceRef.current) clearTimeout(debounceRef.current)

    // Register a flush function that immediately executes the save
    const flushFn = async () => {
      // Cancel the debounced timer
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }

      // If already saving, wait for that to complete, then proceed with our save
      // (don't early return — the content may have changed since the last save started)
      if (savingRef.current) {
        await savingRef.current
      }

      try {
        if (mountedRef.current) setSaveStatus('saving')

        // Get markdown from editor (only if available)
        // If editor is unavailable (e.g., after unmount), only update content field
        // to prevent clearing the description (which would cause data loss)
        const markdown = editorRef.current?.getMarkdown()
        const updates: Partial<PlanNode> = { content: html }
        if (markdown !== undefined) {
          updates.description = markdown
        } else {
          console.warn('[content-save] Editor unavailable, saving content only (description preserved)')
        }

        // Call dataClient.updateNode directly to ensure we await the actual API call
        // (plan-store.updateNode fires and forgets, which defeats the flush mechanism)
        const savePromise = dataClient.updateNode(node.id, updates)
        savingRef.current = savePromise

        await savePromise

        // Also update local store state so the UI reflects the change immediately
        updateNode(node.id, updates)

        savingRef.current = null
        // Don't clear pending save here - it may have been overwritten by a newer flush
        // while this save was in progress. Clearing would lose the newer flush function.
        if (mountedRef.current) {
          setSaveStatus('saved')
          setTimeout(() => {
            if (mountedRef.current) setSaveStatus('idle')
          }, 1500)
        }
      } catch (error) {
        savingRef.current = null
        if (mountedRef.current) setSaveStatus('idle')
        console.error('Failed to save task content:', error)
        throw error
      }
    }

    registerPendingSave(node.id, flushFn)

    debounceRef.current = setTimeout(async () => {
      await flushFn()
      // Debounce completed — content is persisted. Clear the stale flush
      // function so "Execute All" doesn't re-save old captured html for
      // every task the user browsed. Only clear if the store still holds
      // THIS flushFn (a newer edit may have registered a new one mid-save).
      const current = useContentSaveStore.getState().pendingSaves.get(node.id)
      if (current?.flush === flushFn) {
        useContentSaveStore.getState().clearPendingSave(node.id)
      }
    }, 800)
  }, [node.id, initialContent, updateNode, registerPendingSave])

  // Cleanup debounce on unmount and mark component as unmounted
  // Note: We intentionally DON'T clear the pending save from the store here.
  // If a user navigates away before the debounce fires, the flush function should
  // remain available so that execution can still trigger the save. This prevents
  // data loss when users navigate away quickly after editing.
  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

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
      <div className={cn(
        'space-y-6',
        isWide && 'grid grid-cols-3 gap-6 space-y-0'
      )}>
        {/* Main content area */}
        <div className={cn('space-y-8', isWide && 'col-span-2')}>
          {/* Rich content editor — save status shown inline in toolbar */}
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
              toolbarExtra={
                <span className="text-xs text-muted-foreground flex items-center gap-1 min-w-[60px] justify-end">
                  {saveStatus === 'saving' && (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Saving...
                    </>
                  )}
                  {saveStatus === 'saved' && (
                    <>
                      <CircleCheck className="h-3 w-3" />
                      Saved
                    </>
                  )}
                </span>
              }
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

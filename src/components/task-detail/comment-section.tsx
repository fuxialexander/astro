import { useState, useCallback, useEffect } from 'react'
import { Bot, Send, Trash2, User, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { dataClient } from '@/lib/data-client'
import { cn } from '@/lib/utils'
import type { NodeComment } from '@/types'

interface CommentSectionProps {
  nodeId: string
  projectId: string
  userName: string
}

export function CommentSection({ nodeId, projectId, userName }: CommentSectionProps) {
  const [comments, setComments] = useState<NodeComment[]>([])
  const [newComment, setNewComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Load comments
  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    dataClient.getComments(nodeId, projectId).then((result) => {
      if (!cancelled) {
        setComments(result)
        setIsLoading(false)
      }
    }).catch(() => {
      if (!cancelled) setIsLoading(false)
    })
    return () => { cancelled = true }
  }, [nodeId, projectId])

  const handleSubmit = useCallback(async () => {
    if (!newComment.trim() || isSubmitting) return

    setIsSubmitting(true)
    try {
      const comment = await dataClient.createComment({
        nodeId,
        projectId,
        authorName: userName,
        authorType: 'user',
        content: newComment.trim(),
      })
      setComments((prev) => [...prev, comment])
      setNewComment('')
    } finally {
      setIsSubmitting(false)
    }
  }, [newComment, nodeId, projectId, userName, isSubmitting])

  const handleDelete = useCallback(async (id: string) => {
    await dataClient.deleteComment(id)
    setComments((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Comments
        </h3>
        {comments.length > 0 && (
          <span className="text-[10px] font-medium text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
            {comments.length}
          </span>
        )}
      </div>

      {/* Comment list */}
      {isLoading ? (
        <p className="text-xs text-muted-foreground py-3">Loading comments...</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No comments yet. Start a discussion below.</p>
      ) : (
        <div className="space-y-1">
          {comments.map((comment) => (
            <div key={comment.id} className="group flex gap-3 rounded-lg p-2 -mx-2 hover:bg-muted/40 transition-colors">
              {/* Avatar */}
              <div className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium mt-0.5',
                comment.authorType === 'agent'
                  ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                  : 'bg-primary/10 text-primary'
              )}>
                {comment.authorType === 'agent' ? (
                  <Bot className="h-3.5 w-3.5" />
                ) : (
                  <User className="h-3.5 w-3.5" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {comment.authorName}
                  </span>
                  {comment.authorType === 'agent' && (
                    <span className="text-[10px] font-medium text-purple-600 dark:text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">
                      Agent
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {formatTime(comment.createdAt)}
                  </span>
                  <button
                    onClick={() => handleDelete(comment.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all ml-auto"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <p className="text-sm text-foreground/90 mt-1 whitespace-pre-wrap leading-relaxed">
                  {comment.content}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New comment input */}
      <div className="relative rounded-lg border border-input bg-background overflow-hidden focus-within:ring-1 focus-within:ring-ring transition-shadow">
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a comment..."
          rows={2}
          className="w-full resize-none bg-transparent px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none"
        />
        <div className="flex items-center justify-between border-t border-border/50 bg-muted/20 px-3 py-1.5">
          <span className="text-[10px] text-muted-foreground">
            {newComment.trim() ? '⌘ Enter to submit' : ''}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleSubmit}
            disabled={!newComment.trim() || isSubmitting}
            className="h-6 px-2 text-xs gap-1"
          >
            <Send className="h-3 w-3" />
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

function formatTime(date: Date): string {
  const d = date instanceof Date ? date : new Date(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  return d.toLocaleDateString()
}

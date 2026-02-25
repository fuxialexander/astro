import { useState, useCallback, useEffect } from 'react'
import { Bot, Send, Trash2, User } from 'lucide-react'
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
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Comments ({comments.length})
      </h3>

      {/* Comment list */}
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading comments...</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No comments yet</p>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => (
            <div key={comment.id} className="group flex gap-2.5">
              {/* Avatar */}
              <div className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium',
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
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all ml-auto"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <p className="text-sm text-foreground mt-0.5 whitespace-pre-wrap">
                  {comment.content}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New comment input */}
      <div className="flex gap-2">
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a comment... (Cmd+Enter to submit)"
          rows={2}
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!newComment.trim() || isSubmitting}
          className="self-end"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
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

import { useEffect } from 'react'
import { Check, CheckCheck, Inbox, Trash2, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useReferenceStore } from '@/stores/reference-store'
import { Button } from '@/components/ui/button'
import type { Reference } from '@/types'

function InboxRow({ reference: r, onAccept, onReject }: {
  reference: Reference
  onAccept: () => void
  onReject: () => void
}) {
  const firstAuthor = r.authors?.[0]?.split(',')[0] ?? ''
  const authorDisplay = (r.authors?.length ?? 0) > 1 ? `${firstAuthor} et al.` : firstAuthor

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/30 group">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug line-clamp-2">{r.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {authorDisplay}{r.year ? ` · ${r.year}` : ''}{r.venue ? ` · ${r.venue}` : ''}
        </p>
        {r.sourceProjectName && (
          <span className="inline-flex items-center gap-1 mt-1 text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
            <ExternalLink className="h-2.5 w-2.5" />
            {r.sourceProjectName}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onReject}
          className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Discard"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onAccept}
          className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-green-600 hover:bg-green-500/10 transition-colors"
          title="Add to library"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

export function ReferenceInbox() {
  const { inbox, inboxLoaded, loadInbox, acceptReference, removeReference, acceptAllInbox } = useReferenceStore()

  useEffect(() => {
    if (!inboxLoaded) void loadInbox()
  }, [inboxLoaded, loadInbox])

  if (!inboxLoaded || inbox.length === 0) return null

  return (
    <div className="mb-6 border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">AI-imported references</span>
          <span className={cn(
            'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
            'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
          )}>
            {inbox.length} pending
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1.5"
          onClick={() => void acceptAllInbox()}
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Accept all
        </Button>
      </div>

      <div className="divide-y">
        {inbox.map(r => (
          <InboxRow
            key={r.id}
            reference={r}
            onAccept={() => void acceptReference(r.id)}
            onReject={() => void removeReference(r.id)}
          />
        ))}
      </div>
    </div>
  )
}

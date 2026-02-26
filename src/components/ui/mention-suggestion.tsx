import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { CheckSquare, FileCode, Folder } from 'lucide-react'
import { cn, getShortId } from '@/lib/utils'

export interface MentionSuggestionItem {
  id: string
  label: string
  type: 'task' | 'file' | 'directory'
  description?: string
}

export interface MentionSuggestionRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface MentionSuggestionProps {
  items: MentionSuggestionItem[]
  command: (item: MentionSuggestionItem) => void
}

export const MentionSuggestion = forwardRef<MentionSuggestionRef, MentionSuggestionProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          if (items[selectedIndex]) {
            command(items[selectedIndex])
          }
          return true
        }
        return false
      },
    }))

    if (items.length === 0) {
      return (
        <div className="rounded-md border border-border bg-popover p-2 shadow-lg">
          <p className="text-xs text-muted-foreground">No results</p>
        </div>
      )
    }

    // Group items by type
    const tasks = items.filter((i) => i.type === 'task')
    const files = items.filter((i) => i.type === 'file' || i.type === 'directory')

    let flatIndex = 0

    const renderItem = (item: MentionSuggestionItem) => {
      const index = flatIndex++
      const Icon = item.type === 'task' ? CheckSquare : item.type === 'directory' ? Folder : FileCode
      return (
        <button
          key={item.id}
          type="button"
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
            index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
          )}
          onClick={() => command(item)}
        >
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-left">{item.label}</span>
          {item.type === 'task' && (
            <span className="text-xs text-muted-foreground font-mono">{getShortId(item.id)}</span>
          )}
        </button>
      )
    }

    return (
      <div className="rounded-md border border-border bg-popover p-1 shadow-lg max-h-64 overflow-y-auto min-w-[200px]">
        {tasks.length > 0 && (
          <>
            <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Tasks
            </p>
            {tasks.map(renderItem)}
          </>
        )}
        {files.length > 0 && (
          <>
            {tasks.length > 0 && <div className="my-1 border-t border-border" />}
            <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Files
            </p>
            {files.map(renderItem)}
          </>
        )}
      </div>
    )
  }
)

MentionSuggestion.displayName = 'MentionSuggestion'

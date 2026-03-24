/**
 * MessageList — renders the chat message history with auto-scroll.
 *
 * Handles user messages, assistant messages, streaming state,
 * and embedded tool blocks.
 */
import { useEffect, useRef } from 'react'
import { Bot, User } from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import { timeAgo } from '@desktop/lib/utils'
import { useChatStore } from '@desktop/stores/chat-store'
import { ToolBlock } from '@desktop/components/chat/ToolBlock'
import type { ChatMessage } from '@desktop/stores/chat-store'

export function MessageList() {
  const messages = useChatStore((s) => s.messages)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamText = useChatStore((s) => s.streamText)
  const streamToolBlocks = useChatStore((s) => s.streamToolBlocks)

  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages or stream updates
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // Only auto-scroll if user is near the bottom (within 120px)
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, streamText, streamToolBlocks])

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <Bot className="w-8 h-8 mx-auto opacity-40" />
          <p className="text-sm">Start a conversation</p>
          <p className="text-xs opacity-60">Type a message below to begin</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4" data-selectable>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {/* Live streaming content */}
      {isStreaming && (streamText || streamToolBlocks.length > 0) && (
        <div className="flex gap-3">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
            <Bot className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            {streamToolBlocks.map((block) => (
              <ToolBlock key={block.id} block={block} />
            ))}
            {streamText && (
              <div className="text-sm text-foreground whitespace-pre-wrap break-words" data-selectable>
                {streamText}
                <span className="inline-block w-1.5 h-4 bg-primary/60 ml-0.5 animate-pulse" />
              </div>
            )}
            {!streamText && streamToolBlocks.length === 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Thinking...
              </div>
            )}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

// ── Message Bubble ──────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5',
          isUser ? 'bg-accent' : 'bg-primary/10',
        )}
      >
        {isUser ? (
          <User className="w-3.5 h-3.5 text-accent-foreground" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-primary" />
        )}
      </div>

      <div className={cn('flex-1 min-w-0 space-y-2', isUser && 'text-right')}>
        <div
          className={cn(
            'inline-block rounded-xl px-3.5 py-2.5 text-sm max-w-[85%]',
            isUser
              ? 'bg-primary text-primary-foreground text-left'
              : 'bg-muted text-foreground text-left',
          )}
        >
          <div className="whitespace-pre-wrap break-words" data-selectable>
            {message.content}
          </div>
        </div>

        {/* Tool blocks */}
        {message.toolBlocks && message.toolBlocks.length > 0 && (
          <div className={cn('space-y-1.5', isUser ? 'ml-auto' : '', 'max-w-[85%]')}>
            {message.toolBlocks.map((block) => (
              <ToolBlock key={block.id} block={block} />
            ))}
          </div>
        )}

        <div className="text-[10px] text-muted-foreground/60">{timeAgo(message.timestamp)}</div>
      </div>
    </div>
  )
}

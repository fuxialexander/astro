/**
 * MessageList — renders the chat message history with auto-scroll.
 *
 * Handles user messages, assistant messages, streaming state,
 * and embedded tool blocks interleaved with text in arrival order.
 * Parses ```yaml-spec fences and renders them via @json-render.
 */
import { useEffect, useRef, lazy, Suspense } from 'react'
import { Bot, User } from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import { timeAgo } from '@desktop/lib/utils'
import { useChatStore } from '@desktop/stores/chat-store'
import { ToolBlockRow } from '@desktop/components/chat/ToolBlock'
import { parseYamlSpecSegments, type Segment } from '@desktop/lib/parse-yaml-spec'
import { MarkdownRenderer } from '@desktop/components/chat/MarkdownRenderer'
import type { ChatMessage, StreamBlock } from '@desktop/stores/chat-store'

const JsonRenderView = lazy(() =>
  import('@desktop/components/chat/JsonRenderView').then((m) => ({ default: m.JsonRenderView }))
)

export function MessageList() {
  const messages = useChatStore((s) => s.messages)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamBlocks = useChatStore((s) => s.streamBlocks)

  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages or stream updates
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, streamBlocks])

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

      {/* Live streaming content — interleaved text + tools */}
      {isStreaming && streamBlocks.length > 0 && (
        <div className="flex gap-3">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
            <Bot className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            {streamBlocks.map((block, i) => (
              <StreamBlockView key={i} block={block} isLast={i === streamBlocks.length - 1} />
            ))}
          </div>
        </div>
      )}

      {/* Thinking indicator when streaming but no content yet */}
      {isStreaming && streamBlocks.length === 0 && (
        <div className="flex gap-3">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
            <Bot className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Thinking...
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

// ── Stream Block View ─────────────────────────────────────────────────

function StreamBlockView({ block, isLast }: { block: StreamBlock; isLast: boolean }) {
  if (block.kind === 'tool') {
    return <ToolBlockRow block={block.block} />
  }

  // Text block — show cursor if this is the last block
  return (
    <div className="text-sm text-foreground" data-selectable>
      <RichTextContent text={block.content} />
      {isLast && (
        <span className="inline-block w-1.5 h-4 bg-primary/60 ml-0.5 animate-pulse" />
      )}
    </div>
  )
}

// ── Rich Text Content (yaml-spec + markdown) ──────────────────────────

function RichTextContent({ text }: { text: string }) {
  if (!text.includes('```yaml-spec') && !text.includes('```component')) {
    return <MarkdownRenderer content={text} />
  }

  const segments = parseYamlSpecSegments(text)
  return (
    <>
      {segments.map((segment, i) => (
        <SegmentView key={i} segment={segment} />
      ))}
    </>
  )
}

function SegmentView({ segment }: { segment: Segment }) {
  if (segment.type === 'text') {
    return <MarkdownRenderer content={segment.content} />
  }

  return (
    <Suspense fallback={<div className="text-xs text-muted-foreground py-2">Loading component...</div>}>
      <div className="py-2">
        <JsonRenderView spec={segment.spec} componentDefs={segment.componentDefs} />
      </div>
    </Suspense>
  )
}

// ── Message Bubble ──────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  // For assistant messages, rebuild interleaved blocks from stored data.
  // Tool blocks are stored separately — interleave them before the text content
  // (matching the original streaming order as closely as possible).
  if (!isUser && message.toolBlocks && message.toolBlocks.length > 0) {
    return (
      <div className="flex gap-3">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
          <Bot className="w-3.5 h-3.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          {/* Tool blocks first (collapsed) */}
          {message.toolBlocks.map((block) => (
            <ToolBlockRow key={block.id} block={block} />
          ))}
          {/* Then text content */}
          {message.content && (
            <div
              className={cn(
                'inline-block rounded-xl px-3.5 py-2.5 text-sm max-w-[85%]',
                'bg-muted text-foreground text-left',
              )}
            >
              <div data-selectable>
                <RichTextContent text={message.content} />
              </div>
            </div>
          )}
          <div className="text-[10px] text-muted-foreground/60">{timeAgo(message.timestamp)}</div>
        </div>
      </div>
    )
  }

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
          <div data-selectable>
            <RichTextContent text={message.content} />
          </div>
        </div>

        <div className="text-[10px] text-muted-foreground/60">{timeAgo(message.timestamp)}</div>
      </div>
    </div>
  )
}

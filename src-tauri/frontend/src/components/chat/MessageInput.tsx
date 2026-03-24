/**
 * MessageInput — chat input with Cmd+Enter to send.
 */
import { useState, useRef, useEffect } from 'react'
import { Send } from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import { useChatStore } from '@desktop/stores/chat-store'

interface MessageInputProps {
  sessionId: string | null
  disabled?: boolean
}

export function MessageInput({ sessionId, disabled }: MessageInputProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const isStreaming = useChatStore((s) => s.isStreaming)

  const canSend = text.trim().length > 0 && !isStreaming && !disabled && sessionId

  const handleSend = () => {
    if (!canSend) return
    sendMessage(sessionId, text.trim())
    setText('')
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  return (
    <div className="border-t px-4 py-3 flex-shrink-0">
      <div
        className={cn(
          'flex items-end gap-2 rounded-xl border bg-card px-3 py-2',
          'focus-within:ring-1 focus-within:ring-ring transition-shadow duration-150',
        )}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isStreaming
              ? 'Waiting for response...'
              : disabled
                ? 'Select or create a chat session'
                : 'Type a message... (Cmd+Enter to send)'
          }
          disabled={isStreaming || disabled}
          rows={1}
          className={cn(
            'flex-1 resize-none bg-transparent text-sm text-foreground',
            'placeholder:text-muted-foreground/50 outline-none',
            'min-h-[24px] max-h-[160px]',
          )}
          data-selectable
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className={cn(
            'p-1.5 rounded-lg transition-colors duration-150 flex-shrink-0',
            canSend
              ? 'text-primary hover:bg-primary/10'
              : 'text-muted-foreground/30 cursor-not-allowed',
          )}
          title="Send (Cmd+Enter)"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
      <div className="text-[10px] text-muted-foreground/40 mt-1.5 text-right">
        {isStreaming ? 'Streaming...' : 'Cmd+Enter to send'}
      </div>
    </div>
  )
}

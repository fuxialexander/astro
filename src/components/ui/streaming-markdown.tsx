/**
 * StreamingMarkdown — block-memoized streaming markdown renderer.
 *
 * Uses `marked.lexer()` to split markdown into block-level tokens (headings,
 * paragraphs, code fences, lists, etc.). Each completed block is wrapped in a
 * `memo`-ized component so it never re-renders. Only the last block (the one
 * actively receiving tokens) re-renders on each update.
 *
 * Inspired by the Vercel AI SDK memoization pattern.
 */

import { memo, useMemo } from "react"
import { marked } from "marked"
import { MarkdownRenderer } from "./markdown-renderer"
import { cn } from "@/lib/utils"

interface StreamingMarkdownProps {
  content: string
  isStreaming?: boolean
  className?: string
  /** Custom handler for link clicks. Return true to prevent default navigation. */
  onLinkClick?: (href: string, e: React.MouseEvent) => boolean | void
}

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown)
  return tokens.map((token) => token.raw)
}

const MemoizedBlock = memo(
  ({ content, className, onLinkClick }: {
    content: string
    className?: string
    onLinkClick?: (href: string, e: React.MouseEvent) => boolean | void
  }) => (
    <MarkdownRenderer content={content} className={className} onLinkClick={onLinkClick} />
  ),
  (prev, next) => prev.content === next.content && prev.onLinkClick === next.onLinkClick
)
MemoizedBlock.displayName = "MemoizedBlock"

export function StreamingMarkdown({ content, isStreaming, className, onLinkClick }: StreamingMarkdownProps) {
  const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content])

  return (
    <div className={cn("streaming-markdown", className)}>
      {blocks.map((block, i) => (
        <MemoizedBlock key={i} content={block} onLinkClick={onLinkClick} />
      ))}
      {isStreaming && <span className="streaming-cursor" />}
    </div>
  )
}

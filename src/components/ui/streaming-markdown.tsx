/**
 * StreamingMarkdown — block-memoized streaming markdown renderer.
 *
 * Uses `marked.lexer()` to split markdown into block-level tokens (headings,
 * paragraphs, code fences, lists, etc.). Each completed block is wrapped in a
 * `memo`-ized component so it never re-renders. Only the last block (the one
 * actively receiving tokens) re-renders on each update.
 *
 * Visualizer code fences (```visualizer) are rendered as interactive sandboxed
 * iframes via the VisualWidget component instead of plain code blocks.
 *
 * Inspired by the Vercel AI SDK memoization pattern.
 */

import { memo, useMemo } from "react"
import { marked } from "marked"
import { MarkdownRenderer } from "./markdown-renderer"
import { VisualWidget } from "./visual-widget"
import { cn } from "@/lib/utils"
import type { Reference, CitationStyle } from "@/lib/citation/types"

interface StreamingMarkdownProps {
  content: string
  isStreaming?: boolean
  className?: string
  /** Custom handler for link clicks. Return true to prevent default navigation. */
  onLinkClick?: (href: string, e: React.MouseEvent) => boolean | void
  /** Callback when a VisualWidget iframe sends a sendPrompt message. */
  onSendPrompt?: (text: string) => void
  /** References for inline citation rendering */
  references?: Reference[]
  /** Citation formatting style */
  citationStyle?: CitationStyle
}

type ParsedBlock =
  | { type: "markdown"; content: string }
  | { type: "visualizer"; code: string }

function parseMarkdownIntoBlocks(markdown: string): ParsedBlock[] {
  const tokens = marked.lexer(markdown)
  return tokens.map((token) => {
    if (token.type === "code" && token.lang === "visualizer") {
      return { type: "visualizer" as const, code: token.text }
    }
    return { type: "markdown" as const, content: token.raw }
  })
}

const MemoizedBlock = memo(
  ({ content, className, onLinkClick, references, citationStyle }: {
    content: string
    className?: string
    onLinkClick?: (href: string, e: React.MouseEvent) => boolean | void
    references?: Reference[]
    citationStyle?: CitationStyle
  }) => (
    <MarkdownRenderer content={content} className={className} onLinkClick={onLinkClick} references={references} citationStyle={citationStyle} />
  ),
  (prev, next) => prev.content === next.content && prev.onLinkClick === next.onLinkClick && prev.references === next.references && prev.citationStyle === next.citationStyle
)
MemoizedBlock.displayName = "MemoizedBlock"

const MemoizedVisualizer = memo(
  ({ code, isStreaming, onSendPrompt }: {
    code: string
    isStreaming?: boolean
    onSendPrompt?: (text: string) => void
  }) => (
    <VisualWidget code={code} isStreaming={isStreaming} onSendPrompt={onSendPrompt} />
  ),
  (prev, next) =>
    prev.code === next.code &&
    prev.isStreaming === next.isStreaming &&
    prev.onSendPrompt === next.onSendPrompt
)
MemoizedVisualizer.displayName = "MemoizedVisualizer"

export function StreamingMarkdown({ content, isStreaming, className, onLinkClick, onSendPrompt, references, citationStyle }: StreamingMarkdownProps) {
  const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content])

  return (
    <div className={cn("streaming-markdown", className)}>
      {blocks.map((block, i) =>
        block.type === "visualizer" ? (
          <MemoizedVisualizer
            key={i}
            code={block.code}
            isStreaming={isStreaming && i === blocks.length - 1}
            onSendPrompt={onSendPrompt}
          />
        ) : (
          <MemoizedBlock key={i} content={block.content} onLinkClick={onLinkClick} references={references} citationStyle={citationStyle} />
        )
      )}
      {isStreaming && <span className="streaming-cursor" />}
    </div>
  )
}

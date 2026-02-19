import { memo, useMemo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { cn } from "@/lib/utils"

interface MarkdownRendererProps {
  content: string
  className?: string
}

export const MarkdownRenderer = memo(({ content, className }: MarkdownRendererProps) => {
  // Memoize the markdown content to avoid re-rendering
  const memoizedContent = useMemo(() => content, [content])

  // Memoize components to prevent recreation on every render
  const components = useMemo(() => ({
    // Customize code blocks for better rendering
    code: ({ className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || "")
      const isInline = !match

      if (isInline) {
        return (
          <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono" {...props}>
            {children}
          </code>
        )
      }

      return (
        <code className={cn("text-xs", className)} {...props}>
          {children}
        </code>
      )
    },
    pre: ({ children }: any) => (
      <pre className="overflow-x-auto rounded-md bg-muted p-3 my-2 text-xs font-mono">
        {children}
      </pre>
    ),
    // Customize other elements
    p: ({ children }: any) => <p className="mb-2 last:mb-0">{children}</p>,
    ul: ({ children }: any) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
    ol: ({ children }: any) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
    li: ({ children }: any) => <li className="text-sm">{children}</li>,
    h1: ({ children }: any) => <h1 className="text-lg font-bold mb-2 mt-3">{children}</h1>,
    h2: ({ children }: any) => <h2 className="text-base font-bold mb-2 mt-3">{children}</h2>,
    h3: ({ children }: any) => <h3 className="text-sm font-bold mb-1 mt-2">{children}</h3>,
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground my-2">
        {children}
      </blockquote>
    ),
    a: ({ children, href }: any) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-500 hover:underline"
      >
        {children}
      </a>
    ),
    table: ({ children }: any) => (
      <div className="overflow-x-auto my-2">
        <table className="min-w-full border-collapse border border-border">
          {children}
        </table>
      </div>
    ),
    th: ({ children }: any) => (
      <th className="border border-border px-2 py-1 bg-muted font-medium text-left text-xs">
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className="border border-border px-2 py-1 text-xs">
        {children}
      </td>
    ),
  }), [])

  return (
    <div className={cn("markdown-content", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {memoizedContent}
      </ReactMarkdown>
    </div>
  )
})

MarkdownRenderer.displayName = "MarkdownRenderer"

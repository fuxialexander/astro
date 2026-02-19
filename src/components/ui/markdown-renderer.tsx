import { memo, useMemo, type ReactNode, type HTMLAttributes } from "react"
import ReactMarkdown, { type ExtraProps } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { cn } from "@/lib/utils"

interface MarkdownRendererProps {
  content: string
  className?: string
}

type ElProps = HTMLAttributes<HTMLElement> & ExtraProps & { children?: ReactNode }

export const MarkdownRenderer = memo(({ content, className }: MarkdownRendererProps) => {
  const memoizedContent = useMemo(() => content, [content])

  const components = useMemo(() => ({
    code: ({ className, children, ...props }: ElProps) => {
      const match = /language-(\w+)/.exec((className as string) || "")
      const isInline = !match

      if (isInline) {
        return (
          <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono" {...props}>
            {children}
          </code>
        )
      }

      return (
        <code className={cn("text-xs", className as string)} {...props}>
          {children}
        </code>
      )
    },
    pre: ({ children }: ElProps) => (
      <pre className="overflow-x-auto rounded-md bg-muted p-3 my-2 text-xs font-mono">
        {children}
      </pre>
    ),
    p: ({ children }: ElProps) => <p className="mb-2 last:mb-0">{children}</p>,
    ul: ({ children }: ElProps) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
    ol: ({ children }: ElProps) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
    li: ({ children }: ElProps) => <li className="text-sm">{children}</li>,
    h1: ({ children }: ElProps) => <h1 className="text-lg font-bold mb-2 mt-3">{children}</h1>,
    h2: ({ children }: ElProps) => <h2 className="text-base font-bold mb-2 mt-3">{children}</h2>,
    h3: ({ children }: ElProps) => <h3 className="text-sm font-bold mb-1 mt-2">{children}</h3>,
    blockquote: ({ children }: ElProps) => (
      <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground my-2">
        {children}
      </blockquote>
    ),
    a: ({ children, href }: ElProps & { href?: string }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-500 hover:underline"
      >
        {children}
      </a>
    ),
    table: ({ children }: ElProps) => (
      <div className="overflow-x-auto my-2">
        <table className="min-w-full border-collapse border border-border">
          {children}
        </table>
      </div>
    ),
    th: ({ children }: ElProps) => (
      <th className="border border-border px-2 py-1 bg-muted font-medium text-left text-xs">
        {children}
      </th>
    ),
    td: ({ children }: ElProps) => (
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

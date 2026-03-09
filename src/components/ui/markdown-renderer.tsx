import { memo, useState, useCallback, useMemo, type ReactNode, type HTMLAttributes } from "react"
import ReactMarkdown, { type ExtraProps } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeHighlight from "rehype-highlight"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import { cn } from "@/lib/utils"
import { Copy, Check } from "lucide-react"

interface MarkdownRendererProps {
  content: string
  className?: string
  /** Custom handler for link clicks. Return true to prevent default navigation. */
  onLinkClick?: (href: string, e: React.MouseEvent) => boolean | void
}

type ElProps = HTMLAttributes<HTMLElement> & ExtraProps & { children?: ReactNode }

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => { /* clipboard API unavailable */ })
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1 rounded-md bg-muted-foreground/10 hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground transition-opacity opacity-0 group-hover/code:opacity-100 cursor-pointer"
      title="Copy code"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

/** Extract plain text from React children (strips JSX wrappers from rehype-highlight spans) */
function extractText(node: ReactNode): string {
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractText).join("")
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children)
  }
  return ""
}

export const MarkdownRenderer = memo(({ content, className, onLinkClick }: MarkdownRendererProps) => {
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
    pre: ({ children }: ElProps) => {
      const codeText = extractText(children)
      return (
        <pre className="group/code relative overflow-x-auto rounded-md bg-muted p-3 my-2 text-xs font-mono">
          {children}
          <CopyButton text={codeText} />
        </pre>
      )
    },
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
    a: ({ children, href }: ElProps & { href?: string }) => {
      const isCustom = href?.startsWith("astro:")
      return (
        <a
          href={isCustom ? undefined : href}
          target={isCustom ? undefined : "_blank"}
          rel={isCustom ? undefined : "noopener noreferrer"}
          className={cn("hover:underline cursor-pointer", isCustom ? "text-primary font-medium" : "text-info")}
          onClick={(e) => {
            if (href && onLinkClick?.(href, e)) {
              e.preventDefault()
            }
          }}
        >
          {children}
        </a>
      )
    },
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
  }), [onLinkClick])

  return (
    <div className={cn("markdown-content", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={components}
      >
        {memoizedContent}
      </ReactMarkdown>
    </div>
  )
})

MarkdownRenderer.displayName = "MarkdownRenderer"

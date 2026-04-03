/**
 * MarkdownRenderer — lightweight markdown rendering for chat messages.
 *
 * Supports GFM (tables, strikethrough, task lists) + code blocks with copy button.
 */
import { memo, useState, useCallback, useMemo, type ReactNode, type HTMLAttributes } from 'react'
import ReactMarkdown, { type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@desktop/lib/utils'
import { Copy, Check } from 'lucide-react'

interface MarkdownRendererProps {
  content: string
  className?: string
}

type ElProps = HTMLAttributes<HTMLElement> & ExtraProps & { children?: ReactNode }

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
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

export const MarkdownRenderer = memo(({ content, className }: MarkdownRendererProps) => {
  const components = useMemo(() => ({
    code: ({ className: codeCls, children, ...props }: ElProps) => {
      const match = /language-(\w+)/.exec((codeCls as string) || '')
      const isInline = !match

      if (isInline) {
        return (
          <code className="px-1 py-0.5 rounded bg-muted font-mono text-[0.85em]" {...props}>
            {children}
          </code>
        )
      }

      const codeText = extractText(children)
      return (
        <div className="relative group/code my-2">
          <pre className="rounded-md bg-muted p-3 overflow-x-auto text-[11px] leading-5">
            <code className={cn('font-mono', codeCls)} {...props}>
              {children}
            </code>
          </pre>
          <CopyButton text={codeText} />
        </div>
      )
    },

    pre: ({ children }: ElProps) => <>{children}</>,

    p: ({ children }: ElProps) => <p className="mb-2 last:mb-0">{children}</p>,

    strong: ({ children }: ElProps) => <strong className="font-semibold">{children}</strong>,

    em: ({ children }: ElProps) => <em className="italic">{children}</em>,

    a: ({ href, children }: ElProps & { href?: string }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:text-primary/80"
      >
        {children}
      </a>
    ),

    ul: ({ children }: ElProps) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
    ol: ({ children }: ElProps) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
    li: ({ children }: ElProps) => <li>{children}</li>,

    h1: ({ children }: ElProps) => <h1 className="text-base font-bold mb-2 mt-3">{children}</h1>,
    h2: ({ children }: ElProps) => <h2 className="text-sm font-bold mb-1.5 mt-2.5">{children}</h2>,
    h3: ({ children }: ElProps) => <h3 className="text-sm font-semibold mb-1 mt-2">{children}</h3>,

    blockquote: ({ children }: ElProps) => (
      <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground my-2">
        {children}
      </blockquote>
    ),

    hr: () => <hr className="border-border my-3" />,

    table: ({ children }: ElProps) => (
      <div className="rounded-md border overflow-hidden my-2">
        <table className="w-full text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }: ElProps) => <thead className="bg-muted/50">{children}</thead>,
    tbody: ({ children }: ElProps) => <tbody>{children}</tbody>,
    tr: ({ children }: ElProps) => <tr className="border-b last:border-0">{children}</tr>,
    th: ({ children }: ElProps) => <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">{children}</th>,
    td: ({ children }: ElProps) => <td className="px-3 py-1.5">{children}</td>,
  }), [])

  return (
    <div className={cn('text-sm prose-compact', className)} data-selectable>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
})

MarkdownRenderer.displayName = 'MarkdownRenderer'

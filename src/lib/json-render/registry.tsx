import { useState } from 'react'
import { defineRegistry } from '@json-render/react'
import { astroCatalog } from './catalog'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, ArrowRight } from 'lucide-react'

const gapMap = { sm: 'gap-1', md: 'gap-3', lg: 'gap-5' } as const
const alignMap = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' } as const

export const { registry, handlers } = defineRegistry(astroCatalog, {
  components: {
    // ── Layout ──────────────────────────────────────────────────────
    Card: ({ props, children }) => (
      <Card>
        {(props.title || props.description) && (
          <CardHeader className="pb-2">
            {props.title && <CardTitle className="text-sm">{props.title}</CardTitle>}
            {props.description && <CardDescription className="text-xs">{props.description}</CardDescription>}
          </CardHeader>
        )}
        <CardContent className="pt-0">{children}</CardContent>
      </Card>
    ),

    Stack: ({ props, children }) => (
      <div className={cn(
        'flex',
        props.direction === 'horizontal' ? 'flex-row' : 'flex-col',
        props.wrap && 'flex-wrap',
        gapMap[props.gap || 'md'],
        alignMap[props.align || 'stretch'],
      )}>
        {children}
      </div>
    ),

    Separator: () => <Separator className="my-2" />,

    // ── Content ─────────────────────────────────────────────────────
    Text: ({ props }) => (
      <MarkdownRenderer content={props.content} className="text-sm" />
    ),

    Heading: ({ props }) => {
      const level = props.level || '2'
      const classes: Record<string, string> = {
        '1': 'text-lg font-bold',
        '2': 'text-base font-semibold',
        '3': 'text-sm font-semibold',
        '4': 'text-sm font-medium text-muted-foreground',
      }
      const Tag = `h${level}` as const
      return <Tag className={classes[level]}>{props.text}</Tag>
    },

    Badge: ({ props }) => (
      <Badge variant={props.variant}>{props.label}</Badge>
    ),

    Alert: ({ props }) => (
      <Alert variant={props.variant}>
        {props.title && <AlertTitle>{props.title}</AlertTitle>}
        <AlertDescription>{props.message}</AlertDescription>
      </Alert>
    ),

    Table: ({ props }) => (
      <div className="overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          {props.caption && (
            <caption className="px-3 py-1.5 text-xs text-muted-foreground text-left">
              {props.caption}
            </caption>
          )}
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {props.headers.map((h, i) => (
                <th key={i} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row, ri) => (
              <tr key={ri} className="border-b border-border/50 last:border-0">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-xs">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),

    List: ({ props }) => {
      const Tag = props.ordered ? 'ol' : 'ul'
      return (
        <Tag className={cn('text-sm pl-5', props.ordered ? 'list-decimal' : 'list-disc')}>
          {props.items.map((item, i) => (
            <li key={i} className="py-0.5">{item}</li>
          ))}
        </Tag>
      )
    },

    KeyValue: ({ props }) => (
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        {props.pairs.map((pair, i) => (
          <div key={i} className="contents">
            <dt className="font-medium text-muted-foreground whitespace-nowrap">{pair.key}</dt>
            <dd className="text-foreground break-all">{pair.value}</dd>
          </div>
        ))}
      </div>
    ),

    CodeBlock: ({ props }) => (
      <div className="rounded-lg border border-border overflow-hidden">
        {props.title && (
          <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground bg-muted/50 border-b border-border">
            {props.title}
          </div>
        )}
        <pre className="px-3 py-2 text-xs font-mono overflow-auto bg-muted/30">
          <code>{props.code}</code>
        </pre>
      </div>
    ),

    // ── Interactive ─────────────────────────────────────────────────
    OptionCard: ({ props, emit }) => (
      <button
        onClick={() => emit('press')}
        className={cn(
          'w-full text-left rounded-xl border px-4 py-3 transition-all',
          'hover:border-primary/50 hover:bg-primary/5',
          'flex items-center justify-between gap-3',
          props.selected && 'border-primary bg-primary/5 ring-1 ring-primary/20',
          props.dimmed && 'opacity-40 pointer-events-none',
          !props.selected && !props.dimmed && 'border-border',
        )}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{props.title}</p>
          {props.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{props.description}</p>
          )}
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    ),

    Timeline: ({ props }) => (
      <div className="relative pl-6">
        <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border" />
        <div className="flex flex-col gap-4">
          {props.entries.map((entry, i) => (
            <div key={i} className="relative flex gap-3">
              <div className="absolute left-[-18px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary border-2 border-background" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-primary">{entry.label}</p>
                <p className="text-sm font-semibold text-foreground">{entry.title}</p>
                {entry.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{entry.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),

    Accordion: ({ props }) => {
      const [openItems, setOpenItems] = useState<Set<number>>(new Set())
      const isSingle = props.type !== 'multiple'

      const toggle = (index: number) => {
        setOpenItems(prev => {
          const next = new Set(isSingle ? [] : prev)
          if (prev.has(index)) {
            next.delete(index)
          } else {
            next.add(index)
          }
          return next
        })
      }

      return (
        <div className="rounded-lg border border-border divide-y divide-border">
          {props.items.map((item, i) => {
            const isOpen = openItems.has(i)
            return (
              <div key={i}>
                <button
                  onClick={() => toggle(i)}
                  className="flex items-center justify-between w-full px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                >
                  <span className="text-sm font-medium">{item.title}</span>
                  {isOpen
                    ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  }
                </button>
                {isOpen && (
                  <div className="px-3 pb-3">
                    <MarkdownRenderer content={item.content} className="text-xs" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )
    },

    TabView: ({ props, children }) => (
      <Tabs defaultValue={props.defaultTab || props.tabs[0]?.value}>
        <TabsList>
          {props.tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {props.tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {children}
          </TabsContent>
        ))}
      </Tabs>
    ),

    // ── Feedback ────────────────────────────────────────────────────
    Progress: ({ props }) => (
      <div className="flex flex-col gap-1">
        {props.label && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{props.label}</span>
            <span className="font-medium">{props.value}%</span>
          </div>
        )}
        <Progress value={props.value} />
      </div>
    ),

    // ── Input ───────────────────────────────────────────────────────
    Button: ({ props, emit }) => (
      <Button
        variant={props.variant}
        size={props.size}
        onClick={() => emit('press')}
      >
        {props.label}
      </Button>
    ),
  },

  actions: {
    copy_to_clipboard: async (params) => {
      if (params?.text) {
        await navigator.clipboard.writeText(params.text)
      }
    },
    navigate_to_node: async (params) => {
      if (params?.nodeId) {
        window.dispatchEvent(new CustomEvent('astro:navigate-to-node', { detail: { nodeId: params.nodeId } }))
      }
    },
    send_chat_message: async (params) => {
      if (params?.message) {
        window.dispatchEvent(new CustomEvent('astro:send-chat-message', { detail: { message: params.message } }))
      }
    },
  },
})

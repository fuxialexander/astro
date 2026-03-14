import { defineRegistry } from '@json-render/react'
import { astroCatalog } from './catalog'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { cn } from '@/lib/utils'

const gapMap = { sm: 'gap-1', md: 'gap-3', lg: 'gap-5' } as const
const alignMap = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' } as const

export const { registry, handlers } = defineRegistry(astroCatalog, {
  components: {
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

    Button: ({ props, emit }) => (
      <Button
        variant={props.variant}
        size={props.size}
        onClick={() => emit('press')}
      >
        {props.label}
      </Button>
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

    Separator: () => <Separator className="my-2" />,

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

    Stack: ({ props, children }) => (
      <div className={cn(
        'flex',
        props.direction === 'horizontal' ? 'flex-row' : 'flex-col',
        gapMap[props.gap || 'md'],
        alignMap[props.align || 'stretch'],
      )}>
        {children}
      </div>
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
        const event = new CustomEvent('astro:navigate-to-node', { detail: { nodeId: params.nodeId } })
        window.dispatchEvent(event)
      }
    },
  },
})

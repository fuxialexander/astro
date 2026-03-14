import { useState, useRef, useCallback, useEffect } from 'react'
import { defineRegistry } from '@json-render/react'
import { astroCatalog } from './catalog'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, ArrowRight, ArrowUpRight, ArrowDownRight, Minus, Check, ChevronLeft } from 'lucide-react'

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

    TodoList: ({ props }) => {
      const [checked, setChecked] = useState<Set<string>>(() => {
        const initial = new Set<string>()
        for (const item of props.items) {
          if (item.status === 'completed') initial.add(item.id)
        }
        return initial
      })

      const toggle = (item: { id: string; content: string }) => {
        setChecked(prev => {
          const next = new Set(prev)
          if (next.has(item.id)) {
            next.delete(item.id)
          } else {
            next.add(item.id)
            window.dispatchEvent(new CustomEvent('astro:send-chat-message', {
              detail: { message: `Completed: ${item.content}` }
            }))
          }
          return next
        })
      }

      const priorityColors: Record<string, string> = {
        high: 'text-error',
        medium: 'text-warning',
        low: 'text-muted-foreground',
      }

      return (
        <div className="rounded-lg border border-border">
          {props.title && (
            <div className="px-3 py-2 border-b border-border bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground">{props.title}</p>
            </div>
          )}
          <div className="divide-y divide-border/50">
            {props.items.map((item) => {
              const done = checked.has(item.id)
              return (
                <label
                  key={item.id}
                  className={cn(
                    'flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors',
                    done && 'opacity-50',
                  )}
                >
                  <Checkbox
                    checked={done}
                    onCheckedChange={() => toggle(item)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <span className={cn('text-sm', done && 'line-through text-muted-foreground')}>
                      {item.content}
                    </span>
                    {item.priority && (
                      <span className={cn('ml-2 text-[10px] font-medium', priorityColors[item.priority])}>
                        {item.priority}
                      </span>
                    )}
                  </div>
                  {done && <Check className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />}
                </label>
              )
            })}
          </div>
        </div>
      )
    },

    CardCarousel: ({ props }) => {
      const [activeIndex, setActiveIndex] = useState(0)
      const containerRef = useRef<HTMLDivElement>(null)
      const scrollAccum = useRef(0)
      const scrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
      const count = props.cards.length

      const goTo = useCallback((index: number) => {
        setActiveIndex(Math.max(0, Math.min(count - 1, index)))
      }, [count])

      // Smooth scroll accumulator for touchpad — accumulates small deltas
      useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const handler = (e: WheelEvent) => {
          e.preventDefault()
          const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
          scrollAccum.current += delta

          if (scrollTimeout.current) clearTimeout(scrollTimeout.current)
          scrollTimeout.current = setTimeout(() => {
            scrollAccum.current = 0
          }, 200)

          const threshold = 50
          if (scrollAccum.current > threshold) {
            scrollAccum.current = 0
            goTo(activeIndex + 1)
          } else if (scrollAccum.current < -threshold) {
            scrollAccum.current = 0
            goTo(activeIndex - 1)
          }
        }
        el.addEventListener('wheel', handler, { passive: false })
        return () => el.removeEventListener('wheel', handler)
      }, [activeIndex, goTo])

      // Keyboard navigation
      useEffect(() => {
        const handler = (e: KeyboardEvent) => {
          if (e.key === 'ArrowRight') goTo(activeIndex + 1)
          else if (e.key === 'ArrowLeft') goTo(activeIndex - 1)
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
      }, [activeIndex, goTo])

      return (
        <div ref={containerRef} className="relative select-none" style={{ perspective: '1000px' }}>
          <div className="relative h-[260px] flex items-center justify-center overflow-hidden py-4">
            {props.cards.map((card, i) => {
              const offset = i - activeIndex
              const absOffset = Math.abs(offset)
              const isActive = i === activeIndex
              const zIndex = count - absOffset
              const translateX = offset * 140
              const translateZ = isActive ? 40 : -60 * absOffset
              const rotateY = offset < 0 ? 40 : offset > 0 ? -40 : 0
              const scale = isActive ? 1.05 : 0.8

              return (
                <div
                  key={i}
                  onClick={() => goTo(i)}
                  className="absolute w-[300px] cursor-pointer"
                  style={{
                    transform: `translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`,
                    zIndex,
                    transformStyle: 'preserve-3d',
                    transition: 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.4s ease',
                    opacity: absOffset > 2 ? 0 : 1,
                  }}
                >
                  <Card className={cn(
                    'overflow-hidden h-[220px] flex flex-col relative',
                    isActive
                      ? 'shadow-2xl ring-1 ring-primary/30'
                      : 'shadow-sm',
                  )}>
                    {/* White/black overlay on non-active cards */}
                    {!isActive && (
                      <div
                        className="absolute inset-0 z-10 pointer-events-none bg-background/70"
                        style={{ transition: 'opacity 0.4s ease' }}
                      />
                    )}
                    <CardHeader className="pb-2 shrink-0">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-sm truncate">{card.title}</CardTitle>
                        {card.badge && (
                          <Badge variant={(card.badgeVariant as 'default') || 'default'} className="shrink-0">{card.badge}</Badge>
                        )}
                      </div>
                      {card.description && (
                        <CardDescription className="text-xs line-clamp-2">{card.description}</CardDescription>
                      )}
                    </CardHeader>
                    {card.content && (
                      <CardContent className="pt-0 flex-1 overflow-hidden">
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-6">{card.content}</p>
                      </CardContent>
                    )}
                  </Card>
                </div>
              )
            })}
          </div>

          {/* Navigation arrows */}
          {activeIndex > 0 && (
            <button
              onClick={() => goTo(activeIndex - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/80 backdrop-blur border border-border flex items-center justify-center hover:bg-muted transition-colors z-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {activeIndex < count - 1 && (
            <button
              onClick={() => goTo(activeIndex + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/80 backdrop-blur border border-border flex items-center justify-center hover:bg-muted transition-colors z-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          {/* Dot indicators */}
          <div className="flex justify-center gap-1.5 mt-2">
            {props.cards.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  i === activeIndex ? 'w-4 bg-primary' : 'w-1.5 bg-border hover:bg-muted-foreground/50',
                )}
              />
            ))}
          </div>
        </div>
      )
    },

    Metric: ({ props }) => {
      const trendIcon = props.trend === 'up'
        ? <ArrowUpRight className="h-3.5 w-3.5 text-success" />
        : props.trend === 'down'
        ? <ArrowDownRight className="h-3.5 w-3.5 text-error" />
        : props.trend === 'stable'
        ? <Minus className="h-3.5 w-3.5 text-muted-foreground" />
        : null

      return (
        <div className="flex flex-col gap-0.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{props.label}</p>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold text-foreground tabular-nums">{props.value}</p>
            {trendIcon && (
              <div className="flex items-center gap-0.5">
                {trendIcon}
                {props.trendLabel && <span className="text-[10px] text-muted-foreground">{props.trendLabel}</span>}
              </div>
            )}
          </div>
          {props.description && <p className="text-xs text-muted-foreground">{props.description}</p>}
        </div>
      )
    },

    StepIndicator: ({ props }) => (
      <div className="flex items-center gap-0">
        {props.steps.map((step, i) => {
          const isComplete = i < props.current
          const isCurrent = i === props.current
          return (
            <div key={i} className="flex items-center">
              {i > 0 && (
                <div className={cn(
                  'h-px w-8 mx-1',
                  isComplete ? 'bg-primary' : 'bg-border',
                )} />
              )}
              <div className="flex items-center gap-1.5">
                <div className={cn(
                  'h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-medium transition-colors',
                  isComplete && 'bg-primary text-primary-foreground',
                  isCurrent && 'bg-primary/10 text-primary ring-2 ring-primary',
                  !isComplete && !isCurrent && 'bg-muted text-muted-foreground',
                )}>
                  {isComplete ? <Check className="h-3 w-3" /> : i + 1}
                </div>
                <span className={cn(
                  'text-xs whitespace-nowrap',
                  isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}>
                  {step}
                </span>
              </div>
            </div>
          )
        })}
      </div>
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

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
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
import { ChevronDown, ChevronRight, ArrowRight, ArrowUpRight, ArrowDownRight, Minus, Check, ChevronLeft, Diamond } from 'lucide-react'
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Handle,
  Position,
  type Node,
  type Edge,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import { STATUS_DOT_COLOR, PRIORITY_PIP_COLOR, GRAPH_EDGE_COLOR, getMilestoneColor, type MilestoneColor } from '@/components/plan-graph/plan-node-shared'
import { computeRedundantEdgeIds } from '@/lib/graph-utils'

const gapMap = { sm: 'gap-1', md: 'gap-3', lg: 'gap-5' } as const
const alignMap = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' } as const

// ── PlanGraph helpers ──────────────────────────────────────────────

type PlanNodeInput = {
  id: string
  title: string
  type: string
  status: string
  description?: string | null
  estimate?: string | null
  priority?: string | null
  dueDate?: string | null
  milestoneId?: string | null
  dependencies?: string[]
  createdAt?: string | Date | null
  number?: number | null
}


const PLAN_GRAPH_NODE_WIDTH = 164
const PLAN_GRAPH_NODE_HEIGHT = 56
const PLAN_GRAPH_MILESTONE_WIDTH = 200
const PLAN_GRAPH_MILESTONE_HEIGHT = 40

// GRAPH_EDGE_COLOR imported from plan-node-shared as GRAPH_GRAPH_EDGE_COLOR

const MILESTONE_ROW_Y = 0
const TASK_ROW_OFFSET_Y = PLAN_GRAPH_MILESTONE_HEIGHT + 48 // tasks start below milestone strip

function buildDagreLayout(
  nodes: PlanNodeInput[],
): { rfNodes: Node<{ node: PlanNodeInput; milestoneColor: MilestoneColor | null }>[]; rfEdges: Edge[] } {

  // Assign milestone colors first
  const orderedMilestoneIds = nodes
    .filter(n => n.type === 'milestone')
    .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())
    .map(n => n.id)
  const milestoneColorMap = new Map<string, MilestoneColor>()
  for (const id of orderedMilestoneIds) {
    const color = getMilestoneColor(id, orderedMilestoneIds)
    if (color) milestoneColorMap.set(id, color)
  }

  // Run dagre on TASKS only (milestones are placed separately above)
  const tasks = nodes.filter(n => n.type !== 'milestone')
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 56, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of tasks) {
    g.setNode(n.id, { width: PLAN_GRAPH_NODE_WIDTH, height: PLAN_GRAPH_NODE_HEIGHT })
  }
  for (const n of tasks) {
    for (const dep of n.dependencies ?? []) {
      if (g.hasNode(dep)) g.setEdge(dep, n.id)
    }
  }
  dagre.layout(g)

  // Build task position map
  const taskPos = new Map<string, { x: number; y: number }>()
  for (const n of tasks) {
    const pos = g.node(n.id)
    taskPos.set(n.id, { x: pos.x - PLAN_GRAPH_NODE_WIDTH / 2, y: pos.y - PLAN_GRAPH_NODE_HEIGHT / 2 + TASK_ROW_OFFSET_Y })
  }

  // Position milestones: centered over their tasks' x-midpoint, in a row at the top
  const milestoneXMap = new Map<string, number>()
  const milestones = nodes.filter(n => n.type === 'milestone')
  for (const ms of milestones) {
    const memberTasks = tasks.filter(t => t.milestoneId === ms.id)
    if (memberTasks.length > 0) {
      const xValues = memberTasks.map(t => {
        const p = taskPos.get(t.id)!
        return p.x + PLAN_GRAPH_NODE_WIDTH / 2
      })
      const cx = xValues.reduce((a, b) => a + b, 0) / xValues.length
      milestoneXMap.set(ms.id, cx - PLAN_GRAPH_MILESTONE_WIDTH / 2)
    }
  }
  // Milestones without tasks: space them at the end
  let fallbackX = 0
  for (const ms of milestones) {
    if (!milestoneXMap.has(ms.id)) {
      milestoneXMap.set(ms.id, fallbackX)
      fallbackX += PLAN_GRAPH_MILESTONE_WIDTH + 24
    }
  }

  // Build RF nodes
  const rfNodes = nodes.map(n => {
    const isMilestone = n.type === 'milestone'
    const milestoneColor = isMilestone
      ? milestoneColorMap.get(n.id) ?? null
      : (n.milestoneId ? milestoneColorMap.get(n.milestoneId) ?? null : null)

    const position = isMilestone
      ? { x: milestoneXMap.get(n.id) ?? 0, y: MILESTONE_ROW_Y }
      : taskPos.get(n.id) ?? { x: 0, y: TASK_ROW_OFFSET_Y }

    return {
      id: n.id,
      type: isMilestone ? 'planMilestone' : 'planTask',
      position,
      data: { node: n, milestoneColor },
    }
  })

  // Dependency edges between tasks — apply transitive reduction to avoid
  // long edges visually crossing through intermediate nodes
  const allTaskEdgeDefs = tasks.flatMap(n =>
    (n.dependencies ?? [])
      .filter(dep => tasks.some(x => x.id === dep))
      .map(dep => ({ id: `e-${dep}-${n.id}`, source: dep, target: n.id }))
  )
  const redundantTaskEdgeIds = computeRedundantEdgeIds(allTaskEdgeDefs)
  const taskEdges: Edge[] = allTaskEdgeDefs
    .filter(e => !redundantTaskEdgeIds.has(e.id))
    .map(e => ({
      ...e,
      type: 'default',
      animated: tasks.find(x => x.id === e.source)?.status === 'in_progress',
      style: { stroke: GRAPH_EDGE_COLOR, strokeWidth: 1.5, opacity: 0.7 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: GRAPH_EDGE_COLOR },
    }))

  // Dependency edges between milestones (left→right in the top row)
  const milestoneEdges: Edge[] = milestones.flatMap(ms =>
    (ms.dependencies ?? [])
      .filter(dep => milestones.some(x => x.id === dep))
      .map(dep => ({
        id: `e-${dep}-${ms.id}`,
        source: dep,
        target: ms.id,
        type: 'default',
        animated: milestones.find(x => x.id === dep)?.status === 'in_progress',
        style: { stroke: GRAPH_EDGE_COLOR, strokeWidth: 1.5, opacity: 0.7 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: GRAPH_EDGE_COLOR },
      }))
  )

  return { rfNodes, rfEdges: [...milestoneEdges, ...taskEdges] }
}

// MILESTONE_PALETTE, STATUS_DOT_COLOR, PRIORITY_PIP_COLOR, GRAPH_EDGE_COLOR imported from plan-node-shared

type PlanNodeRFData = {
  node: PlanNodeInput
  milestoneColor: MilestoneColor | null
}

// eslint-disable-next-line react-refresh/only-export-components
function PlanTaskNode({ data }: { data: PlanNodeRFData }) {
  const n = data.node
  const mc = data.milestoneColor
  const isPruned = n.status === 'pruned'
  const isInProgress = n.status === 'in_progress'
  const statusDot = STATUS_DOT_COLOR[n.status] ?? '#94a3b8'
  const priorityColor = n.priority ? PRIORITY_PIP_COLOR[n.priority] : null

  return (
    <div
      className={cn(
        'relative rounded-md border bg-card shadow-sm overflow-hidden select-none',
        isPruned && 'opacity-40',
      )}
      style={{
        width: PLAN_GRAPH_NODE_WIDTH,
        minHeight: PLAN_GRAPH_NODE_HEIGHT,
        borderColor: mc ? mc.border + '60' : '#e2e8f0',
        backgroundColor: mc ? mc.bg : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: GRAPH_EDGE_COLOR, width: 6, height: 6 }} />
      <Handle type="source" position={Position.Right} style={{ background: GRAPH_EDGE_COLOR, width: 6, height: 6 }} />
      <div className="px-2.5 py-1.5 flex flex-col gap-1">
        <span className={cn(
          'text-[11px] font-medium leading-tight line-clamp-2 text-foreground/90',
          isPruned && 'line-through text-muted-foreground',
        )}>
          {n.title}
        </span>
        {/* Status dot + estimate row */}
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: statusDot }} />
          {n.estimate && (
            <span className="text-[9px] font-mono bg-black/5 dark:bg-white/10 rounded px-1 text-muted-foreground">
              {n.estimate}
            </span>
          )}
          {priorityColor && (
            <span className="h-1.5 w-1.5 rounded-full shrink-0 ml-auto" style={{ background: priorityColor }} />
          )}
        </div>
      </div>
      {isInProgress && (
        <div className="absolute inset-0 rounded-md ring-1 ring-inset pointer-events-none" style={{ borderColor: mc?.stripe ?? '#60a5fa', opacity: 0.4 }} />
      )}
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function PlanMilestoneNode({ data }: { data: PlanNodeRFData }) {
  const n = data.node
  const mc = data.milestoneColor

  return (
    <div
      className="relative rounded-lg shadow-sm overflow-hidden select-none flex items-center gap-2 px-3 py-2 border-2"
      style={{
        width: PLAN_GRAPH_MILESTONE_WIDTH,
        minHeight: PLAN_GRAPH_MILESTONE_HEIGHT,
        borderColor: mc?.border ?? '#f59e0b',
        backgroundColor: mc?.bg ?? 'rgba(245,158,11,0.08)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 6, height: 6 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 6, height: 6 }} />
      <Diamond className="h-3.5 w-3.5 shrink-0" style={{ color: mc?.text ?? '#b45309' }} />
      <span className="text-[11px] font-bold tracking-tight truncate flex-1" style={{ color: mc?.text ?? '#b45309' }}>
        {n.title}
      </span>
    </div>
  )
}

const planNodeTypes = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  planTask: PlanTaskNode as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  planMilestone: PlanMilestoneNode as any,
}

// eslint-disable-next-line react-refresh/only-export-components
function PlanGraphInner({ nodes: inputNodes }: { nodes: PlanNodeInput[] }) {
  const { fitView } = useReactFlow()
  const { rfNodes: initialNodes, rfEdges: initialEdges } = useMemo(
    () => buildDagreLayout(inputNodes),
    [inputNodes],
  )
  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    const timer = setTimeout(() => fitView({ padding: 0.12 }), 50)
    return () => clearTimeout(timer)
  }, [fitView])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={planNodeTypes}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag={true}
      zoomOnScroll={true}
      zoomOnPinch={true}
      proOptions={{ hideAttribution: true }}
      style={{ background: 'transparent' }}
    />
  )
}

export const { registry, handlers } = defineRegistry(astroCatalog, {
  components: {
    // ── Layout ──────────────────────────────────────────────────────
    Card: ({ props, children }) => {
      const hasChildren = Array.isArray(children) ? children.some(Boolean) : !!children
      return (
        <Card>
          {(props.title || props.description) && (
            <CardHeader className="pb-2">
              {props.title && <CardTitle className="text-sm">{props.title}</CardTitle>}
              {props.description && <CardDescription className="text-xs">{props.description}</CardDescription>}
            </CardHeader>
          )}
          <CardContent className="pt-0">
            {children}
            {/* Render props.content as body text when provided (agents often use this instead of children) */}
            {props.content && !hasChildren && (
              <p className="text-sm text-muted-foreground">{props.content}</p>
            )}
          </CardContent>
        </Card>
      )
    },

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

    Table: ({ props }) => {
      const headers = props.headers ?? []
      const rows = props.rows ?? []
      if (headers.length === 0) return null
      return (
      <div className="overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          {props.caption && (
            <caption className="px-3 py-1.5 text-xs text-muted-foreground text-left">
              {props.caption}
            </caption>
          )}
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {headers.map((h, i) => (
                <th key={i} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-b border-border/50 last:border-0">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-xs">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )
    },

    List: ({ props }) => {
      const items = props.items ?? []
      if (items.length === 0) return null
      const Tag = props.ordered ? 'ol' : 'ul'
      return (
        <Tag className={cn('text-sm pl-5', props.ordered ? 'list-decimal' : 'list-disc')}>
          {items.map((item, i) => (
            <li key={i} className="py-0.5">{item}</li>
          ))}
        </Tag>
      )
    },

    KeyValue: ({ props }) => {
      const pairs = props.pairs ?? props.items ?? []
      if (pairs.length === 0) return null
      return (
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        {pairs.map((pair, i) => (
          <div key={i} className="contents">
            <dt className="font-medium text-muted-foreground whitespace-nowrap">{pair.key}</dt>
            <dd className="text-foreground break-all">{pair.value}</dd>
          </div>
        ))}
      </div>
      )
    },

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

    Timeline: ({ props }) => {
      const entries = props.entries ?? []
      if (entries.length === 0) return null
      return (
      <div className="relative pl-6">
        <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border" />
        <div className="flex flex-col gap-4">
          {entries.map((entry, i) => (
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
      )
    },

    Accordion: ({ props }) => {
      const items = props.items ?? []
      const [openItems, setOpenItems] = useState<Set<number>>(new Set())
      const isSingle = props.type !== 'multiple'
      if (items.length === 0) return null

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
          {items.map((item, i) => {
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

    TabView: ({ props, children }) => {
      const tabs = props.tabs ?? []
      if (tabs.length === 0) return null
      return (
      <Tabs defaultValue={props.defaultTab || tabs[0]?.value}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {children}
          </TabsContent>
        ))}
      </Tabs>
      )
    },

    TodoList: ({ props }) => {
      const todoItems = props.items ?? []
      const [checked, setChecked] = useState<Set<string>>(() => {
        const initial = new Set<string>()
        for (const item of todoItems) {
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
            {todoItems.map((item) => {
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
      const cards = props.cards ?? []
      const count = cards.length
      const [activeIndex, setActiveIndex] = useState(0)
      const containerRef = useRef<HTMLDivElement>(null)
      const scrollAccum = useRef(0)
      const scrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

      const goTo = useCallback((index: number) => {
        setActiveIndex(Math.max(0, Math.min(count - 1, index)))
      }, [count])

      // Horizontal scroll → card navigation. Vertical scroll passes through.
      useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const handler = (e: WheelEvent) => {
          // Only capture horizontal swipes — let vertical scroll pass through
          if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return

          e.preventDefault()
          scrollAccum.current += e.deltaX

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

      if (count === 0) return null

      return (
        <div ref={containerRef} className="relative select-none">
          <div className="relative h-[260px] flex items-center justify-center overflow-hidden py-4">
            {cards.map((card, i) => {
              const offset = i - activeIndex
              const absOffset = Math.abs(offset)
              const isActive = i === activeIndex
              const zIndex = count - absOffset
              // Flat stack: cards slide horizontally and scale down
              const translateX = offset * 80
              const scale = isActive ? 1 : Math.max(0.85 - absOffset * 0.03, 0.75)

              return (
                <div
                  key={i}
                  onClick={() => goTo(i)}
                  className="absolute w-[340px] cursor-pointer"
                  style={{
                    transform: `translateX(${translateX}px) scale(${scale})`,
                    zIndex,
                    transition: 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.35s ease',
                    opacity: absOffset > 3 ? 0 : 1,
                  }}
                >
                  <Card className={cn(
                    'h-[220px] flex flex-col relative overflow-hidden',
                    isActive
                      ? 'shadow-2xl ring-1 ring-primary/30'
                      : 'shadow-md',
                  )}>
                    {/* Overlay on non-active cards — white in light, dark in dark */}
                    {!isActive && (
                      <div
                        className="absolute inset-0 z-10 pointer-events-none bg-background/75"
                        style={{ transition: 'opacity 0.35s ease' }}
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
                      <CardContent className={cn('pt-0 flex-1', isActive ? 'overflow-y-auto' : 'overflow-hidden')}>
                        <p className={cn('text-xs text-muted-foreground leading-relaxed', !isActive && 'line-clamp-6')}>{card.content}</p>
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
            {cards.map((_, i) => (
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

    StepIndicator: ({ props }) => {
      const steps = props.steps ?? []
      if (steps.length === 0) return null
      return (
      <div className="flex items-center gap-0">
        {steps.map((step, i) => {
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
      )
    },

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

    // ── Plan ────────────────────────────────────────────────────────
    PlanNodeList: ({ props }) => {
      const nodes = props.nodes ?? []
      const [hoveredId, setHoveredId] = useState<string | null>(null)
      const [highlightedId, setHighlightedId] = useState<string | null>(null)
      const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())

      // Build lookup maps
      const nodeMap = new Map(nodes.map(n => [n.id, n]))

      // Sort: group by milestone (milestone header → its tasks), ungrouped tasks last, pruned last
      const STATUS_ORDER: Record<string, number> = {
        in_progress: 0, dispatched: 1, awaiting_approval: 2, awaiting_judgment: 2,
        planned: 3, auto_verified: 4, completed: 5, pruned: 6,
      }
      const milestones = nodes.filter(n => n.type === 'milestone')
      const tasksByMilestone = new Map<string, typeof nodes>()
      const ungroupedTasks: typeof nodes = []
      for (const n of nodes) {
        if (n.type === 'milestone') continue
        if (n.milestoneId && nodeMap.has(n.milestoneId)) {
          const list = tasksByMilestone.get(n.milestoneId) ?? []
          list.push(n)
          tasksByMilestone.set(n.milestoneId, list)
        } else {
          ungroupedTasks.push(n)
        }
      }
      const sortTasks = (arr: typeof nodes) =>
        [...arr].sort((a, b) => {
          const sa = STATUS_ORDER[a.status] ?? 3
          const sb = STATUS_ORDER[b.status] ?? 3
          if (sa !== sb) return sa - sb
          return a.title.localeCompare(b.title)
        })
      // milestones themselves sorted by status then title
      const sortedMilestones = [...milestones].sort((a, b) => {
        const sa = STATUS_ORDER[a.status] ?? 3
        const sb = STATUS_ORDER[b.status] ?? 3
        if (sa !== sb) return sa - sb
        return a.title.localeCompare(b.title)
      })
      const sorted: typeof nodes = []
      for (const ms of sortedMilestones) {
        sorted.push(ms)
        sorted.push(...sortTasks(tasksByMilestone.get(ms.id) ?? []))
      }
      sorted.push(...sortTasks(ungroupedTasks))

      const STATUS_DOT: Record<string, string> = {
        planned: 'bg-slate-400/60',
        in_progress: 'bg-blue-400',
        dispatched: 'bg-blue-300',
        completed: 'bg-green-500',
        auto_verified: 'bg-green-400',
        awaiting_approval: 'bg-yellow-400',
        awaiting_judgment: 'bg-orange-400',
        pruned: 'bg-slate-200',
      }

      const PRIORITY_COLOR: Record<string, string> = {
        urgent: 'text-red-500', high: 'text-orange-400',
        medium: 'text-yellow-500', low: 'text-slate-400', none: 'text-slate-300',
      }

      const scrollToNode = (id: string) => {
        const el = rowRefs.current.get(id)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          setHighlightedId(id)
          setTimeout(() => setHighlightedId(prev => prev === id ? null : prev), 1500)
        }
      }

      if (sorted.length === 0) return null

      return (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-1.5 bg-muted/40 border-b border-border flex items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Plan
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              {nodes.filter(n => n.type !== 'milestone').length} tasks
              {nodes.filter(n => n.type === 'milestone').length > 0 &&
                ` · ${nodes.filter(n => n.type === 'milestone').length} milestones`}
            </span>
          </div>
          <div className="divide-y divide-border/40 max-h-[360px] overflow-y-auto">
            {sorted.map(node => {
              const isHovered = hoveredId === node.id
              const isHighlighted = highlightedId === node.id
              const dot = STATUS_DOT[node.status] ?? 'bg-slate-400/60'
              const isMilestone = node.type === 'milestone'
              const deps = (node.dependencies ?? []).map(d => nodeMap.get(d)).filter(Boolean) as typeof nodes
              const milestoneName = node.milestoneId ? nodeMap.get(node.milestoneId)?.title : null

              if (isMilestone) {
                return (
                  <div
                    key={node.id}
                    ref={el => { if (el) rowRefs.current.set(node.id, el); else rowRefs.current.delete(node.id) }}
                    className={cn(
                      'relative px-3 pt-3 pb-2 bg-muted/40 border-t-2 border-t-border transition-colors',
                      isHighlighted ? 'bg-primary/8' : 'hover:bg-muted/50',
                    )}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Diamond className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dot)} />
                      <span className="text-[11px] font-semibold tracking-tight text-foreground truncate flex-1 min-w-0">
                        {node.title}
                      </span>
                      <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/60 shrink-0">
                        milestone
                      </span>
                      {node.dueDate && (
                        <span className="text-[9px] text-muted-foreground/70 shrink-0">
                          due {node.dueDate}
                        </span>
                      )}
                    </div>
                    {deps.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1 pl-4">
                        <span className="text-[9px] text-muted-foreground/40 mr-0.5">needs:</span>
                        {deps.map(dep => (
                          <button
                            key={dep.id}
                            type="button"
                            onClick={() => scrollToNode(dep.id)}
                            onMouseEnter={() => setHighlightedId(dep.id)}
                            onMouseLeave={() => setHighlightedId(null)}
                            className="text-[9px] text-muted-foreground/60 hover:text-primary transition-colors underline underline-offset-2 decoration-dotted truncate max-w-[120px]"
                          >
                            {dep.title}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Milestone hover popover */}
                    {isHovered && node.description && (
                      <div className="absolute left-full top-0 ml-2 z-50 w-56 rounded-lg border border-border bg-popover shadow-md p-2.5 text-[11px] space-y-1.5 pointer-events-none">
                        <p className="text-foreground/80 leading-snug">{node.description}</p>
                        <p className="text-[9px] font-mono text-muted-foreground/50 select-all">{node.id}</p>
                      </div>
                    )}
                  </div>
                )
              }

              return (
                <div
                  key={node.id}
                  ref={el => { if (el) rowRefs.current.set(node.id, el); else rowRefs.current.delete(node.id) }}
                  className={cn(
                    'relative pl-5 pr-3 py-2 transition-colors',
                    isHighlighted ? 'bg-primary/8' : 'hover:bg-muted/30',
                  )}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('h-1.5 w-1.5 rounded-full shrink-0 mt-px', dot)} />
                    <span className={cn(
                      'text-xs leading-tight truncate flex-1 min-w-0 text-foreground/85',
                      node.status === 'pruned' && 'line-through text-muted-foreground',
                    )}>
                      {node.title}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {node.priority && node.priority !== 'none' && node.priority !== 'medium' && (
                        <span className={cn('text-[9px] font-medium uppercase', PRIORITY_COLOR[node.priority] ?? 'text-slate-400')}>
                          {node.priority}
                        </span>
                      )}
                      {node.estimate && (
                        <span className="text-[9px] font-mono bg-muted rounded px-1 text-muted-foreground">
                          {node.estimate}
                        </span>
                      )}
                      {node.dueDate && (
                        <span className="text-[9px] text-muted-foreground/70">
                          due {node.dueDate}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Dependency chips — "needs X" = this task depends on X */}
                  {deps.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1 pl-3.5">
                      <span className="text-[9px] text-muted-foreground/40 mr-0.5">needs:</span>
                      {deps.map(dep => (
                        <button
                          key={dep.id}
                          type="button"
                          onClick={() => scrollToNode(dep.id)}
                          onMouseEnter={() => setHighlightedId(dep.id)}
                          onMouseLeave={() => setHighlightedId(null)}
                          className="flex items-center gap-0.5 text-[9px] text-muted-foreground/60 hover:text-primary transition-colors underline underline-offset-2 decoration-dotted"
                        >
                          <span className="truncate max-w-[120px]">{dep.title}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Hover detail popover */}
                  {isHovered && (node.description || milestoneName || node.dueDate) && (
                    <div className="absolute left-full top-0 ml-2 z-50 w-56 rounded-lg border border-border bg-popover shadow-md p-2.5 text-[11px] space-y-1.5 pointer-events-none">
                      {milestoneName && (
                        <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                          Milestone: {milestoneName}
                        </p>
                      )}
                      {node.description && (
                        <p className="text-foreground/80 leading-snug">{node.description}</p>
                      )}
                      {node.dueDate && (
                        <p className="text-muted-foreground">Due: {node.dueDate}</p>
                      )}
                      <p className="text-[9px] font-mono text-muted-foreground/50 select-all">{node.id}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )
    },

    PlanGraph: ({ props }) => {
      const nodes = props.nodes ?? []
      if (nodes.length === 0) return null
      return (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-1.5 bg-muted/40 border-b border-border flex items-center gap-3 overflow-x-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground shrink-0">
              Plan Graph
            </span>
            <div className="w-px h-3 bg-border shrink-0" />
            {/* Status legend */}
            {([
              { color: STATUS_DOT_COLOR.in_progress,        label: 'in progress' },
              { color: STATUS_DOT_COLOR.planned,            label: 'planned' },
              { color: STATUS_DOT_COLOR.completed,          label: 'completed' },
              { color: STATUS_DOT_COLOR.awaiting_approval,  label: 'awaiting' },
              { color: STATUS_DOT_COLOR.pruned,             label: 'pruned' },
            ] as const).map(({ color, label }) => (
              <span key={label} className="flex items-center gap-1 shrink-0">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                <span className="text-[9px] text-muted-foreground/70">{label}</span>
              </span>
            ))}
            <div className="w-px h-3 bg-border shrink-0" />
            {/* Priority legend */}
            {([
              { color: PRIORITY_PIP_COLOR.urgent, label: 'urgent' },
              { color: PRIORITY_PIP_COLOR.high,   label: 'high' },
              { color: PRIORITY_PIP_COLOR.medium, label: 'medium' },
              { color: PRIORITY_PIP_COLOR.low,    label: 'low' },
            ] as const).map(({ color, label }) => (
              <span key={label} className="flex items-center gap-1 shrink-0">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                <span className="text-[9px] text-muted-foreground/70">{label}</span>
              </span>
            ))}
            <div className="w-px h-3 bg-border shrink-0" />
            {/* Edge legend */}
            <span className="flex items-center gap-1 shrink-0">
              <svg width="18" height="6" className="shrink-0">
                <line x1="0" y1="3" x2="18" y2="3" stroke={GRAPH_EDGE_COLOR} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.8" />
              </svg>
              <span className="text-[9px] text-muted-foreground/70">active dep</span>
            </span>
            <span className="flex items-center gap-1 shrink-0">
              <svg width="18" height="6" className="shrink-0">
                <line x1="0" y1="3" x2="14" y2="3" stroke={GRAPH_EDGE_COLOR} strokeWidth="1.5" opacity="0.7" />
                <polygon points="14,0 18,3 14,6" fill={GRAPH_EDGE_COLOR} opacity="0.7" />
              </svg>
              <span className="text-[9px] text-muted-foreground/70">depends on</span>
            </span>
          </div>
          <div style={{ height: 480 }}>
            <ReactFlowProvider>
              <PlanGraphInner nodes={nodes} />
            </ReactFlowProvider>
          </div>
        </div>
      )
    },

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

import { defineCatalog } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'

/**
 * Astro component catalog for json-render.
 *
 * Defines the component types and props that the AI can generate.
 * All Zod schemas — no React imports — so this file is server-importable.
 */
export const astroCatalog = defineCatalog(schema, {
  components: {
    // ── Layout ──────────────────────────────────────────────────────
    Card: {
      props: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
      }),
      description: 'A container card with optional title and description. Use for grouping related content.',
    },
    Stack: {
      props: z.object({
        direction: z.enum(['horizontal', 'vertical']).optional(),
        gap: z.enum(['sm', 'md', 'lg']).optional(),
        align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
        wrap: z.boolean().optional(),
      }),
      description: 'A flex layout container. Defaults to vertical with medium gap.',
    },
    Separator: {
      props: z.object({}),
      description: 'A horizontal separator line between sections.',
    },

    // ── Content ─────────────────────────────────────────────────────
    Text: {
      props: z.object({
        content: z.string(),
      }),
      description: 'A block of markdown-rendered text.',
    },
    Heading: {
      props: z.object({
        text: z.string(),
        level: z.enum(['1', '2', '3', '4']).optional(),
      }),
      description: 'A heading element. Defaults to level 2.',
    },
    Badge: {
      props: z.object({
        label: z.string(),
        variant: z.enum([
          'default', 'secondary', 'destructive', 'outline',
          'success', 'warning', 'info', 'in-progress',
          'awaiting', 'completed', 'error', 'planned',
        ]).optional(),
      }),
      description: 'A status badge. Use variant to convey semantic meaning.',
    },
    Alert: {
      props: z.object({
        title: z.string().optional(),
        message: z.string(),
        variant: z.enum(['default', 'destructive', 'info', 'warning', 'success']).optional(),
      }),
      description: 'An alert box for important messages or status updates.',
    },
    Table: {
      props: z.object({
        headers: z.array(z.string()),
        rows: z.array(z.array(z.string())),
        caption: z.string().optional(),
      }),
      description: 'A data table with column headers and rows. Each row is an array of cell strings.',
    },
    List: {
      props: z.object({
        items: z.array(z.string()),
        ordered: z.boolean().optional(),
      }),
      description: 'A bullet or numbered list.',
    },
    KeyValue: {
      props: z.object({
        pairs: z.array(z.object({
          key: z.string(),
          value: z.string(),
        })).optional(),
        items: z.array(z.object({
          key: z.string(),
          value: z.string(),
        })).optional(),
      }),
      description: 'A key-value display for structured data. Each pair has a key label and value. Accepts either "pairs" or "items" as the prop name.',
    },
    CodeBlock: {
      props: z.object({
        code: z.string(),
        language: z.string().optional(),
        title: z.string().optional(),
      }),
      description: 'A syntax-highlighted code block with optional language and title.',
    },

    // ── Interactive ─────────────────────────────────────────────────
    OptionCard: {
      props: z.object({
        title: z.string(),
        description: z.string().optional(),
        selected: z.boolean().optional(),
        dimmed: z.boolean().optional(),
      }),
      description: 'A clickable option card for selection flows. Emits "press" on click. Use selected/dimmed props with $state bindings for multi-step flows.',
    },
    Timeline: {
      props: z.object({
        entries: z.array(z.object({
          label: z.string(),
          title: z.string(),
          description: z.string().optional(),
        })),
      }),
      description: 'A vertical timeline with labeled entries. Each entry has a label (date/phase), title, and optional description.',
    },
    Accordion: {
      props: z.object({
        items: z.array(z.object({
          title: z.string(),
          content: z.string(),
        })),
        type: z.enum(['single', 'multiple']).optional(),
      }),
      description: 'Expandable/collapsible sections. Each item has a title header and markdown content. Defaults to single-open.',
    },
    TabView: {
      props: z.object({
        tabs: z.array(z.object({
          label: z.string(),
          value: z.string(),
        })),
        defaultTab: z.string().optional(),
      }),
      description: 'A tabbed container. Define tabs here, then use child elements with visible conditions to show content per tab. Wire with state: set state "/activeTab" on tab click, use visible: { "$state": "/activeTab", "eq": "tabValue" } on content elements.',
    },

    TodoList: {
      props: z.object({
        items: z.array(z.object({
          id: z.string(),
          content: z.string(),
          status: z.enum(['pending', 'in_progress', 'completed']).optional(),
          priority: z.enum(['high', 'medium', 'low']).optional(),
        })),
        title: z.string().optional(),
      }),
      description: 'An interactive checklist. Each item can be checked off by the user. When an item is toggled, sends a chat message like "Completed: <content>". Compatible with task tracking. Use for action items, review checklists, and step-by-step procedures.',
    },
    CardCarousel: {
      props: z.object({
        cards: z.array(z.object({
          title: z.string(),
          description: z.string().optional(),
          content: z.string().optional(),
          badge: z.string().optional(),
          badgeVariant: z.enum(['default', 'secondary', 'success', 'warning', 'error', 'info']).optional(),
        })),
      }),
      description: 'A Cover Flow-style horizontal card carousel. Cards overlap and scroll smoothly with 3D perspective. Use for browsing options, showcasing results, or comparing items visually. Scroll with mouse wheel, touchpad, or arrow keys.',
    },
    Metric: {
      props: z.object({
        value: z.string(),
        label: z.string(),
        description: z.string().optional(),
        trend: z.enum(['up', 'down', 'stable']).optional(),
        trendLabel: z.string().optional(),
      }),
      description: 'A large metric display with a prominent value, label, and optional trend indicator. Use for KPIs, stats, and dashboard numbers.',
    },
    StepIndicator: {
      props: z.object({
        steps: z.array(z.string()),
        current: z.number().min(0),
      }),
      description: 'A horizontal step progress indicator showing the current position in a multi-step flow. Steps before current are marked complete, the current step is highlighted.',
    },

    // ── Feedback ────────────────────────────────────────────────────
    Progress: {
      props: z.object({
        value: z.number().min(0).max(100),
        label: z.string().optional(),
      }),
      description: 'A progress bar showing percentage completion (0-100).',
    },

    // ── Plan ────────────────────────────────────────────────────────
    PlanNodeList: {
      props: z.object({
        nodes: z.array(z.object({
          id: z.string(),
          title: z.string(),
          type: z.string(),
          status: z.string(),
          description: z.string().optional().nullable(),
          estimate: z.string().optional().nullable(),
          priority: z.string().optional().nullable(),
          dueDate: z.string().optional().nullable(),
          milestoneId: z.string().optional().nullable(),
          dependencies: z.array(z.string()).optional(),
        })),
      }),
      description: 'A sorted task list showing plan nodes with status indicators, estimate/priority badges, and dependency arrows. Hover a row to see full details. Dependency chips link to related tasks. Use for displaying plan state after CLI mutations.',
    },
    PlanGraph: {
      props: z.object({
        nodes: z.array(z.object({
          id: z.string(),
          title: z.string(),
          type: z.string(),
          status: z.string(),
          description: z.string().optional().nullable(),
          estimate: z.string().optional().nullable(),
          priority: z.string().optional().nullable(),
          dueDate: z.string().optional().nullable(),
          milestoneId: z.string().optional().nullable(),
          dependencies: z.array(z.string()).optional(),
        })),
      }),
      description: 'An interactive DAG graph with auto-layout (dagre), milestone banners, status-colored task cards, and directional dependency edges. Same node schema as PlanNodeList. Use for visualizing plan structure and dependencies.',
    },

    // ── Input ───────────────────────────────────────────────────────
    Button: {
      props: z.object({
        label: z.string(),
        variant: z.enum(['default', 'destructive', 'outline', 'secondary', 'ghost', 'link']).optional(),
        size: z.enum(['default', 'sm', 'lg']).optional(),
      }),
      description: 'A clickable button. Emits "press" on click. Wire actions via "on": { "press": { "action": "actionName", "params": {...} } }.',
    },
  },
  actions: {
    copy_to_clipboard: {
      description: 'Copy text content to clipboard',
      params: z.object({ text: z.string() }),
    },
    navigate_to_node: {
      description: 'Navigate to a plan node by ID',
      params: z.object({ nodeId: z.string() }),
    },
    send_chat_message: {
      description: 'Send a message to the chat as if the user typed it — continues the conversation. Use for option cards, decision buttons, and branching flows.',
      params: z.object({ message: z.string() }),
    },
  },
})

export type AstroCatalog = typeof astroCatalog

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
        })),
      }),
      description: 'A key-value display for structured data. Each pair has a key label and value.',
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

    // ── Feedback ────────────────────────────────────────────────────
    Progress: {
      props: z.object({
        value: z.number().min(0).max(100),
        label: z.string().optional(),
      }),
      description: 'A progress bar showing percentage completion (0-100).',
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

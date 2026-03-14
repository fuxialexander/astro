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
    Card: {
      props: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
      }),
      description: 'A container card with optional title and description. Use for grouping related content.',
    },
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
      description: 'A status badge. Use variant to convey semantic meaning (success, warning, error, etc.).',
    },
    Alert: {
      props: z.object({
        title: z.string().optional(),
        message: z.string(),
        variant: z.enum(['default', 'destructive', 'info', 'warning', 'success']).optional(),
      }),
      description: 'An alert box for important messages or status updates.',
    },
    Button: {
      props: z.object({
        label: z.string(),
        variant: z.enum(['default', 'destructive', 'outline', 'secondary', 'ghost', 'link']).optional(),
        size: z.enum(['default', 'sm', 'lg']).optional(),
      }),
      description: 'A clickable button. Wire actions via the element "on" field: { "on": { "press": { "action": "actionName" } } }.',
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
    Separator: {
      props: z.object({}),
      description: 'A horizontal separator line between sections.',
    },
    Progress: {
      props: z.object({
        value: z.number().min(0).max(100),
        label: z.string().optional(),
      }),
      description: 'A progress bar showing percentage completion (0-100).',
    },
    Stack: {
      props: z.object({
        direction: z.enum(['horizontal', 'vertical']).optional(),
        gap: z.enum(['sm', 'md', 'lg']).optional(),
        align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
      }),
      description: 'A flex layout container. Defaults to vertical with medium gap.',
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
  },
})

export type AstroCatalog = typeof astroCatalog

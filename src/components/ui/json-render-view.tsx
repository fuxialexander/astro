import { Renderer, JSONUIProvider } from '@json-render/react'
import type { Spec } from '@json-render/core'
import { registry } from '@/lib/json-render'
import { cn } from '@/lib/utils'

const actionHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  copy_to_clipboard: async (params) => {
    if (typeof params.text === 'string') {
      await navigator.clipboard.writeText(params.text)
    }
  },
  navigate_to_node: async (params) => {
    if (typeof params.nodeId === 'string') {
      window.dispatchEvent(new CustomEvent('astro:navigate-to-node', { detail: { nodeId: params.nodeId } }))
    }
  },
  send_chat_message: async (params) => {
    if (typeof params.message === 'string') {
      window.dispatchEvent(new CustomEvent('astro:send-chat-message', { detail: { message: params.message } }))
    }
  },
}

interface JsonRenderViewProps {
  spec: Spec
  className?: string
  maxHeight?: string
  loading?: boolean
  fallback?: React.ReactNode
}

export function JsonRenderView({ spec, className, maxHeight, loading, fallback }: JsonRenderViewProps) {
  if (!spec?.root || !spec?.elements) {
    return <>{fallback}</>
  }

  // Sanitize: ensure every element has props and children (may be undefined from YAML parsing)
  const rawElements = spec.elements as unknown as Record<string, Record<string, unknown>>
  const cleanElements: Record<string, unknown> = {}
  for (const [key, el] of Object.entries(rawElements)) {
    cleanElements[key] = { ...el, props: el.props ?? {}, children: el.children ?? [] }
  }
  const sanitized = { root: spec.root, elements: cleanElements, state: spec.state } as unknown as Spec

  return (
    <JSONUIProvider registry={registry} handlers={actionHandlers} initialState={sanitized.state ?? {}}>
      <div
        className={cn('json-render-view', className)}
        style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}
      >
        <Renderer spec={sanitized} registry={registry} loading={loading} />
      </div>
    </JSONUIProvider>
  )
}

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

  return (
    <JSONUIProvider registry={registry} handlers={actionHandlers} initialState={spec.state ?? {}}>
      <div
        className={cn('json-render-view', className)}
        style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}
      >
        <Renderer spec={spec} registry={registry} loading={loading} />
      </div>
    </JSONUIProvider>
  )
}

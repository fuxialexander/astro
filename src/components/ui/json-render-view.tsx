import { useMemo } from 'react'
import React from 'react'
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

/**
 * Evaluate a component definition string into a React component.
 *
 * The code should be a function body that receives { props, children, emit, on }
 * and returns React elements using React.createElement (no JSX).
 *
 * Available in scope: React, cn (tailwind merge utility)
 */
function evalComponent(name: string, code: string): React.ComponentType<{ props: Record<string, unknown>; children?: React.ReactNode }> | null {
  try {
    // The code is a function body: ({ props, children }) => React.createElement(...)
    // We wrap it to provide React and cn in scope
    const factory = new Function('React', 'cn', `
      "use strict";
      return (${code});
    `)
    const component = factory(React, cn)
    if (typeof component !== 'function') {
      console.warn(`[json-render] Component "${name}" did not evaluate to a function`)
      return null
    }
    // Wrap to match json-render's BaseComponentProps interface
    const Wrapper = (renderProps: { props: Record<string, unknown>; children?: React.ReactNode }) => {
      try {
        return component(renderProps)
      } catch (err) {
        console.error(`[json-render] Error rendering custom component "${name}":`, err)
        return React.createElement('div', {
          className: 'text-xs text-error border border-error/30 rounded p-2'
        }, `Error in ${name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    Wrapper.displayName = `Custom(${name})`
    return Wrapper
  } catch (err) {
    console.error(`[json-render] Failed to evaluate component "${name}":`, err)
    return null
  }
}

interface JsonRenderViewProps {
  spec: Spec
  className?: string
  maxHeight?: string
  loading?: boolean
  fallback?: React.ReactNode
  /** Custom component code strings from ```component fences. Keys are component names. */
  componentDefs?: Record<string, string>
}

export function JsonRenderView({ spec, className, maxHeight, loading, fallback, componentDefs }: JsonRenderViewProps) {
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

  // Merge custom components with the static registry
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const mergedRegistry = useMemo(() => {
    if (!componentDefs || Object.keys(componentDefs).length === 0) return registry

    const custom: Record<string, unknown> = {}
    for (const [name, code] of Object.entries(componentDefs)) {
      const comp = evalComponent(name, code)
      if (comp) custom[name] = comp
    }
    if (Object.keys(custom).length === 0) return registry

    return { ...registry, ...custom } as typeof registry
  }, [componentDefs])

  return (
    <JSONUIProvider registry={mergedRegistry} handlers={actionHandlers} initialState={sanitized.state ?? {}}>
      <div
        className={cn('json-render-view', className)}
        style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}
      >
        <Renderer spec={sanitized} registry={mergedRegistry} loading={loading} />
      </div>
    </JSONUIProvider>
  )
}

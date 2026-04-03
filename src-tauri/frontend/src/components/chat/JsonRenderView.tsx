/**
 * JsonRenderView — lightweight json-render renderer for the desktop frontend.
 *
 * Uses a minimal component registry (no shadcn dependencies).
 * Supports the same Spec format as the main app.
 */
import { useMemo } from 'react'
import React from 'react'
import { Renderer, JSONUIProvider } from '@json-render/react'
import type { Spec } from '@json-render/core'
import type { ComponentRenderProps, ComponentRegistry } from '@json-render/react'
import { cn } from '@desktop/lib/utils'

// ── Minimal component registry ────────────────────────────────────────

const gapMap: Record<string, string> = { sm: 'gap-1', md: 'gap-3', lg: 'gap-5' }
const alignMap: Record<string, string> = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' }

function Card({ element, children }: ComponentRenderProps) {
  const p = element.props as Record<string, unknown>
  const hasChildren = Array.isArray(children) ? children.some(Boolean) : !!children
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      {(p.title || p.description) && (
        <div className="flex flex-col space-y-1.5 p-4 pb-2">
          {p.title && <h3 className="text-sm font-semibold leading-none">{String(p.title)}</h3>}
          {p.description && <p className="text-xs text-muted-foreground">{String(p.description)}</p>}
        </div>
      )}
      <div className="p-4 pt-0">
        {children}
        {p.content && !hasChildren && <p className="text-sm text-muted-foreground">{String(p.content)}</p>}
      </div>
    </div>
  )
}

function Stack({ element, children }: ComponentRenderProps) {
  const p = element.props as Record<string, unknown>
  const direction = (p.direction as string) || 'vertical'
  const gap = (p.gap as string) || 'md'
  const align = p.align as string | undefined
  return (
    <div className={cn(
      'flex',
      direction === 'horizontal' ? 'flex-row' : 'flex-col',
      gapMap[gap] || 'gap-3',
      align ? alignMap[align] : '',
      p.wrap ? 'flex-wrap' : '',
    )}>
      {children}
    </div>
  )
}

function TextComp({ element }: ComponentRenderProps) {
  const p = element.props as Record<string, unknown>
  const variant = p.variant as string | undefined
  const cls = variant === 'heading' ? 'text-sm font-semibold' :
              variant === 'label' ? 'text-xs font-medium text-muted-foreground uppercase tracking-wider' :
              variant === 'caption' ? 'text-xs text-muted-foreground' :
              'text-sm'
  return <p className={cls}>{String(p.content ?? p.text ?? '')}</p>
}

function BadgeComp({ element }: ComponentRenderProps) {
  const p = element.props as Record<string, unknown>
  const variant = p.variant as string | undefined
  const color = variant === 'success' ? 'bg-green-100 text-green-800' :
                variant === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                variant === 'error' || variant === 'destructive' ? 'bg-red-100 text-red-800' :
                'bg-muted text-muted-foreground'
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium', color)}>
      {String(p.label ?? p.text ?? '')}
    </span>
  )
}

function TableComp({ element }: ComponentRenderProps) {
  const p = element.props as Record<string, unknown>
  const headers = (p.headers ?? []) as string[]
  const rows = (p.rows ?? []) as string[][]
  return (
    <div className="rounded-md border overflow-hidden">
      <table className="w-full text-xs">
        {headers.length > 0 && (
          <thead>
            <tr className="border-b bg-muted/50">
              {headers.map((h, i) => (
                <th key={i} className="px-3 py-1.5 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b last:border-0">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SeparatorComp() {
  return <hr className="border-border my-2" />
}

function AlertComp({ element, children }: ComponentRenderProps) {
  const p = element.props as Record<string, unknown>
  const variant = p.variant as string | undefined
  const cls = variant === 'destructive' ? 'border-destructive/50 text-destructive' : ''
  return (
    <div className={cn('relative w-full rounded-lg border p-3 text-xs', cls)}>
      {p.title && <h5 className="font-medium leading-none mb-1">{String(p.title)}</h5>}
      {p.description ? <p className="text-muted-foreground">{String(p.description)}</p> : children}
    </div>
  )
}

function ListComp({ element, children }: ComponentRenderProps) {
  const p = element.props as Record<string, unknown>
  const items = p.items as string[] | undefined
  const ordered = p.ordered as boolean | undefined
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={cn('text-sm pl-5', ordered ? 'list-decimal' : 'list-disc', 'space-y-0.5')}>
      {items ? items.map((item, i) => <li key={i}>{item}</li>) : children}
    </Tag>
  )
}

function ListItemComp({ element }: ComponentRenderProps) {
  const p = element.props as Record<string, unknown>
  return <li className="text-sm">{String(p.text ?? p.content ?? '')}</li>
}

function CodeComp({ element }: ComponentRenderProps) {
  const p = element.props as Record<string, unknown>
  return (
    <pre className="rounded-md bg-muted p-3 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap">
      {String(p.content ?? p.code ?? '')}
    </pre>
  )
}

function ImageComp({ element }: ComponentRenderProps) {
  const p = element.props as Record<string, unknown>
  return (
    <img
      src={String(p.src ?? '')}
      alt={String(p.alt ?? '')}
      className="rounded-md max-w-full h-auto"
    />
  )
}

function ProgressComp({ element }: ComponentRenderProps) {
  const value = Number((element.props as Record<string, unknown>).value ?? 0)
  return (
    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
      <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

const registry: ComponentRegistry = {
  Card, Stack, Text: TextComp, Badge: BadgeComp, Table: TableComp,
  Separator: SeparatorComp, Alert: AlertComp, List: ListComp,
  ListItem: ListItemComp, Code: CodeComp, Image: ImageComp, Progress: ProgressComp,
}

// ── Action handlers ───────────────────────────────────────────────────

const actionHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  copy_to_clipboard: async (params) => {
    if (typeof params.text === 'string') {
      await navigator.clipboard.writeText(params.text)
    }
  },
}

// ── Evaluate custom component definitions ─────────────────────────────

function evalComponent(
  name: string,
  code: string,
): React.ComponentType<ComponentRenderProps> | null {
  try {
    const factory = new Function('React', 'cn', `"use strict"; return (${code});`)
    const component = factory(React, cn)
    if (typeof component !== 'function') return null
    const Wrapper = (renderProps: ComponentRenderProps) => {
      try {
        return component(renderProps)
      } catch (err) {
        return React.createElement('div', { className: 'text-xs text-destructive' }, `Error in ${name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    Wrapper.displayName = `Custom(${name})`
    return Wrapper
  } catch {
    return null
  }
}

// ── Public component ──────────────────────────────────────────────────

interface JsonRenderViewProps {
  spec: { root: string; elements: Record<string, unknown>; state?: Record<string, unknown> }
  componentDefs?: Record<string, string>
}

export function JsonRenderView({ spec, componentDefs }: JsonRenderViewProps) {
  if (!spec?.root || !spec?.elements) return null

  // Sanitize elements: ensure props/children exist, filter missing child refs
  const rawElements = spec.elements as Record<string, Record<string, unknown>>
  const elementKeys = new Set(Object.keys(rawElements))
  const cleanElements: Record<string, unknown> = {}
  for (const [key, el] of Object.entries(rawElements)) {
    const rawChildren = (el.children ?? []) as string[]
    const validChildren = Array.isArray(rawChildren)
      ? rawChildren.filter((child) => typeof child !== 'string' || elementKeys.has(child))
      : rawChildren
    cleanElements[key] = { ...el, props: el.props ?? {}, children: validChildren }
  }
  const sanitized = { root: spec.root, elements: cleanElements, state: spec.state } as unknown as Spec

  // Merge custom components
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const mergedRegistry = useMemo(() => {
    if (!componentDefs || Object.keys(componentDefs).length === 0) return registry

    const custom: Record<string, React.ComponentType<ComponentRenderProps>> = {}
    for (const [name, code] of Object.entries(componentDefs)) {
      const comp = evalComponent(name, code)
      if (comp) custom[name] = comp
    }
    if (Object.keys(custom).length === 0) return registry
    return { ...registry, ...custom } as ComponentRegistry
  }, [componentDefs])

  return (
    <JSONUIProvider registry={mergedRegistry} handlers={actionHandlers} initialState={sanitized.state ?? {}}>
      <Renderer spec={sanitized} registry={mergedRegistry} />
    </JSONUIProvider>
  )
}

/**
 * Window management channel schemas. Used by the dockview pane system
 * (Phase 3) to detach panes into floating windows and to focus / list
 * existing windows.
 */

import { z } from 'zod'

export const focus = {
  req: z.object({ id: z.string() }),
  res: z.object({ ok: z.literal(true) }),
}

export const list = {
  req: z.object({}),
  res: z.object({
    windows: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        focused: z.boolean(),
      })
    ),
  }),
}

export const detachPane = {
  req: z.object({
    paneKind: z.string(),
    paneId: z.string(),
    paneTitle: z.string(),
    paneState: z.unknown(),
  }),
  res: z.object({ windowId: z.string() }),
}

export const closeWindow = {
  req: z.object({ id: z.string() }),
  res: z.object({ ok: z.literal(true) }),
}

/**
 * Phase 5 — open a small auxiliary window (find-in-page overlay, about
 * modal, template scaffold). Body is empty because the main process is
 * the single source of truth for window options and content; the
 * renderer just requests "open this" by name.
 */
export const openFind = {
  req: z.object({}),
  res: z.object({ ok: z.literal(true) }),
}

export const openAbout = {
  req: z.object({}),
  res: z.object({ ok: z.literal(true) }),
}

export const channels = {
  'windows:focus': focus,
  'windows:list': list,
  'windows:detach-pane': detachPane,
  'windows:close': closeWindow,
  'windows:open-find': openFind,
  'windows:open-about': openAbout,
} as const

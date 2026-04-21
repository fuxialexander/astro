/**
 * Filesystem channel schemas. Wraps node:fs/promises with a typed surface;
 * all calls go through the main process (renderer is sandboxed, no Node).
 *
 * Phase 2A scope: read/write/list/stat/exists/mkdir/rm. The agent-runner
 * has its own fs primitives over the relay — these are for desktop-only
 * features like the FileBrowser pane and PDF viewer.
 */

import { z } from 'zod'

export const statShape = z.object({
  size: z.number(),
  mtimeMs: z.number(),
  ctimeMs: z.number(),
  isDirectory: z.boolean(),
  isFile: z.boolean(),
})

export const readFile = {
  req: z.object({ path: z.string(), encoding: z.enum(['utf8', 'base64']).default('utf8') }),
  res: z.object({ content: z.string() }),
}

export const writeFile = {
  req: z.object({
    path: z.string(),
    content: z.string(),
    encoding: z.enum(['utf8', 'base64']).default('utf8'),
  }),
  res: z.object({ ok: z.literal(true) }),
}

export const exists = {
  req: z.object({ path: z.string() }),
  res: z.object({ exists: z.boolean() }),
}

export const stat = {
  req: z.object({ path: z.string() }),
  res: statShape,
}

export const listDir = {
  req: z.object({ path: z.string() }),
  res: z.object({
    entries: z.array(
      z.object({
        name: z.string(),
        path: z.string(),
        isDirectory: z.boolean(),
        isFile: z.boolean(),
      })
    ),
  }),
}

export const mkdir = {
  req: z.object({ path: z.string(), recursive: z.boolean().default(true) }),
  res: z.object({ ok: z.literal(true) }),
}

export const rm = {
  req: z.object({
    path: z.string(),
    recursive: z.boolean().default(false),
    force: z.boolean().default(false),
  }),
  res: z.object({ ok: z.literal(true) }),
}

export const search = {
  req: z.object({
    root: z.string(),
    query: z.string(),
    limit: z.number().optional(),
  }),
  res: z.object({
    matches: z.array(
      z.object({
        path: z.string(),
        name: z.string(),
        type: z.enum(['file', 'directory']),
      })
    ),
  }),
}

export const searchContent = {
  req: z.object({
    root: z.string(),
    pattern: z.string(),
    caseSensitive: z.boolean().optional(),
    maxMatchesPerFile: z.number().optional(),
    limit: z.number().optional(),
  }),
  res: z.object({
    matches: z.array(
      z.object({
        path: z.string(),
        lineNo: z.number(),
        line: z.string(),
        matchStart: z.number(),
        matchEnd: z.number(),
      })
    ),
    error: z.string().optional(),
  }),
}

export const channels = {
  'fs:read-file': readFile,
  'fs:write-file': writeFile,
  'fs:exists': exists,
  'fs:stat': stat,
  'fs:list-dir': listDir,
  'fs:mkdir': mkdir,
  'fs:rm': rm,
  'fs:search': search,
  'fs:search-content': searchContent,
} as const

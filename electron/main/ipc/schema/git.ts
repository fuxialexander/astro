/**
 * Git channel schemas. Operations route through electron/workers/git/worker.ts
 * (a worker_thread running simple-git) so blocking git calls on large repos
 * don't stall the main event loop.
 */

import { z } from 'zod'

export const repoArg = z.object({ cwd: z.string() })

export const fileChange = z.object({
  path: z.string(),
  // simple-git's status enum, normalized.
  status: z.enum(['modified', 'added', 'deleted', 'renamed', 'untracked', 'conflicted']),
  staged: z.boolean(),
})

export const status = {
  req: repoArg,
  res: z.object({
    branch: z.string().nullable(),
    upstream: z.string().nullable(),
    ahead: z.number(),
    behind: z.number(),
    files: z.array(fileChange),
    isClean: z.boolean(),
  }),
}

export const log = {
  req: repoArg.extend({ maxCount: z.number().int().positive().max(500).default(50) }),
  res: z.object({
    commits: z.array(
      z.object({
        hash: z.string(),
        date: z.string(),
        message: z.string(),
        author: z.string(),
        email: z.string(),
      })
    ),
  }),
}

export const diff = {
  req: repoArg.extend({
    /** If null, diffs the working tree against HEAD. */
    revision: z.string().nullable().default(null),
    /** Optional file path scope. */
    file: z.string().nullable().default(null),
    /** If true, diff the index against HEAD (i.e. `git diff --cached`). */
    staged: z.boolean().optional(),
  }),
  res: z.object({ diff: z.string() }),
}

export const branchList = {
  req: repoArg,
  res: z.object({
    current: z.string().nullable(),
    all: z.array(z.string()),
  }),
}

export const checkout = {
  req: repoArg.extend({ ref: z.string() }),
  res: z.object({ ok: z.literal(true) }),
}

export const commit = {
  req: repoArg.extend({
    message: z.string(),
    files: z.array(z.string()).optional(),
  }),
  res: z.object({ commitHash: z.string() }),
}

export const channels = {
  'git:status': status,
  'git:log': log,
  'git:diff': diff,
  'git:branches': branchList,
  'git:checkout': checkout,
  'git:commit': commit,
} as const

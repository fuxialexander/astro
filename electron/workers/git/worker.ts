/**
 * Git worker_thread. Runs simple-git off the main event loop so blocking git
 * operations on large repos don't stall Electron's main process. Receives
 * {@link WorkerRequest}s on parentPort, posts a single {@link WorkerResponse}
 * per request.
 *
 * One simple-git instance is cached per cwd to avoid re-initializing the
 * child-process spawner on every call.
 */

// Worker threads in Electron may not have valid stdio file descriptors (fd 0/1/2),
// causing EBADF when child_process.spawn inherits them. Patch spawn to default
// stdio to ['ignore', 'pipe', 'pipe'] — simple-git already reads stdout/stderr
// via pipes and never writes to stdin.
import * as cp from 'node:child_process'
const _origSpawn = cp.spawn
;(cp as unknown as Record<string, unknown>).spawn = function (
  cmd: string,
  argsOrOpts?: readonly string[] | cp.SpawnOptions,
  maybeOpts?: cp.SpawnOptions,
) {
  if (Array.isArray(argsOrOpts)) {
    const opts: cp.SpawnOptions = { ...maybeOpts }
    if (!opts.stdio) opts.stdio = ['ignore', 'pipe', 'pipe']
    return _origSpawn(cmd, argsOrOpts, opts)
  }
  const opts: cp.SpawnOptions = { ...(argsOrOpts as cp.SpawnOptions | undefined) }
  if (!opts.stdio) opts.stdio = ['ignore', 'pipe', 'pipe']
  return _origSpawn(cmd, opts)
} as typeof cp.spawn

import { parentPort } from 'node:worker_threads'
import { simpleGit, type SimpleGit } from 'simple-git'
import type { z } from 'zod'
import {
  status as statusSchema,
  log as logSchema,
  diff as diffSchema,
  branchList as branchesSchema,
  checkout as checkoutSchema,
  commit as commitSchema,
} from '../../main/ipc/schema/git.js'
import type { WorkerRequest, WorkerResponse } from './protocol.js'

if (!parentPort) {
  throw new Error('[git-worker] must run as a worker_thread')
}
const port = parentPort

const gitCache = new Map<string, SimpleGit>()
function gitFor(cwd: string): SimpleGit {
  const existing = gitCache.get(cwd)
  if (existing) return existing
  const g = simpleGit(cwd)
  gitCache.set(cwd, g)
  return g
}

type StatusReq = z.infer<typeof statusSchema.req>
type StatusRes = z.infer<typeof statusSchema.res>
type LogReq = z.infer<typeof logSchema.req>
type LogRes = z.infer<typeof logSchema.res>
type DiffReq = z.infer<typeof diffSchema.req>
type DiffRes = z.infer<typeof diffSchema.res>
type BranchesReq = z.infer<typeof branchesSchema.req>
type BranchesRes = z.infer<typeof branchesSchema.res>
type CheckoutReq = z.infer<typeof checkoutSchema.req>
type CheckoutRes = z.infer<typeof checkoutSchema.res>
type CommitReq = z.infer<typeof commitSchema.req>
type CommitRes = z.infer<typeof commitSchema.res>

type FileStatus = StatusRes['files'][number]['status']

/**
 * Map simple-git's two-character index/working_dir codes into the normalized
 * enum the schema expects. Precedence: conflicts > deletions > renames/copies
 * > additions > modifications > untracked.
 */
function mapFileStatus(index: string, workingDir: string): FileStatus {
  const pair = `${index}${workingDir}`
  if (
    pair === 'DD' ||
    pair === 'AU' ||
    pair === 'UD' ||
    pair === 'UA' ||
    pair === 'DU' ||
    pair === 'AA' ||
    pair === 'UU' ||
    index === 'U' ||
    workingDir === 'U'
  ) {
    return 'conflicted'
  }
  if (index === '?' && workingDir === '?') return 'untracked'
  if (index === 'D' || workingDir === 'D') return 'deleted'
  if (index === 'R' || workingDir === 'R' || index === 'C' || workingDir === 'C') {
    return 'renamed'
  }
  if (index === 'A' || workingDir === 'A') return 'added'
  return 'modified'
}

async function doStatus(req: StatusReq): Promise<StatusRes> {
  const git = gitFor(req.cwd)
  const s = await git.status()
  const files = s.files.map((f) => {
    const index = f.index ?? ' '
    const workingDir = f.working_dir ?? ' '
    const staged = index !== ' ' && index !== '?'
    return {
      path: f.path,
      status: mapFileStatus(index, workingDir),
      staged,
    }
  })
  return {
    branch: s.current ?? null,
    upstream: s.tracking ?? null,
    ahead: s.ahead,
    behind: s.behind,
    files,
    isClean: s.isClean(),
  }
}

async function doLog(req: LogReq): Promise<LogRes> {
  const git = gitFor(req.cwd)
  const result = await git.log({ maxCount: req.maxCount })
  return {
    commits: result.all.map((c) => ({
      hash: c.hash,
      date: c.date,
      message: c.message,
      author: c.author_name,
      email: c.author_email,
    })),
  }
}

async function doDiff(req: DiffReq): Promise<DiffRes> {
  const git = gitFor(req.cwd)
  const args: string[] = []
  if (req.staged === true) args.push('--cached')
  if (req.revision !== null) args.push(req.revision)
  if (req.file !== null) {
    args.push('--', req.file)
  }
  const out = args.length > 0 ? await git.diff(args) : await git.diff()
  return { diff: out }
}

async function doBranches(req: BranchesReq): Promise<BranchesRes> {
  const git = gitFor(req.cwd)
  const b = await git.branch()
  return {
    current: b.current && b.current.length > 0 ? b.current : null,
    all: b.all,
  }
}

async function doCheckout(req: CheckoutReq): Promise<CheckoutRes> {
  const git = gitFor(req.cwd)
  await git.checkout(req.ref)
  return { ok: true as const }
}

async function doCommit(req: CommitReq): Promise<CommitRes> {
  const git = gitFor(req.cwd)
  if (req.files && req.files.length > 0) {
    await git.add(req.files)
  }
  const result = await git.commit(req.message)
  return { commitHash: result.commit }
}

async function dispatch(req: WorkerRequest): Promise<unknown> {
  switch (req.op) {
    case 'status':
      return doStatus(req.args as StatusReq)
    case 'log':
      return doLog(req.args as LogReq)
    case 'diff':
      return doDiff(req.args as DiffReq)
    case 'branches':
      return doBranches(req.args as BranchesReq)
    case 'checkout':
      return doCheckout(req.args as CheckoutReq)
    case 'commit':
      return doCommit(req.args as CommitReq)
    default: {
      const _exhaustive: never = req.op
      throw new Error(`[git-worker] unknown op: ${String(_exhaustive)}`)
    }
  }
}

port.on('message', (raw: WorkerRequest) => {
  void (async () => {
    try {
      const result = await dispatch(raw)
      const res: WorkerResponse = { id: raw.id, ok: true, result }
      port.postMessage(res)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const res: WorkerResponse = { id: raw.id, ok: false, error: message }
      port.postMessage(res)
    }
  })()
})

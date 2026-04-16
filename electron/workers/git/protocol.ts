/**
 * Wire protocol between the git channel handler (main process) and the git
 * worker_thread. Request/response with correlation IDs so a single worker can
 * multiplex many concurrent calls.
 */

export type GitOp =
  | 'status'
  | 'log'
  | 'diff'
  | 'branches'
  | 'checkout'
  | 'commit'

export interface WorkerRequest {
  id: string
  op: GitOp
  args: unknown
}

export type WorkerResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string }

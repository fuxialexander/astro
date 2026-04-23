import { z } from 'zod'

export const storageMountSchema = z.object({
  provider: z.enum(['s3', 'gcs']),
  accountId: z.string().uuid().optional(),
  uri: z.string().max(2000),
  path: z.string().max(500).regex(/^[a-zA-Z0-9._/-]+$/),
  access: z.enum(['staged', 'streaming']).default('staged'),
  mode: z.enum(['read', 'readwrite']),
  sync: z.enum(['start', 'finish', 'both']).optional(),
  formatHint: z.enum(['zarr', 'parquet', 'delta', 'iceberg', 'custom']).optional(),
})

export type StorageMount = z.infer<typeof storageMountSchema>

export function validateStorageMount(mount: StorageMount): { ok: true } | { ok: false; error: string } {
  if (mount.provider === 's3' && !/^s3:\/\/[^/]+\/?.*/.test(mount.uri)) {
    return { ok: false, error: 'S3 mounts must use an s3://bucket[/prefix] URI' }
  }
  if (mount.provider === 'gcs' && !/^gs:\/\/[^/]+\/?.*/.test(mount.uri)) {
    return { ok: false, error: 'GCS mounts must use a gs://bucket[/prefix] URI' }
  }
  if (mount.path.startsWith('/') || mount.path.includes('..') || mount.path.startsWith('.')) {
    return { ok: false, error: 'Mount path must be a relative workspace path without dot segments' }
  }
  if ((mount.sync ?? 'start') === 'finish' && mount.mode === 'read') {
    return { ok: false, error: 'Read-only mounts cannot sync only at finish' }
  }
  if (mount.access === 'streaming' && !mount.uri.endsWith('/') && mount.formatHint === 'zarr') {
    return { ok: false, error: 'Streaming Zarr mounts should reference a prefix URI ending in /' }
  }
  return { ok: true }
}

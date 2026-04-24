import { describe, expect, it } from 'vitest'
import { validateStorageMount } from '../server/lib/storage-mounts.js'

describe('storage mount validation', () => {
  it('accepts valid S3 and GCS staged mounts', () => {
    expect(validateStorageMount({
      provider: 's3',
      uri: 's3://bucket/prefix',
      path: 'inputs/data',
      mode: 'read',
      sync: 'start',
    })).toEqual({ ok: true })

    expect(validateStorageMount({
      provider: 'gcs',
      uri: 'gs://bucket/results',
      path: 'outputs',
      mode: 'readwrite',
      sync: 'both',
    })).toEqual({ ok: true })
  })

  it('rejects mismatched URI schemes and unsafe local paths', () => {
    expect(validateStorageMount({
      provider: 's3',
      uri: 'gs://bucket/prefix',
      path: 'inputs',
      mode: 'read',
      sync: 'start',
    })).toMatchObject({ ok: false })

    expect(validateStorageMount({
      provider: 'gcs',
      uri: 'gs://bucket/prefix',
      path: '../outside',
      mode: 'read',
      sync: 'start',
    })).toMatchObject({ ok: false })
  })

  it('rejects finish-only sync for read-only mounts', () => {
    expect(validateStorageMount({
      provider: 's3',
      uri: 's3://bucket/prefix',
      path: 'inputs',
      mode: 'read',
      sync: 'finish',
    })).toMatchObject({ ok: false })
  })

  it('accepts streaming mounts for cloud-native data formats', () => {
    expect(validateStorageMount({
      provider: 's3',
      uri: 's3://bucket/array.zarr/',
      path: 'inputs/array',
      access: 'streaming',
      mode: 'read',
      formatHint: 'zarr',
    })).toEqual({ ok: true })
  })

  it('requires streaming Zarr mounts to reference a prefix', () => {
    expect(validateStorageMount({
      provider: 'gcs',
      uri: 'gs://bucket/array.zarr',
      path: 'inputs/array',
      access: 'streaming',
      mode: 'read',
      formatHint: 'zarr',
    })).toMatchObject({ ok: false })
  })
})

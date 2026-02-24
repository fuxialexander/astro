/**
 * Unit tests for path-utils.ts
 *
 * Tests machine name handling in file URL construction:
 * - User-set name (SSH alias) preferred over system hostname
 * - Local vs remote URL generation
 * - Hostname normalization and comparison
 * - Path validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock fetch globally before importing the module
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
vi.stubGlobal('window', { location: { hostname: 'localhost' } })

import {
  validateAbsolutePath,
  isSameHostname,
  buildFileUrl,
  buildFileUrlSync,
  clearHostnameCache,
  getBrowserHostname,
  parseFileUrl,
} from '../path-utils'

describe('validateAbsolutePath', () => {
  it('accepts empty string', () => {
    expect(validateAbsolutePath('')).toEqual({ isValid: true })
    expect(validateAbsolutePath('  ')).toEqual({ isValid: true })
  })

  it('accepts absolute paths', () => {
    expect(validateAbsolutePath('/home/user/project')).toEqual({ isValid: true })
    expect(validateAbsolutePath('/Users/user/repos')).toEqual({ isValid: true })
  })

  it('rejects tilde paths', () => {
    const result = validateAbsolutePath('~/project')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('absolute path')
  })

  it('rejects relative paths', () => {
    expect(validateAbsolutePath('./src').isValid).toBe(false)
    expect(validateAbsolutePath('.').isValid).toBe(false)
    expect(validateAbsolutePath('../other').isValid).toBe(false)
    expect(validateAbsolutePath('some/path').isValid).toBe(false)
  })
})

describe('isSameHostname', () => {
  it('matches identical hostnames', () => {
    expect(isSameHostname('myhost', 'myhost')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isSameHostname('MyHost', 'myhost')).toBe(true)
  })

  it('treats localhost aliases as the same', () => {
    expect(isSameHostname('localhost', '127.0.0.1')).toBe(true)
    expect(isSameHostname('::1', 'localhost')).toBe(true)
    expect(isSameHostname('0.0.0.0', '127.0.0.1')).toBe(true)
  })

  it('strips .local suffix', () => {
    expect(isSameHostname('macbook.local', 'macbook')).toBe(true)
    expect(isSameHostname('MacBook.local', 'macbook')).toBe(true)
  })

  it('distinguishes different hosts', () => {
    expect(isSameHostname('host-a', 'host-b')).toBe(false)
  })
})

describe('buildFileUrl', () => {
  beforeEach(() => {
    clearHostnameCache()
    fetchMock.mockReset()
  })

  it('uses file:// when forceLocal is true', async () => {
    const url = await buildFileUrl('/home/user/file.ts', 42, { name: 'spe', hostname: 'remote-host' }, true)
    expect(url).toBe('cursor://file/home/user/file.ts:42')
  })

  it('uses file:// when no machine info', async () => {
    const url = await buildFileUrl('/path/to/file.ts', undefined, undefined)
    expect(url).toBe('cursor://file/path/to/file.ts')
  })

  it('uses user-set name (SSH alias) for remote URL', async () => {
    // Browser hostname fetch returns a different host
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ hostname: 'browser-host' }),
    })

    const url = await buildFileUrl(
      '/home/user/file.ts',
      10,
      { name: 'spe', hostname: 'xf2217-MS-7E70' },
    )
    expect(url).toBe('cursor://vscode-remote/ssh-remote+spe/home/user/file.ts:10')
  })

  it('falls back to hostname when no name set', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ hostname: 'browser-host' }),
    })

    const url = await buildFileUrl(
      '/home/user/file.ts',
      undefined,
      { hostname: 'remote-server' },
    )
    expect(url).toBe('cursor://vscode-remote/ssh-remote+remote-server/home/user/file.ts')
  })

  it('uses file:// when browser and agent are on same machine', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ hostname: 'my-machine' }),
    })

    const url = await buildFileUrl(
      '/home/user/file.ts',
      undefined,
      { name: 'alias', hostname: 'my-machine' },
    )
    expect(url).toBe('cursor://file/home/user/file.ts')
  })

  it('supports vscode editor type', async () => {
    const url = await buildFileUrl('/file.ts', undefined, undefined, true, 'vscode')
    expect(url).toBe('vscode://file/file.ts')
  })

  it('uses file:// when machine has name but no hostname (cannot determine same-machine)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ hostname: 'browser-host' }),
    })

    const url = await buildFileUrl(
      '/home/user/file.ts',
      undefined,
      { name: 'my-alias' },
    )
    // No hostname → isSameHostname can't match → remote URL with name
    expect(url).toBe('cursor://vscode-remote/ssh-remote+my-alias/home/user/file.ts')
  })
})

describe('buildFileUrlSync', () => {
  beforeEach(() => {
    clearHostnameCache()
    fetchMock.mockReset()
  })

  it('returns undefined when hostname not cached', () => {
    const url = buildFileUrlSync('/file.ts', undefined, { hostname: 'remote' })
    expect(url).toBeUndefined()
  })

  it('works after hostname is cached', async () => {
    // Prime the cache
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ hostname: 'browser-host' }),
    })
    await getBrowserHostname()

    const url = buildFileUrlSync(
      '/home/user/file.ts',
      5,
      { name: 'spe', hostname: 'xf2217-MS-7E70' },
    )
    expect(url).toBe('cursor://vscode-remote/ssh-remote+spe/home/user/file.ts:5')
  })

  it('uses file:// for forceLocal even without cache', () => {
    const url = buildFileUrlSync('/file.ts', undefined, { hostname: 'remote' }, true)
    expect(url).toBe('cursor://file/file.ts')
  })

  it('prefers name over hostname for remote URL', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ hostname: 'browser-host' }),
    })
    await getBrowserHostname()

    const url = buildFileUrlSync(
      '/path/file.ts',
      undefined,
      { name: 'my-ssh-alias', hostname: 'ugly-system-hostname-123' },
    )
    expect(url).toBe('cursor://vscode-remote/ssh-remote+my-ssh-alias/path/file.ts')
  })
})

describe('parseFileUrl', () => {
  it('parses file:// URLs', () => {
    const result = parseFileUrl('file:///home/user/file.ts:42:10')
    expect(result.protocol).toBe('file')
    expect(result.path).toBe('/home/user/file.ts')
    expect(result.line).toBe(42)
    expect(result.column).toBe(10)
  })

  it('parses ssh+remote URLs', () => {
    const result = parseFileUrl('ssh+remote://myhost/home/user/file.ts:10')
    expect(result.protocol).toBe('ssh+remote')
    expect(result.hostname).toBe('myhost')
    expect(result.path).toBe('/home/user/file.ts')
    expect(result.line).toBe(10)
  })

  it('returns unknown for unrecognized URLs', () => {
    const result = parseFileUrl('https://example.com')
    expect(result.protocol).toBe('unknown')
    expect(result.path).toBe('https://example.com')
  })
})

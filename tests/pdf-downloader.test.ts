import { describe, expect, it } from 'vitest'

import { __testOnly } from '@/lib/pdf-downloader'

describe('pdf-downloader', () => {
  describe('getDesktopDownloadHeaders', () => {
    const zoteroConfig = {
      libraryType: 'users' as const,
      libraryId: '12345',
      apiKey: 'secret-key',
    }

    it('adds Zotero auth headers for Zotero file downloads', () => {
      expect(
        __testOnly.getDesktopDownloadHeaders(
          'https://api.zotero.org/users/12345/items/ABCDE/file',
          zoteroConfig,
        ),
      ).toEqual({
        'Zotero-API-Key': 'secret-key',
        'Accept': 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
      })
    })

    it('does not add headers for non-Zotero downloads', () => {
      expect(
        __testOnly.getDesktopDownloadHeaders(
          'https://example.org/paper.pdf',
          zoteroConfig,
        ),
      ).toBeUndefined()
    })

    it('does not add headers without Zotero config', () => {
      expect(
        __testOnly.getDesktopDownloadHeaders(
          'https://api.zotero.org/users/12345/items/ABCDE/file',
        ),
      ).toBeUndefined()
    })
  })
})

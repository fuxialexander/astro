/**
 * Unit tests for github-skill-import.ts
 *
 * Tests GitHub SKILL.md fetching and parsing logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fetchSkillFromGitHub } from '../github-skill-import'

// Mock the skill parser
vi.mock('@astro/core/skill-parser', () => ({
  parseSkillMd: vi.fn(),
}))

import { parseSkillMd } from '@astro/core/skill-parser'

describe('fetchSkillFromGitHub', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn()
  })

  describe('URL parsing', () => {
    it('parses full https:// GitHub URLs', async () => {
      const mockFetch = vi.mocked(global.fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '---\nname: test\n---\nInstructions',
      } as Response)

      vi.mocked(parseSkillMd).mockReturnValueOnce({
        name: 'test',
        description: '',
        instructions: 'Instructions',
        source: 'user',
        enabled: true,
      })

      await fetchSkillFromGitHub('https://github.com/owner/repo')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/owner/repo/main/SKILL.md'
      )
    })

    it('parses github.com URLs without protocol', async () => {
      const mockFetch = vi.mocked(global.fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '---\nname: test\n---\nInstructions',
      } as Response)

      vi.mocked(parseSkillMd).mockReturnValueOnce({
        name: 'test',
        description: '',
        instructions: 'Instructions',
        source: 'user',
        enabled: true,
      })

      await fetchSkillFromGitHub('github.com/owner/repo')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/owner/repo/main/SKILL.md'
      )
    })

    it('parses owner/repo shorthand format', async () => {
      const mockFetch = vi.mocked(global.fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '---\nname: test\n---\nInstructions',
      } as Response)

      vi.mocked(parseSkillMd).mockReturnValueOnce({
        name: 'test',
        description: '',
        instructions: 'Instructions',
        source: 'user',
        enabled: true,
      })

      await fetchSkillFromGitHub('owner/repo')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/owner/repo/main/SKILL.md'
      )
    })

    it('handles trailing slashes and .git extension', async () => {
      const mockFetch = vi.mocked(global.fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '---\nname: test\n---\nInstructions',
      } as Response)

      vi.mocked(parseSkillMd).mockReturnValueOnce({
        name: 'test',
        description: '',
        instructions: 'Instructions',
        source: 'user',
        enabled: true,
      })

      await fetchSkillFromGitHub('https://github.com/owner/repo.git/')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/owner/repo/main/SKILL.md'
      )
    })

    it('throws error for invalid URL format', async () => {
      await expect(fetchSkillFromGitHub('invalid')).rejects.toThrow(
        'Invalid GitHub URL format'
      )
    })

    it('throws error for empty owner or repo', async () => {
      await expect(fetchSkillFromGitHub('owner/')).rejects.toThrow(
        'Invalid GitHub URL format'
      )
    })
  })

  describe('branch fallback', () => {
    it('tries main branch first', async () => {
      const mockFetch = vi.mocked(global.fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '---\nname: test\n---\nInstructions',
      } as Response)

      vi.mocked(parseSkillMd).mockReturnValueOnce({
        name: 'test',
        description: '',
        instructions: 'Instructions',
        source: 'user',
        enabled: true,
      })

      const result = await fetchSkillFromGitHub('owner/repo')

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/owner/repo/main/SKILL.md'
      )
      expect(result.config?.githubBranch).toBe('main')
    })

    it('falls back to master branch on 404', async () => {
      const mockFetch = vi.mocked(global.fetch)

      // First call (main branch) returns 404
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response)

      // Second call (master branch) succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '---\nname: test\n---\nInstructions',
      } as Response)

      vi.mocked(parseSkillMd).mockReturnValueOnce({
        name: 'test',
        description: '',
        instructions: 'Instructions',
        source: 'user',
        enabled: true,
      })

      const result = await fetchSkillFromGitHub('owner/repo')

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://raw.githubusercontent.com/owner/repo/main/SKILL.md'
      )
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://raw.githubusercontent.com/owner/repo/master/SKILL.md'
      )
      expect(result.config?.githubBranch).toBe('master')
    })

    it('throws error if both main and master return 404', async () => {
      const mockFetch = vi.mocked(global.fetch)

      // Both calls return 404
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      } as Response)

      await expect(fetchSkillFromGitHub('owner/repo')).rejects.toThrow(
        'SKILL.md not found in repository owner/repo'
      )

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('HTTP error handling', () => {
    it('handles non-404 HTTP errors', async () => {
      const mockFetch = vi.mocked(global.fetch)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response)

      await expect(fetchSkillFromGitHub('owner/repo')).rejects.toThrow(
        'Failed to fetch SKILL.md from owner/repo (main branch): 500 Internal Server Error'
      )
    })

    it('handles network errors', async () => {
      const mockFetch = vi.mocked(global.fetch)
      mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'))

      await expect(fetchSkillFromGitHub('owner/repo')).rejects.toThrow(
        'Network error while fetching SKILL.md from owner/repo'
      )
    })

    it('handles text parsing errors', async () => {
      const mockFetch = vi.mocked(global.fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi.fn().mockRejectedValueOnce(new Error('Failed to decode')),
      } as unknown as Response)

      await expect(fetchSkillFromGitHub('owner/repo')).rejects.toThrow(
        'Failed to read SKILL.md content from owner/repo'
      )
    })
  })

  describe('skill parsing', () => {
    it('returns parsed skill with GitHub metadata', async () => {
      const mockFetch = vi.mocked(global.fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          '---\nname: my-skill\ndescription: Test skill\n---\nInstructions here',
      } as Response)

      vi.mocked(parseSkillMd).mockReturnValueOnce({
        name: 'my-skill',
        description: 'Test skill',
        instructions: 'Instructions here',
        source: 'user',
        enabled: true,
      })

      const result = await fetchSkillFromGitHub('owner/repo')

      expect(parseSkillMd).toHaveBeenCalledWith(
        '---\nname: my-skill\ndescription: Test skill\n---\nInstructions here',
        'user'
      )
      expect(result).toEqual({
        name: 'my-skill',
        description: 'Test skill',
        instructions: 'Instructions here',
        source: 'user',
        enabled: true,
        homepage: 'https://github.com/owner/repo',
        config: {
          githubRepo: 'owner/repo',
          githubBranch: 'main',
        },
      })
    })

    it('throws error if parsing fails', async () => {
      const mockFetch = vi.mocked(global.fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'Invalid SKILL.md format',
      } as Response)

      vi.mocked(parseSkillMd).mockReturnValueOnce(null)

      await expect(fetchSkillFromGitHub('owner/repo')).rejects.toThrow(
        'Failed to parse SKILL.md from owner/repo'
      )
    })

    it('preserves existing config when adding GitHub metadata', async () => {
      const mockFetch = vi.mocked(global.fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '---\nname: test\n---\nInstructions',
      } as Response)

      vi.mocked(parseSkillMd).mockReturnValueOnce({
        name: 'test',
        description: '',
        instructions: 'Instructions',
        source: 'user',
        enabled: true,
        config: { existingKey: 'existingValue' },
      })

      const result = await fetchSkillFromGitHub('owner/repo')

      expect(result.config).toEqual({
        existingKey: 'existingValue',
        githubRepo: 'owner/repo',
        githubBranch: 'main',
      })
    })
  })
})

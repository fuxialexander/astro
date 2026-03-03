/**
 * Unit tests for github-skill-import.ts
 *
 * Tests GitHub SKILL.md fetching and parsing logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fetchSkillFromGitHub, parseGitHubUrl } from '../github-skill-import'

// Mock the skill parser
vi.mock('@astro/core/skill-parser', () => ({
  parseSkillMd: vi.fn(),
}))

import { parseSkillMd } from '@astro/core/skill-parser'

describe('parseGitHubUrl', () => {
  describe('basic formats', () => {
    it('parses owner/repo shorthand', () => {
      expect(parseGitHubUrl('owner/repo')).toEqual({ owner: 'owner', repo: 'repo' })
    })

    it('parses github.com/owner/repo', () => {
      expect(parseGitHubUrl('github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' })
    })

    it('parses https://github.com/owner/repo', () => {
      expect(parseGitHubUrl('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' })
    })

    it('handles trailing slashes', () => {
      expect(parseGitHubUrl('owner/repo/')).toEqual({ owner: 'owner', repo: 'repo' })
    })

    it('handles .git extension', () => {
      expect(parseGitHubUrl('owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' })
    })
  })

  describe('subfolder path formats', () => {
    it('parses owner/repo/path shorthand', () => {
      expect(parseGitHubUrl('owner/repo/skill-folder')).toEqual({
        owner: 'owner',
        repo: 'repo',
        path: 'skill-folder',
      })
    })

    it('parses owner/repo/nested/path shorthand', () => {
      expect(parseGitHubUrl('owner/repo/skills/my-skill')).toEqual({
        owner: 'owner',
        repo: 'repo',
        path: 'skills/my-skill',
      })
    })

    it('parses tree URL with branch and path', () => {
      expect(parseGitHubUrl('https://github.com/owner/repo/tree/main/skill-folder')).toEqual({
        owner: 'owner',
        repo: 'repo',
        branch: 'main',
        path: 'skill-folder',
        isDirectFile: false,
      })
    })

    it('parses tree URL with nested path', () => {
      expect(parseGitHubUrl('https://github.com/owner/repo/tree/dev/skills/agent-memory')).toEqual({
        owner: 'owner',
        repo: 'repo',
        branch: 'dev',
        path: 'skills/agent-memory',
        isDirectFile: false,
      })
    })

    it('parses blob URL pointing to SKILL.md', () => {
      expect(parseGitHubUrl('https://github.com/owner/repo/blob/main/skill-folder/SKILL.md')).toEqual({
        owner: 'owner',
        repo: 'repo',
        branch: 'main',
        path: 'skill-folder',
        isDirectFile: true,
      })
    })

    it('parses tree URL with branch only (no path)', () => {
      expect(parseGitHubUrl('https://github.com/owner/repo/tree/main')).toEqual({
        owner: 'owner',
        repo: 'repo',
        branch: 'main',
        path: undefined,
        isDirectFile: false,
      })
    })
  })

  describe('error cases', () => {
    it('throws for single segment', () => {
      expect(() => parseGitHubUrl('invalid')).toThrow('Invalid GitHub URL format')
    })

    it('throws for empty input', () => {
      expect(() => parseGitHubUrl('')).toThrow('Invalid GitHub URL format')
    })
  })
})

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

  describe('subfolder path support', () => {
    it('fetches from subfolder using owner/repo/path format', async () => {
      const mockFetch = vi.mocked(global.fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '---\nname: mcp-builder\n---\nInstructions',
      } as Response)

      vi.mocked(parseSkillMd).mockReturnValueOnce({
        name: 'mcp-builder',
        description: '',
        instructions: 'Instructions',
        source: 'user',
        enabled: true,
      })

      const result = await fetchSkillFromGitHub('ComposioHQ/awesome-claude-skills/mcp-builder')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/ComposioHQ/awesome-claude-skills/main/mcp-builder/SKILL.md'
      )
      expect(result.config?.githubPath).toBe('mcp-builder')
      expect(result.homepage).toBe('https://github.com/ComposioHQ/awesome-claude-skills/tree/main/mcp-builder')
    })

    it('fetches from nested subfolder path', async () => {
      const mockFetch = vi.mocked(global.fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '---\nname: agent-memory\n---\nInstructions',
      } as Response)

      vi.mocked(parseSkillMd).mockReturnValueOnce({
        name: 'agent-memory',
        description: '',
        instructions: 'Instructions',
        source: 'user',
        enabled: true,
      })

      const result = await fetchSkillFromGitHub('sickn33/antigravity-awesome-skills/skills/agent-memory-mcp')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/sickn33/antigravity-awesome-skills/main/skills/agent-memory-mcp/SKILL.md'
      )
      expect(result.config?.githubPath).toBe('skills/agent-memory-mcp')
    })

    it('fetches from tree URL with explicit branch', async () => {
      const mockFetch = vi.mocked(global.fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '---\nname: skill\n---\nInstructions',
      } as Response)

      vi.mocked(parseSkillMd).mockReturnValueOnce({
        name: 'skill',
        description: '',
        instructions: 'Instructions',
        source: 'user',
        enabled: true,
      })

      const result = await fetchSkillFromGitHub('https://github.com/owner/repo/tree/dev/my-skill')

      // Should use the explicit branch, not try main/master fallback
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/owner/repo/dev/my-skill/SKILL.md'
      )
      expect(result.config?.githubBranch).toBe('dev')
      expect(result.config?.githubPath).toBe('my-skill')
    })

    it('fetches from blob URL pointing to SKILL.md', async () => {
      const mockFetch = vi.mocked(global.fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '---\nname: skill\n---\nInstructions',
      } as Response)

      vi.mocked(parseSkillMd).mockReturnValueOnce({
        name: 'skill',
        description: '',
        instructions: 'Instructions',
        source: 'user',
        enabled: true,
      })

      await fetchSkillFromGitHub('https://github.com/owner/repo/blob/main/skills/my-skill/SKILL.md')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/owner/repo/main/skills/my-skill/SKILL.md'
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
        'SKILL.md not found at owner/repo'
      )

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('does not fallback when explicit branch is specified', async () => {
      const mockFetch = vi.mocked(global.fetch)

      // Single call returns 404
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response)

      await expect(
        fetchSkillFromGitHub('https://github.com/owner/repo/tree/custom-branch/skill-folder')
      ).rejects.toThrow('SKILL.md not found at owner/repo/skill-folder (custom-branch branch)')

      // Should only try once since branch is explicit
      expect(mockFetch).toHaveBeenCalledTimes(1)
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

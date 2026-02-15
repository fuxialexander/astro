/**
 * MCP Loader Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { loadMcpConfig, processAllowedDirectories, mergeAllowedTools } from '../mcp-loader.js'

describe('MCP Loader', () => {
  const testDir = join(__dirname, '.test-tmp')

  beforeEach(() => {
    // Create test directory
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up test directory
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('loadMcpConfig', () => {
    it('should return undefined if .mcp.json does not exist', () => {
      const result = loadMcpConfig(testDir)
      expect(result).toBeUndefined()
    })

    it('should load MCP servers from .mcp.json', () => {
      const mcpConfig = {
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['server.js'],
          },
        },
      }

      writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(mcpConfig))

      const result = loadMcpConfig(testDir)
      expect(result).toEqual(mcpConfig.mcpServers)
    })

    it('should return undefined if .mcp.json has no servers', () => {
      writeFileSync(join(testDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }))

      const result = loadMcpConfig(testDir)
      expect(result).toBeUndefined()
    })

    it('should handle invalid JSON gracefully', () => {
      writeFileSync(join(testDir, '.mcp.json'), 'invalid json')

      const result = loadMcpConfig(testDir)
      expect(result).toBeUndefined()
    })
  })

  describe('processAllowedDirectories', () => {
    it('should convert directories to Read(**) patterns', () => {
      const directories = ['/path/to/project', 'relative/path']
      const result = processAllowedDirectories(directories)

      expect(result).toEqual([
        'Read(//path/to/project/**)',
        'Read(relative/path/**)',
      ])
    })

    it('should handle absolute paths with double slash', () => {
      const directories = ['/absolute/path']
      const result = processAllowedDirectories(directories)

      expect(result).toEqual(['Read(//absolute/path/**)'])
    })

    it('should handle relative paths without slash', () => {
      const directories = ['relative']
      const result = processAllowedDirectories(directories)

      expect(result).toEqual(['Read(relative/**)'])
    })
  })

  describe('mergeAllowedTools', () => {
    it('should merge explicit tools with directory patterns', () => {
      const allowedTools = ['Bash', 'Write']
      const allowedDirectories = ['/project']

      const result = mergeAllowedTools(allowedTools, allowedDirectories)

      expect(result).toEqual([
        'Bash',
        'Write',
        'Read(//project/**)',
      ])
    })

    it('should return only directory patterns if no explicit tools', () => {
      const result = mergeAllowedTools(undefined, ['/project'])

      expect(result).toEqual(['Read(//project/**)'])
    })

    it('should return only explicit tools if no directories', () => {
      const result = mergeAllowedTools(['Bash'], undefined)

      expect(result).toEqual(['Bash'])
    })

    it('should return undefined if both are empty', () => {
      const result = mergeAllowedTools(undefined, undefined)

      expect(result).toBeUndefined()
    })
  })
})

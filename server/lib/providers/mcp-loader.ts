/**
 * MCP Configuration Loader
 *
 * Auto-loads .mcp.json from working directory for Claude SDK.
 * Pattern from Cyrus claude-runner/src/ClaudeRunner.ts
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'

/**
 * Load MCP configuration from .mcp.json in working directory
 * @param workingDirectory - Directory to search for .mcp.json
 * @returns MCP server configuration or undefined if not found
 */
export function loadMcpConfig(workingDirectory: string): Record<string, McpServerConfig> | undefined {
  const mcpConfigPath = join(workingDirectory, '.mcp.json')

  if (!existsSync(mcpConfigPath)) {
    console.log(`[mcp-loader] No .mcp.json found in ${workingDirectory}`)
    return undefined
  }

  try {
    const configContent = readFileSync(mcpConfigPath, 'utf-8')
    const config = JSON.parse(configContent) as {
      mcpServers?: Record<string, McpServerConfig>
    }

    if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
      console.log(`[mcp-loader] .mcp.json found but contains no MCP servers`)
      return undefined
    }

    console.log(`[mcp-loader] Loaded ${Object.keys(config.mcpServers).length} MCP servers from .mcp.json`)
    return config.mcpServers
  } catch (error) {
    console.error(`[mcp-loader] Failed to parse .mcp.json:`, error)
    return undefined
  }
}

/**
 * Process allowedDirectories into Read(**) patterns for Claude SDK
 * Pattern from Cyrus: allowedDirectories → Read(path/**) tool patterns
 *
 * @param allowedDirectories - List of directories to allow
 * @returns Array of tool patterns
 */
export function processAllowedDirectories(allowedDirectories: string[]): string[] {
  return allowedDirectories.map((dir) => {
    // Add extra / prefix for absolute paths (Claude Code requirement)
    // See: https://docs.anthropic.com/en/docs/claude-code/settings#read-%26-edit
    const prefixedPath = dir.startsWith('/') ? `/${dir}` : dir
    return `Read(${prefixedPath}/**)`
  })
}

/**
 * Merge allowedTools with directory patterns
 * @param allowedTools - Explicit allowed tools
 * @param allowedDirectories - Directories to allow (converted to Read patterns)
 * @returns Combined array of allowed tools
 */
export function mergeAllowedTools(
  allowedTools?: string[],
  allowedDirectories?: string[]
): string[] | undefined {
  const directoryTools = allowedDirectories ? processAllowedDirectories(allowedDirectories) : []
  const explicitTools = allowedTools ?? []

  const merged = [...explicitTools, ...directoryTools]
  return merged.length > 0 ? merged : undefined
}

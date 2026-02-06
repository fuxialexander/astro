/**
 * Agent provider detection and management
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { access, constants, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ProviderInfo, ProviderType, ProviderCapabilities } from '../types.js';

const execAsync = promisify(exec);

/**
 * Check if a command exists in PATH
 */
async function commandExists(command: string): Promise<boolean> {
  try {
    const platform = process.platform;
    const checkCommand = platform === 'win32' ? `where ${command}` : `which ${command}`;
    await execAsync(checkCommand, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a file exists and is executable
 */
async function fileExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the version of a command
 */
async function getCommandVersion(command: string, versionArg = '--version'): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`${command} ${versionArg}`, { timeout: 5000 });
    // Extract version number from output
    const versionMatch = stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
    return versionMatch?.[1] ?? stdout.trim().split('\n')[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the path of a command
 */
async function getCommandPath(command: string): Promise<string | null> {
  try {
    const platform = process.platform;
    const whichCommand = platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execAsync(`${whichCommand} ${command}`, { timeout: 5000 });
    return stdout.trim().split('\n')[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Detect Claude Code installation
 */
async function detectClaudeCode(): Promise<ProviderInfo | null> {
  // Check for 'claude' command (Claude Code CLI)
  const exists = await commandExists('claude');
  if (!exists) {
    return null;
  }

  const path = await getCommandPath('claude');
  const version = await getCommandVersion('claude', '--version');

  return {
    type: 'claude-code',
    name: 'Claude Code',
    version,
    path: path ?? 'claude',
    available: true,
    capabilities: {
      streaming: true,
      tools: true,
      multiTurn: true,
      maxConcurrentTasks: 1, // Claude Code runs one task at a time per instance
    },
  };
}

/**
 * Detect OpenAI Codex CLI installation
 */
async function detectCodex(): Promise<ProviderInfo | null> {
  // Check for 'codex' command
  const exists = await commandExists('codex');
  if (!exists) {
    return null;
  }

  const path = await getCommandPath('codex');
  const version = await getCommandVersion('codex', '--version');

  return {
    type: 'codex',
    name: 'OpenAI Codex',
    version,
    path: path ?? 'codex',
    available: true,
    capabilities: {
      streaming: true,
      tools: true,
      multiTurn: true,
      maxConcurrentTasks: 1,
    },
  };
}

/**
 * Check for custom provider configuration
 */
async function detectCustomProviders(): Promise<ProviderInfo[]> {
  const configPath = join(homedir(), '.nexus', 'providers.json');

  try {
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as CustomProviderConfig[];
    const providers: ProviderInfo[] = [];

    for (const provider of config) {
      const executable = await fileExecutable(provider.path);

      providers.push({
        type: 'custom',
        name: provider.name,
        version: provider.version ?? null,
        path: provider.path,
        available: executable,
        capabilities: provider.capabilities ?? {
          streaming: false,
          tools: false,
          multiTurn: false,
          maxConcurrentTasks: 1,
        },
      });
    }

    return providers;
  } catch {
    // No custom provider config or invalid config
    return [];
  }
}

interface CustomProviderConfig {
  name: string;
  path: string;
  version?: string;
  capabilities?: ProviderCapabilities;
}

/**
 * Detect all available providers on the system
 */
export async function detectProviders(): Promise<ProviderInfo[]> {
  const detectionResults = await Promise.all([
    detectClaudeCode(),
    detectCodex(),
    detectCustomProviders(),
  ]);

  const providers: ProviderInfo[] = [];

  // Add built-in providers if detected
  const [claudeCode, codex, customProviders] = detectionResults;

  if (claudeCode) {
    providers.push(claudeCode);
  }

  if (codex) {
    providers.push(codex);
  }

  // Add custom providers
  providers.push(...customProviders);

  return providers;
}

/**
 * Get a specific provider by type
 */
export async function getProvider(type: ProviderType): Promise<ProviderInfo | null> {
  const providers = await detectProviders();
  return providers.find((p) => p.type === type) ?? null;
}

/**
 * Check if a specific provider is available
 */
export async function isProviderAvailable(type: ProviderType): Promise<boolean> {
  const provider = await getProvider(type);
  return provider?.available ?? false;
}

/**
 * Format provider info for display
 */
export function formatProviderInfo(provider: ProviderInfo): string {
  const status = provider.available ? '✓' : '✗';
  const version = provider.version ? `v${provider.version}` : 'unknown version';
  return `${status} ${provider.name} (${version}) - ${provider.path}`;
}

/**
 * Format all providers summary
 */
export function formatProvidersSummary(providers: ProviderInfo[]): string {
  if (providers.length === 0) {
    return 'No agent providers detected. Install Claude Code or Codex to get started.';
  }

  const lines = ['Detected Agent Providers:', ''];

  for (const provider of providers) {
    lines.push(`  ${formatProviderInfo(provider)}`);
    lines.push(`    Capabilities: streaming=${provider.capabilities.streaming}, tools=${provider.capabilities.tools}, maxTasks=${provider.capabilities.maxConcurrentTasks}`);
  }

  return lines.join('\n');
}

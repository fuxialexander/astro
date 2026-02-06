/**
 * Agent Configuration
 *
 * Handles loading and saving agent configuration.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import dotenv from 'dotenv'

// Load .env file if present
dotenv.config()

export interface AgentConfig {
  relayUrl?: string
  machineName?: string
  authToken?: string
  machineId?: string
}

const CONFIG_DIR = path.join(os.homedir(), '.nexus')
const CONFIG_FILE = path.join(CONFIG_DIR, 'agent.json')

/**
 * Load configuration from file and environment
 */
export async function loadConfig(configPath?: string): Promise<AgentConfig> {
  const config: AgentConfig = {
    relayUrl: process.env.NEXUS_RELAY_URL,
    machineName: process.env.NEXUS_MACHINE_NAME || process.env.HOSTNAME || os.hostname(),
    authToken: process.env.NEXUS_AUTH_TOKEN,
  }

  // Try to load from file
  const filePath = configPath || CONFIG_FILE
  try {
    const data = await fs.readFile(filePath, 'utf-8')
    const fileConfig = JSON.parse(data)
    Object.assign(config, fileConfig)
  } catch (error) {
    // File doesn't exist or is invalid, use defaults
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`Warning: Could not parse config file: ${filePath}`)
    }
  }

  return config
}

/**
 * Save configuration to file
 */
export async function saveConfig(config: AgentConfig, configPath?: string): Promise<void> {
  const filePath = configPath || CONFIG_FILE

  // Ensure directory exists
  await fs.mkdir(CONFIG_DIR, { recursive: true })

  // Write config
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * Generate a unique machine ID
 */
export function generateMachineId(): string {
  const hostname = os.hostname()
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${hostname}-${timestamp}-${random}`
}

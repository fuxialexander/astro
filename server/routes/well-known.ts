import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const wellKnownRoute = new Hono()

// Serve apple-app-site-association for passkey sync
wellKnownRoute.get('/apple-app-site-association', (c) => {
  try {
    const filePath = join(__dirname, '../../public/.well-known/apple-app-site-association')
    const content = readFileSync(filePath, 'utf-8')

    return c.json(JSON.parse(content), 200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    })
  } catch (error) {
    console.error('[well-known] Failed to serve apple-app-site-association:', error)
    return c.json({ error: 'File not found' }, 404)
  }
})

// Machine-readable discovery manifest for AI agents (issue #897)
wellKnownRoute.get('/astro.json', (c) => {
  const manifest = {
    name: 'Astro',
    description: 'Planning-first platform for complex task orchestration across local, HPC, and cloud environments',
    version: '1.0',
    capabilities: [
      'plan-generation',
      'multi-env-dispatch',
      'hpc-slurm',
      'compute-registration',
      'mcp-tools',
      'streaming-execution',
      'branch-pruning',
      'tiered-verification',
    ],
    getting_started: {
      summary: 'Ask your human to install astro-cli and log in. Then you can use the CLI or MCP tools directly.',
      steps: [
        'Human installs: npm install -g @astroanywhere/cli',
        'Human authenticates: astro-cli auth login (opens browser for passkey)',
        'Agent uses: astro-cli <command> or MCP tools via astro-agent mcp',
      ],
      docs: '/api/docs/agent-quickstart',
    },
    cli: {
      package: '@astroanywhere/cli',
      binary: 'astro-cli',
      commands: [
        'astro-cli project create <name>',
        'astro-cli plan generate --goal "<goal>"',
        'astro-cli task dispatch <node-id>',
        'astro-cli task status <node-id>',
        'astro-cli machine register',
      ],
    },
    mcp: {
      package: '@astroanywhere/agent',
      binary: 'astro-agent mcp',
      transport: 'stdio',
      tool_count: 17,
      tools: [
        'ask_user_question',
        'query_plan',
        'create_task',
        'update_task',
        'create_dependency',
        'delete_task',
        'query_projects',
        'get_project',
        'create_project',
        'update_project',
        'query_initiatives',
        'create_initiative',
        'update_initiative',
        'get_user_profile',
        'query_executions',
        'store_knowledge',
        'query_knowledge',
      ],
    },
    auth: {
      method: 'device-auth',
      protocol: 'RFC 8628 (OAuth2 Device Authorization Grant)',
      note: 'Authentication requires human biometric (passkey). Agents cannot self-register.',
    },
    advanced: {
      separate_account: 'If you want your agent\'s work separated from your human\'s tasks, ask them to register a second account with a different email.',
      remote_agents: 'For agents on remote machines, use the device auth flow: astro-cli auth login (displays a code for the human to approve).',
    },
  }

  return c.json(manifest, 200, {
    'Cache-Control': 'public, max-age=3600',
  })
})

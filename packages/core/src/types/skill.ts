/**
 * OpenClaw-compatible skill types
 *
 * Skills are agent-level extensions that inject instructions into AI agent prompts
 * during task execution. They follow the OpenClaw SKILL.md format for compatibility
 * with ClawHub's 5,700+ skill ecosystem.
 */

export interface SkillInstaller {
  id: string
  kind: 'brew' | 'node' | 'go' | 'uv' | 'download'
  formula?: string
  bins?: string[]
  label: string
  os?: string[]
  url?: string
}

export interface OpenClawSkillMetadata {
  openclaw?: {
    always?: boolean
    emoji?: string
    os?: ('darwin' | 'linux' | 'win32')[]
    requires?: {
      bins?: string[]       // all must exist on PATH
      anyBins?: string[]    // at least one must exist
      env?: string[]        // env vars must be set
      config?: string[]     // config paths must be truthy
    }
    primaryEnv?: string     // convenience env var for apiKey
    skillKey?: string       // config key override
    install?: SkillInstaller[]
  }
}

export interface OpenClawSkill {
  name: string
  description: string
  instructions: string                    // markdown body (injected into agent prompt)
  userInvocable?: boolean                 // expose as slash command (default true)
  disableModelInvocation?: boolean        // exclude from auto-injection (default false)
  commandDispatch?: 'tool'               // direct tool invocation mode
  commandTool?: string                   // tool name for direct dispatch
  homepage?: string
  metadata?: OpenClawSkillMetadata

  // Astro-specific extensions
  source: 'builtin' | 'workspace' | 'clawhub' | 'plugin' | 'user'
  pluginId?: string                       // which plugin contributed this skill
  enabled: boolean
  config?: Record<string, unknown>        // per-skill config (env overrides, apiKey, etc.)
}

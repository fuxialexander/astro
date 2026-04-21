import { z } from 'zod'

export const setupStatus = {
  req: z.object({}),
  res: z.object({
    installed: z.boolean(),
    binDir: z.string(),
    agentPath: z.string().nullable(),
    cliPath: z.string().nullable(),
    pathConfigured: z.boolean(),
  }),
}

export const setup = {
  req: z.object({}),
  res: z.object({
    ok: z.literal(true),
    agentPath: z.string(),
    cliPath: z.string(),
    binDir: z.string(),
    shellProfilesUpdated: z.array(z.string()),
  }),
}

export const binaryPaths = {
  req: z.object({}),
  res: z.object({
    bundledAgentPath: z.string(),
    bundledCliPath: z.string(),
    installedAgentPath: z.string().nullable(),
    installedCliPath: z.string().nullable(),
  }),
}

export const channels = {
  'agent:setup-status': setupStatus,
  'agent:setup': setup,
  'agent:binary-paths': binaryPaths,
} as const

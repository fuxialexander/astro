import { z } from 'zod'

const providerDetection = z.object({
  detected: z.boolean(),
  profiles: z.array(z.string()).optional(),
  defaultRegion: z.string().nullable().optional(),
  project: z.string().nullable().optional(),
  account: z.string().nullable().optional(),
  source: z.enum(['env', 'credentials-file', 'config-file', 'adc-file', 'none']),
})

export const detect = {
  req: z.object({}),
  res: z.object({
    aws: providerDetection,
    gcp: providerDetection,
  }),
}

export const channels = {
  'cloud-creds:detect': detect,
} as const

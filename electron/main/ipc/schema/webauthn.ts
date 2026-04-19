import { z } from 'zod'

const base64url = z.string()

// Minimal subset of PublicKeyCredentialCreationOptions / RequestOptions
// that flows over IPC — complex nested types use z.unknown() for flexibility.
export const create = {
  req: z.object({
    rp: z.object({ name: z.string(), id: z.string().optional() }),
    user: z.object({ id: base64url, name: z.string(), displayName: z.string() }),
    challenge: base64url,
    pubKeyCredParams: z.array(z.object({ type: z.string(), alg: z.number() })),
    timeout: z.number().optional(),
    excludeCredentials: z.array(z.unknown()).optional(),
    authenticatorSelection: z.unknown().optional(),
    extensions: z.unknown().optional(),
  }),
  res: z.unknown(),
}

export const get = {
  req: z.object({
    challenge: base64url,
    rpId: z.string().optional(),
    allowCredentials: z.array(z.unknown()).optional(),
    timeout: z.number().optional(),
    userVerification: z.string().optional(),
    extensions: z.unknown().optional(),
  }),
  res: z.unknown(),
}

export const isAvailable = {
  req: z.object({}),
  res: z.object({ available: z.boolean() }),
}

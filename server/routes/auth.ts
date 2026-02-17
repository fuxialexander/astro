/**
 * Auth Routes — WebAuthn/Passkey Authentication
 *
 * Implements passkey registration and authentication using @simplewebauthn/server.
 * Both web (navigator.credentials) and iOS (ASAuthorizationController) use these endpoints.
 *
 * Flow:
 * 1. Register: generateRegistrationOptions → verifyRegistrationResponse → create user + store credential
 * 2. Login: generateAuthenticationOptions → verifyAuthenticationResponse → return session tokens
 */

import { Hono } from 'hono'
import { rateLimiter } from 'hono-rate-limiter'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server'
import { getServiceClient, shouldUseSupabase } from '../lib/supabase.js'
import { errorMessage } from '../lib/error-utils.js'

const authRoute = new Hono()

// Configuration from environment
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Nexus'
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost'
const ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:5173'

// Security configuration
const CHALLENGE_TTL_MS = parseInt(process.env.CHALLENGE_TTL_MS || '300000') // 5 minutes default
const SESSION_VERIFY_DELAY_MS = parseInt(process.env.SESSION_VERIFY_DELAY_MS || '100') // 100ms default
const CLEANUP_INTERVAL_MS = parseInt(process.env.CLEANUP_INTERVAL_MS || '60000') // 1 minute default

// Rate limiting: Prevent enumeration and DoS attacks
const authLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // Max 10 requests per windowMs per IP
  standardHeaders: 'draft-6',
  keyGenerator: (c) => c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
})

// In-memory challenge store (short-lived, per-request)
// In production, use Redis or a database with TTL
const challengeStore = new Map<string, { challenge: string; expiresAt: number }>()

function storeChallenge(key: string, challenge: string) {
  challengeStore.set(key, {
    challenge,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  })
}

function getChallenge(key: string): string | null {
  const entry = challengeStore.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    challengeStore.delete(key)
    return null
  }
  challengeStore.delete(key) // One-time use
  return entry.challenge
}

// Periodic cleanup of expired challenges
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of challengeStore) {
    if (now > entry.expiresAt) challengeStore.delete(key)
  }
}, CLEANUP_INTERVAL_MS)

/**
 * POST /api/auth/webauthn/check-user
 *
 * Check if a user exists with the given email.
 * Rate limited to prevent user enumeration attacks.
 */
authRoute.post('/webauthn/check-user', authLimiter, async (c) => {
  if (!shouldUseSupabase()) {
    return c.json({ error: 'Supabase not configured' }, 503)
  }

  const { email } = await c.req.json<{ email: string }>()

  if (!email) {
    return c.json({ error: 'Email is required' }, 400)
  }

  const supabase = getServiceClient()
  const { data: existingUsers } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('email', email)
    .limit(1)

  return c.json({
    exists: !!(existingUsers && existingUsers.length > 0),
  })
})

/**
 * POST /api/auth/webauthn/register-options
 *
 * Generate registration options for a new passkey.
 * Rate limited to prevent DoS attacks.
 */
authRoute.post('/webauthn/register-options', authLimiter, async (c) => {
  if (!shouldUseSupabase()) {
    return c.json({ error: 'Supabase not configured' }, 503)
  }

  const { email, name } = await c.req.json<{ email: string; name?: string }>()

  if (!email) {
    return c.json({ error: 'Email is required' }, 400)
  }

  // Check if user already exists
  const supabase = getServiceClient()
  const { data: existingUsers } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('email', email)
    .limit(1)

  // Get existing credentials to exclude
  let existingCredentials: Array<{ id: string; transports?: string[] }> = []
  if (existingUsers && existingUsers.length > 0) {
    const userId = existingUsers[0].id
    const { data: creds } = await supabase
      .from('passkey_credentials')
      .select('id, transports')
      .eq('user_id', userId)

    if (creds) {
      existingCredentials = creds.map((cred) => ({
        id: cred.id,
        transports: cred.transports as AuthenticatorTransport[] | undefined,
      }))
    }
  }

  const userId = existingUsers?.[0]?.id || `pending-${Date.now()}`

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: email,
    userDisplayName: name || email,
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    excludeCredentials: existingCredentials.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
    authenticatorSelection: {
      authenticatorAttachment: 'platform', // REQUIRE platform authenticator (Face ID/Touch ID/Windows Hello)
      residentKey: 'preferred', // Prefer discoverable credentials for better UX
      userVerification: 'required', // REQUIRE biometric/PIN verification
    },
  })

  // Store challenge for verification
  storeChallenge(`reg:${email}`, options.challenge)

  return c.json({
    options,
    email,
    existingUser: !!(existingUsers && existingUsers.length > 0),
  })
})

/**
 * POST /api/auth/webauthn/register-verify
 *
 * Verify registration attestation and create/update user.
 */
authRoute.post('/webauthn/register-verify', async (c) => {
  if (!shouldUseSupabase()) {
    return c.json({ error: 'Supabase not configured' }, 503)
  }

  const { email, name, credential } = await c.req.json<{
    email: string
    name?: string
    credential: RegistrationResponseJSON
  }>()

  const expectedChallenge = getChallenge(`reg:${email}`)
  if (!expectedChallenge) {
    return c.json({ error: 'Challenge expired or not found' }, 400)
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    })

    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ error: 'Verification failed' }, 400)
    }

    const { credential: regCredential, credentialDeviceType } = verification.registrationInfo
    const supabase = getServiceClient()

    // Create or get existing user
    let userId: string

    const { data: existingUsers } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('email', email)
      .limit(1)

    if (existingUsers && existingUsers.length > 0) {
      userId = existingUsers[0].id
    } else {
      // Create user in Supabase Auth
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { name: name || email },
      })

      if (authError || !authUser.user) {
        console.error('[auth] Failed to create user:', authError)
        return c.json({ error: `Failed to create user: ${authError?.message || 'unknown error'}` }, 500)
      }

      userId = authUser.user.id

      // Note: User profile is auto-created by Postgres trigger (handle_new_user)
      // from supabase/migrations/20260209000000_initial_schema.sql
      // Wait briefly for trigger to complete
      await new Promise(resolve => setTimeout(resolve, SESSION_VERIFY_DELAY_MS))

      // Verify profile was created successfully
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('id', userId)
        .single()

      if (profileError || !profile) {
        console.error('[auth] User profile creation failed:', profileError)
        // Clean up auth user if profile creation failed
        await supabase.auth.admin.deleteUser(userId)
        return c.json({ error: 'Failed to create user profile' }, 500)
      }
    }

    // Store passkey credential (as base64 for bytea column)
    const { error: credError } = await supabase.from('passkey_credentials').insert({
      id: regCredential.id,
      user_id: userId,
      public_key: Buffer.from(regCredential.publicKey).toString('base64'),
      counter: regCredential.counter,
      transports: credential.response.transports,
      device_name: credentialDeviceType || 'passkey',
    })

    if (credError) {
      return c.json({ error: 'Failed to store credential' }, 500)
    }

    // Generate session tokens
    const { data: session, error: sessionError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })

    if (sessionError) {
      console.error('[auth] Session generation failed:', sessionError)
      // Fallback: create session directly
      const { data: signIn } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: ORIGIN },
      })

      console.log('[auth] Registration successful, user:', userId)

      return c.json({
        verified: true,
        userId,
        session: signIn,
      })
    }

    console.log('[auth] Registration successful, user:', userId)

    return c.json({
      verified: true,
      userId,
      session,
    })
  } catch (err) {
    const message = errorMessage(err)
    return c.json({ error: message }, 500)
  }
})

/**
 * POST /api/auth/webauthn/login-options
 *
 * Generate authentication options for passkey login.
 * Rate limited to prevent DoS attacks.
 */
authRoute.post('/webauthn/login-options', authLimiter, async (c) => {
  if (!shouldUseSupabase()) {
    return c.json({ error: 'Supabase not configured' }, 503)
  }

  const { email } = await c.req.json<{ email?: string }>()

  const supabase = getServiceClient()
  let allowCredentials: Array<{ id: string; transports?: string[] }> = []

  if (email) {
    // Get user's credentials
    const { data: users } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('email', email)
      .limit(1)

    if (users && users.length > 0) {
      const { data: creds } = await supabase
        .from('passkey_credentials')
        .select('id, transports')
        .eq('user_id', users[0].id)

      if (creds) {
        allowCredentials = creds.map((cred) => ({
          id: cred.id,
          transports: cred.transports as AuthenticatorTransport[] | undefined,
        }))
      }
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: allowCredentials.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
    userVerification: 'required', // REQUIRE biometric/PIN verification (no QR code fallback)
  })

  // Store challenge
  const challengeKey = email ? `auth:${email}` : `auth:${options.challenge}`
  storeChallenge(challengeKey, options.challenge)

  return c.json({ options, challengeKey })
})

/**
 * POST /api/auth/webauthn/login-verify
 *
 * Verify authentication assertion and return session tokens.
 */
authRoute.post('/webauthn/login-verify', async (c) => {
  if (!shouldUseSupabase()) {
    return c.json({ error: 'Supabase not configured' }, 503)
  }

  const { credential, challengeKey } = await c.req.json<{
    credential: AuthenticationResponseJSON
    challengeKey: string
  }>()

  const expectedChallenge = getChallenge(challengeKey)
  if (!expectedChallenge) {
    return c.json({ error: 'Challenge expired or not found' }, 400)
  }

  const supabase = getServiceClient()

  // Look up the credential
  const { data: storedCred, error: credError } = await supabase
    .from('passkey_credentials')
    .select('*')
    .eq('id', credential.id)
    .single()

  if (credError) {
    console.error('[auth] Failed to fetch credential:', credError)
    return c.json({ error: `Database error: ${credError.message}` }, 500)
  }

  if (!storedCred) {
    return c.json({ error: 'Credential not found' }, 400)
  }

  try {
    // Public key is stored as base64 text
    const publicKeyBuffer = Buffer.from(storedCred.public_key, 'base64')
    console.log('[auth] Decoded public key, length:', publicKeyBuffer.length)

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: storedCred.id,
        publicKey: new Uint8Array(publicKeyBuffer),
        counter: storedCred.counter,
        transports: storedCred.transports as AuthenticatorTransport[] | undefined,
      },
    })

    if (!verification.verified) {
      return c.json({ error: 'Verification failed' }, 400)
    }

    // Update credential counter
    await supabase
      .from('passkey_credentials')
      .update({
        counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', credential.id)

    // Get user info
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', storedCred.user_id)
      .single()

    // Generate Supabase session via admin
    const { data: authUser } = await supabase.auth.admin.getUserById(storedCred.user_id)

    if (!authUser?.user?.email) {
      return c.json({ error: 'User not found' }, 500)
    }

    // Generate a magic link token that the client can exchange for a session
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: authUser.user.email,
    })

    if (linkError) {
      console.error('[auth] Failed to generate magic link:', linkError)
      return c.json({ error: 'Failed to generate session' }, 500)
    }

    console.log('[auth] Login successful for user:', storedCred.user_id)

    return c.json({
      verified: true,
      userId: storedCred.user_id,
      user: userProfile,
      session: linkData,
    })
  } catch (err) {
    const message = errorMessage(err)
    console.error('[auth] Login verification failed:', err)
    return c.json({ error: message }, 500)
  }
})

/**
 * GET /api/auth/session

/**
 * GET /api/auth/session
 *
 * Check current session status.
 */
authRoute.get('/session', async (c) => {
  if (!shouldUseSupabase()) {
    return c.json({
      authenticated: true,
      user: { id: '00000000-0000-0000-0000-000000000000', email: 'dev@localhost' },
      mode: 'development',
    })
  }

  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ authenticated: false }, 401)
  }

  const token = authHeader.slice(7)

  // Test token bypass for e2e testing (only in development)
  if (process.env.NODE_ENV !== 'production' && token === 'test-e2e-token') {
    return c.json({
      authenticated: true,
      user: { id: '00000000-0000-0000-0000-000000000000', email: 'dev@localhost' },
      mode: 'test',
    })
  }

  try {
    const supabase = getServiceClient()

    // Validate the JWT token (not getUserById - that expects a UUID, not a JWT)
    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      console.error('[auth] Token validation failed:', error?.message || 'No user')
      return c.json({ authenticated: false }, 401)
    }

    return c.json({
      authenticated: true,
      user: { id: user.id, email: user.email },
    })
  } catch (err) {
    console.error('[auth] Session check error:', err)
    return c.json({ authenticated: false, error: 'Authentication failed' }, 401)
  }
})

export { authRoute }

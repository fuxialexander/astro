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
import { getServiceClient } from '../lib/supabase.js'
import { isLocalMode } from '../lib/app-mode.js'
import { errorMessage } from '../lib/error-utils.js'
import { ensureUserProfile } from '../lib/ensure-user-profile.js'
import { storeChallenge, getAndDeleteChallenge } from '../lib/challenge-store.js'

const authRoute = new Hono()

// Configuration from environment.
// CRITICAL: RP_ID and ORIGIN must match the FRONTEND domain (where the browser
// runs the WebAuthn ceremony), NOT the backend domain. If WEBAUTHN_* vars are
// not set, derive from CORS_ORIGIN / FRONTEND_URL (which point to the frontend).
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Astro'

function resolveWebAuthnConfig() {
  // Explicit config takes priority
  if (process.env.WEBAUTHN_RP_ID && process.env.WEBAUTHN_ORIGIN) {
    return {
      rpId: process.env.WEBAUTHN_RP_ID,
      origin: process.env.WEBAUTHN_ORIGIN,
    }
  }

  // Derive from CORS_ORIGIN or FRONTEND_URL (these point to the frontend)
  const frontendUrl = process.env.CORS_ORIGIN || process.env.FRONTEND_URL
  if (frontendUrl) {
    try {
      const url = new URL(frontendUrl)
      return { rpId: url.hostname, origin: url.origin }
    } catch {
      console.warn('[auth] Invalid CORS_ORIGIN/FRONTEND_URL for WebAuthn derivation:', frontendUrl)
    }
  }

  // Local development defaults
  return { rpId: 'localhost', origin: 'http://localhost:5173' }
}

const { rpId: RP_ID, origin: ORIGIN } = resolveWebAuthnConfig()
console.log('[auth] WebAuthn config — RP_ID:', RP_ID, 'ORIGIN:', ORIGIN)

// Rate limiting: Prevent enumeration and DoS attacks
// A full login flow uses 2 rate-limited endpoints (check-user + login-options),
// registration uses 2 (check-user + register-options). With 30/15min limit,
// a user can do ~15 login attempts per window.
const authLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 30, // Max 30 requests per windowMs per IP
  standardHeaders: 'draft-6',
  keyGenerator: (c) =>
    c.req.header('fly-client-ip') ||  // Fly.io sets this
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown',
})

/**
 * POST /api/auth/webauthn/check-user
 *
 * Check if a user exists with the given email.
 * Rate limited to prevent user enumeration attacks.
 */
authRoute.post('/webauthn/check-user', authLimiter, async (c) => {
  if (isLocalMode()) {
    return c.json({ error: 'Supabase not configured' }, 503)
  }

  const { email } = await c.req.json<{ email: string }>()

  if (!email) {
    return c.json({ error: 'Email is required' }, 400)
  }

  const supabase = getServiceClient()
  const { data: existingUsers } = await supabase
    .from('user_profiles')
    .select('id, name')
    .eq('email', email)
    .limit(1)

  let userId: string | null = null
  let userName: string | null = null

  if (existingUsers && existingUsers.length > 0) {
    userId = existingUsers[0].id
    userName = existingUsers[0].name
  } else {
    // Fallback: check auth.users directly (profile may be missing due to trigger failure)
    const { data: authUsers } = await supabase.rpc('find_auth_user_by_email', { p_email: email })
    if (authUsers && authUsers.length > 0) {
      // Self-heal: create the missing profile
      const profile = await ensureUserProfile(supabase, authUsers[0].id)
      userId = authUsers[0].id
      userName = profile?.name ?? null
    }
  }

  if (!userId) {
    return c.json({ exists: false, hasCredentials: false })
  }

  // Check if user has any passkey credentials registered.
  // If the user exists but has no credentials (e.g., accessing from a new domain/device
  // where RP_ID differs), the frontend should route to registration, not login.
  const { data: creds } = await supabase
    .from('passkey_credentials')
    .select('id')
    .eq('user_id', userId)
    .limit(1)

  const hasCredentials = !!(creds && creds.length > 0)

  // Return user's name so the frontend can skip the name step for existing users
  return c.json({ exists: true, hasCredentials, name: userName })
})

/**
 * POST /api/auth/webauthn/register-options
 *
 * Generate registration options for a new passkey.
 * Rate limited to prevent DoS attacks.
 */
authRoute.post('/webauthn/register-options', authLimiter, async (c) => {
  if (isLocalMode()) {
    return c.json({ error: 'Supabase not configured' }, 503)
  }

  const { email, name } = await c.req.json<{ email: string; name?: string }>()

  if (!email) {
    return c.json({ error: 'Email is required' }, 400)
  }

  // Check if user already exists
  const supabase = getServiceClient()
  let existingUsers: Array<{ id: string }> | null = null

  const { data: profileUsers } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('email', email)
    .limit(1)

  existingUsers = profileUsers

  // Fallback: check auth.users if profile lookup missed
  if (!existingUsers || existingUsers.length === 0) {
    const { data: authUsers } = await supabase.rpc('find_auth_user_by_email', { p_email: email })
    if (authUsers && authUsers.length > 0) {
      await ensureUserProfile(supabase, authUsers[0].id)
      existingUsers = [{ id: authUsers[0].id }]
    }
  }

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

  // Store challenge for verification (DB-backed for multi-instance)
  await storeChallenge(`reg:${email}`, options.challenge)

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
  if (isLocalMode()) {
    return c.json({ error: 'Supabase not configured' }, 503)
  }

  const { email, name, credential } = await c.req.json<{
    email: string
    name?: string
    credential: RegistrationResponseJSON
  }>()

  const expectedChallenge = await getAndDeleteChallenge(`reg:${email}`)
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

      // Security: if this user already has passkey credentials, refuse registration.
      // They should log in instead. Only allow adding a passkey to accounts that
      // were created via magic link and don't have a passkey yet.
      const { data: existingCreds } = await supabase
        .from('passkey_credentials')
        .select('id')
        .eq('user_id', userId)
        .limit(1)

      if (existingCreds && existingCreds.length > 0) {
        return c.json({
          error: 'An account with this email already exists. Please log in instead.',
          existingUser: true,
        }, 409)
      }

      console.log('[auth] Adding passkey to existing magic-link user:', userId)
    } else {
      // Create user in Supabase Auth
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { name: name || email },
      })

      if (authError || !authUser.user) {
        // If user already exists in auth but not in user_profiles, look them up via RPC
        if (authError?.message?.includes('already been registered') || authError?.message?.includes('email_exists')) {
          const { data: authUsers } = await supabase.rpc('find_auth_user_by_email', { p_email: email })
          if (authUsers && authUsers.length > 0) {
            userId = authUsers[0].id
            console.log('[auth] Found existing auth user without profile:', userId)
          } else {
            console.error('[auth] User reported as existing but not found via RPC:', authError)
            return c.json({ error: 'User lookup failed' }, 500)
          }
        } else {
          console.error('[auth] Failed to create user:', authError)
          return c.json({ error: `Failed to create user: ${authError?.message || 'unknown error'}` }, 500)
        }
      } else {
        userId = authUser.user.id
      }

      // Ensure user_profiles row exists (trigger may have created it, or we self-heal)
      const profile = await ensureUserProfile(supabase, userId)
      if (!profile) {
        console.error('[auth] User profile creation failed for:', userId)
        return c.json({ error: 'Failed to create user profile' }, 500)
      }

      // Explicitly set the name from the registration form if the profile has an empty/email-like name.
      // ensureUserProfile may have created the row with name from user_metadata (which can be empty
      // for users created before user_metadata was populated, or if a DB trigger created the row first).
      if (name && (!profile.name || profile.name.includes('@'))) {
        await supabase
          .from('user_profiles')
          .update({ name })
          .eq('id', userId)
        console.log('[auth] Updated profile name for user:', userId, 'to:', name)
      }

      // Auto-create a personal team for the new user
      try {
        const { db } = await import('../lib/db/index.js')
        const { teams, teamMembers } = await import('../lib/db/schema.js')
        const [team] = await db.insert(teams).values({
          name: `${name || email}'s workspace`,
          description: 'Personal workspace',
        }).returning()
        await db.insert(teamMembers).values({
          teamId: team.id,
          userId,
          role: 'owner',
        })
        console.log('[auth] Created personal team for user:', userId, 'team:', team.id)
      } catch (teamErr) {
        // Non-fatal: resolveTeams will auto-create on next login if this fails
        console.error('[auth] Failed to create personal team (will retry on login):', teamErr)
      }
    }

    // Store passkey credential (as base64 for bytea column)
    const { error: credError } = await supabase.from('passkey_credentials').insert({
      id: regCredential.id,
      user_id: userId,
      public_key: Buffer.from(regCredential.publicKey).toString('base64'),
      counter: regCredential.counter,
      // Filter out 'hybrid' to prevent QR code prompts on future logins
      transports: credential.response.transports?.filter((t: string) => t !== 'hybrid'),
      device_name: credentialDeviceType || 'passkey',
    })

    if (credError) {
      return c.json({ error: 'Failed to store credential' }, 500)
    }

    // Generate session tokens via admin magic link.
    // This produces a hashed_token the frontend exchanges for a real Supabase session.
    const { data: session, error: sessionError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: ORIGIN },
    })

    if (sessionError || !session?.properties?.hashed_token) {
      console.error('[auth] Session generation failed:', sessionError || 'no hashed_token in response')
      return c.json({
        error: 'Account created but session generation failed. Please log in.',
        verified: true,
        userId,
      }, 500)
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
  if (isLocalMode()) {
    return c.json({ error: 'Supabase not configured' }, 503)
  }

  const { email } = await c.req.json<{ email?: string }>()

  const supabase = getServiceClient()
  let allowCredentials: Array<{ id: string; transports?: string[] }> = []

  if (email) {
    // Get user's credentials
    let userId: string | null = null

    const { data: users } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('email', email)
      .limit(1)

    if (users && users.length > 0) {
      userId = users[0].id
    } else {
      // Fallback: check auth.users directly
      const { data: authUsers } = await supabase.rpc('find_auth_user_by_email', { p_email: email })
      if (authUsers && authUsers.length > 0) {
        userId = authUsers[0].id
        await ensureUserProfile(supabase, authUsers[0].id)
      }
    }

    if (userId) {
      const { data: creds } = await supabase
        .from('passkey_credentials')
        .select('id, transports')
        .eq('user_id', userId)

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
      // Filter out 'hybrid' transport to prevent QR code prompt — keep only 'internal'
      // for platform authenticators (Touch ID/Face ID/Windows Hello)
      transports: (c.transports as AuthenticatorTransport[] | undefined)
        ?.filter((t) => t !== 'hybrid'),
    })),
    userVerification: 'required',
  })

  // Store challenge (DB-backed for multi-instance)
  const challengeKey = email ? `auth:${email}` : `auth:${options.challenge}`
  await storeChallenge(challengeKey, options.challenge)

  return c.json({ options, challengeKey })
})

/**
 * POST /api/auth/webauthn/login-verify
 *
 * Verify authentication assertion and return session tokens.
 */
authRoute.post('/webauthn/login-verify', async (c) => {
  if (isLocalMode()) {
    return c.json({ error: 'Supabase not configured' }, 503)
  }

  const { credential, challengeKey } = await c.req.json<{
    credential: AuthenticationResponseJSON
    challengeKey: string
  }>()

  const expectedChallenge = await getAndDeleteChallenge(challengeKey)
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

    // Ensure profile exists (self-heal on login)
    await ensureUserProfile(supabase, storedCred.user_id)

    // Get user info
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', storedCred.user_id)
      .single()

    // Generate Supabase session via admin
    const { data: authUser } = await supabase.auth.admin.getUserById(storedCred.user_id)

    // Self-heal: if profile name is empty but user_metadata has a name, update it
    if (userProfile && (!userProfile.name || userProfile.name.includes('@')) && authUser?.user?.user_metadata?.name) {
      const metaName = authUser.user.user_metadata.name
      if (metaName && !metaName.includes('@')) {
        await supabase
          .from('user_profiles')
          .update({ name: metaName })
          .eq('id', storedCred.user_id)
        userProfile.name = metaName
        console.log('[auth] Self-healed profile name on login for user:', storedCred.user_id)
      }
    }

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
  if (isLocalMode()) {
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

  // Test token bypass for e2e testing (requires explicit flag AND non-production env)
  if (process.env.NODE_ENV !== 'production' &&
      process.env.ENABLE_E2E_BYPASS === 'true' &&
      token === 'test-e2e-token') {
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

/**
 * DELETE /api/auth/delete-account
 *
 * Permanently delete user account and all associated data.
 * Handles both IndexedDB mode (no-op) and Supabase mode (full deletion).
 */
authRoute.delete('/delete-account', async (c) => {
  try {
    if (isLocalMode()) {
      // IndexedDB mode: Return success (client will clear local data)
      return c.json({
        success: true,
        message: 'IndexedDB mode - clear local data on client'
      })
    }

    // Supabase mode: Delete all user data
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid authorization header' }, 401)
    }

    const token = authHeader.substring(7)
    const supabase = getServiceClient()

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) {
      return c.json({ error: 'Invalid token' }, 401)
    }

    const userId = user.id

    console.log(`[auth] Deleting account for user ${userId}`)

    // 1. Revoke all machine tokens for this user
    const { error: machineError } = await supabase
      .from('registered_machines')
      .update({ is_revoked: true })
      .eq('user_id', userId)

    if (machineError) {
      console.error('[auth] Failed to revoke machines:', machineError)
    }

    // 2. Delete all user data (cascading deletes should handle related data)
    // Note: Database should have ON DELETE CASCADE for related tables
    const tables = [
      'projects',
      'plan_nodes',
      'plan_edges',
      'executions',
      'approvals',
      'activity_log',
      'user_profiles',
      'registered_machines',
    ]

    for (const table of tables) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('user_id', userId)

      if (error) {
        console.error(`[auth] Failed to delete from ${table}:`, error)
      }
    }

    // 3. Delete auth user (this will also delete the session)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId)

    if (deleteError) {
      console.error('[auth] Failed to delete auth user:', deleteError)
      return c.json({ error: 'Failed to delete account' }, 500)
    }

    console.log(`[auth] Successfully deleted account for user ${userId}`)

    return c.json({
      success: true,
      message: 'Account and all data permanently deleted'
    })
  } catch (err) {
    console.error('[auth] Delete account error:', err)
    return c.json({
      error: 'Failed to delete account',
      details: err instanceof Error ? err.message : String(err)
    }, 500)
  }
})

export { authRoute }

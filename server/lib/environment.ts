/**
 * Environment detection and configuration utilities
 *
 * Provides safe environment variable access and mode detection
 * for development, test, and production environments.
 */

/**
 * Current environment mode
 */
export type Environment = 'development' | 'test' | 'production';

/**
 * Get current environment mode
 */
export function getEnvironment(): Environment {
  const env = process.env.NODE_ENV?.toLowerCase();

  if (env === 'test') return 'test';
  if (env === 'production') return 'production';
  return 'development';
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return getEnvironment() === 'production';
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return getEnvironment() === 'development';
}

/**
 * Check if running in test mode
 */
export function isTest(): boolean {
  return getEnvironment() === 'test';
}

/**
 * Check if local mode is enabled
 * (PGlite database, no Supabase, no authentication, single-user)
 */
export function isLocalMode(): boolean {
  // Explicit override
  if (process.env.ASTRO_LOCAL_MODE === 'true') {
    return true;
  }

  // Auto-detect: if Supabase env vars not set, use local mode
  const hasSupabase = !!(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_ANON_KEY
  );

  return !hasSupabase;
}

/** @deprecated Use isLocalMode() instead */
export function isIndexedDBMode(): boolean {
  return isLocalMode();
}

/**
 * Get environment variable with required validation
 * Throws if variable is not set (except in test mode)
 *
 * @param name - Environment variable name
 * @param options - Configuration options
 * @returns Environment variable value
 * @throws Error if variable is required but not set
 *
 * @example
 * const apiKey = requireEnvVar('API_KEY');
 * const optional = requireEnvVar('OPTIONAL_KEY', { required: false });
 * const testDefault = requireEnvVar('TEST_VAR', { testDefault: 'mock-value' });
 */
export function requireEnvVar(
  name: string,
  options: {
    required?: boolean;
    testDefault?: string;
    description?: string;
  } = {}
): string {
  const {
    required = true,
    testDefault,
    description
  } = options;

  const value = process.env[name];

  // Return test default in test mode if provided
  if (isTest() && testDefault !== undefined) {
    return testDefault;
  }

  // If not required, return empty string if missing
  if (!required && !value) {
    return '';
  }

  // If required and missing, throw error
  if (required && !value) {
    const msg = description
      ? `Missing required environment variable: ${name} (${description})`
      : `Missing required environment variable: ${name}`;
    throw new Error(msg);
  }

  return value || '';
}

/**
 * Get JWT secrets with validation
 * Ensures secrets are set and unique in production
 */
export function getJWTSecrets() {
  const relay = requireEnvVar('RELAY_JWT_SECRET', {
    description: 'JWT secret for relay server authentication',
    testDefault: 'test-relay-secret-do-not-use-in-production',
  });

  const deviceAuth = requireEnvVar('DEVICE_AUTH_JWT_SECRET', {
    description: 'JWT secret for device authorization access tokens',
    testDefault: 'test-device-auth-secret-do-not-use-in-production',
  });

  const deviceRefresh = requireEnvVar('DEVICE_AUTH_REFRESH_SECRET', {
    description: 'JWT secret for device authorization refresh tokens',
    testDefault: 'test-device-refresh-secret-do-not-use-in-production',
  });

  // In production, verify secrets are unique
  if (isProduction()) {
    if (relay === deviceAuth || relay === deviceRefresh || deviceAuth === deviceRefresh) {
      throw new Error(
        'SECURITY ERROR: JWT secrets must be unique in production. ' +
        'RELAY_JWT_SECRET, DEVICE_AUTH_JWT_SECRET, and DEVICE_AUTH_REFRESH_SECRET ' +
        'must all be different values. Generate with: openssl rand -hex 32'
      );
    }

    // Verify minimum length (256-bit = 64 hex chars)
    const minLength = 64;
    if (relay.length < minLength || deviceAuth.length < minLength || deviceRefresh.length < minLength) {
      throw new Error(
        'SECURITY ERROR: JWT secrets must be at least 256-bit (64 hex characters). ' +
        'Generate with: openssl rand -hex 32'
      );
    }
  }

  return {
    relay,
    deviceAuth,
    deviceRefresh,
  };
}

/**
 * Get Supabase configuration
 */
export function getSupabaseConfig() {
  // Not required in IndexedDB mode
  const required = !isIndexedDBMode();

  return {
    url: requireEnvVar('SUPABASE_URL', {
      required,
      testDefault: 'http://127.0.0.1:54321',
      description: 'Supabase project URL',
    }),
    anonKey: requireEnvVar('SUPABASE_ANON_KEY', {
      required,
      testDefault: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
      description: 'Supabase anonymous key (public)',
    }),
    serviceRoleKey: requireEnvVar('SUPABASE_SERVICE_ROLE_KEY', {
      required,
      testDefault: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
      description: 'Supabase service role key (confidential)',
    }),
  };
}

/**
 * Get WebAuthn configuration
 */
export function getWebAuthnConfig() {
  return {
    rpName: requireEnvVar('WEBAUTHN_RP_NAME', {
      required: false,
      testDefault: 'Astro Test',
      description: 'WebAuthn relying party name',
    }) || 'Astro',
    rpId: requireEnvVar('WEBAUTHN_RP_ID', {
      required: false,
      testDefault: 'localhost',
      description: 'WebAuthn relying party ID (domain)',
    }) || 'localhost',
    origin: requireEnvVar('WEBAUTHN_ORIGIN', {
      required: false,
      testDefault: 'http://localhost:5173',
      description: 'WebAuthn origin (full URL)',
    }) || 'http://localhost:5173',
  };
}

/**
 * Get Redis configuration (optional)
 */
export function getRedisConfig() {
  return {
    url: requireEnvVar('REDIS_URL', {
      required: false,
      description: 'Redis connection URL (optional, for horizontal scaling)',
    }),
  };
}

/**
 * Get relay server configuration
 */
export function getRelayConfig() {
  return {
    port: parseInt(
      requireEnvVar('RELAY_PORT', {
        required: false,
        testDefault: '3002',
        description: 'WebSocket relay server port',
      }) || '3002',
      10
    ),
  };
}

/**
 * Validate all required environment variables on startup
 * Call this in server/index.ts before starting the server
 */
export function validateEnvironment(): void {
  const env = getEnvironment();
  console.log(`[env] Environment: ${env}`);

  try {
    // Validate JWT secrets
    getJWTSecrets();
    console.log('[env] JWT secrets validated');

    // Validate Supabase config (if not in IndexedDB mode)
    if (!isIndexedDBMode()) {
      getSupabaseConfig();
      console.log('[env] Supabase config validated');
    } else {
      console.log('[env] IndexedDB mode: Supabase config skipped');
    }

    // Validate WebAuthn config
    const webauthn = getWebAuthnConfig();
    console.log(`[env] WebAuthn config validated (RP: ${webauthn.rpId})`);

    // Check optional Redis config
    const redis = getRedisConfig();
    if (redis.url) {
      console.log('[env] Redis URL configured');
    } else {
      console.log('[env] Redis not configured (single-instance mode)');
    }

    console.log('[env] Environment validation complete');
  } catch (error) {
    console.error('[env] Environment validation failed:', error);
    throw error;
  }
}

/**
 * Get environment summary for debugging
 */
export function getEnvironmentSummary() {
  return {
    environment: getEnvironment(),
    isProduction: isProduction(),
    isDevelopment: isDevelopment(),
    isTest: isTest(),
    isIndexedDBMode: isIndexedDBMode(),
    hasRedis: !!getRedisConfig().url,
    relayPort: getRelayConfig().port,
  };
}

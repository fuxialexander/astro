/**
 * Device auth error classification tests
 *
 * Tests that the /device/register endpoint properly classifies
 * database errors (FK violations, schema mismatches) and surfaces
 * actionable error_description fields to the client.
 *
 * These are unit tests for the error classification logic extracted
 * from server/routes/device-auth.ts (the catch block of POST /device/register).
 */

import { describe, it, expect } from 'vitest'

// ─── Error classification logic (mirrors the catch block in device-auth.ts) ───

interface ClassifiedError {
  error: string
  error_description: string
  detail?: string
  statusCode: number
}

/**
 * Classify a registration error into an actionable response.
 * This is the pure logic extracted from the catch block.
 */
function classifyRegistrationError(message: string): ClassifiedError {
  const msgLower = message.toLowerCase()
  const isFkViolation = msgLower.includes('foreign key') || message.includes('23503')
  const isSchemaError =
    msgLower.includes('column') ||
    msgLower.includes('relation') ||
    message.includes('42703') ||
    message.includes('42P01')

  if (isFkViolation) {
    return {
      error: 'Failed to register machine',
      error_description:
        'Database constraint violation — your user account may not exist in the database. Try logging out and re-authenticating.',
      detail: message,
      statusCode: 500,
    }
  }

  if (isSchemaError) {
    return {
      error: 'Failed to register machine',
      error_description:
        'Database schema mismatch — the server may need a migration update.',
      detail: message,
      statusCode: 500,
    }
  }

  return {
    error: 'Failed to register machine',
    error_description: message,
    statusCode: 500,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('device-auth error classification', () => {
  describe('FK violation detection', () => {
    it('should detect PostgreSQL FK violation by error code 23503', () => {
      const result = classifyRegistrationError(
        'insert or update on table "refresh_tokens" violates foreign key constraint "fk_machine_id" (SQLSTATE 23503)'
      )
      expect(result.error_description).toContain('Database constraint violation')
      expect(result.error_description).toContain('logging out')
      expect(result.detail).toContain('23503')
    })

    it('should detect FK violation by "foreign key" text', () => {
      const result = classifyRegistrationError(
        'FOREIGN KEY constraint failed: registered_machines.user_id'
      )
      expect(result.error_description).toContain('Database constraint violation')
    })

    it('should prioritize FK detection over schema error when message contains both', () => {
      // A message that contains both "foreign key" and "column"
      const result = classifyRegistrationError(
        'foreign key constraint on column "user_id" violated'
      )
      // FK check comes first in the logic, so it should win
      expect(result.error_description).toContain('Database constraint violation')
    })
  })

  describe('Schema error detection', () => {
    it('should detect missing column by error code 42703', () => {
      const result = classifyRegistrationError(
        'column "workspace_id" does not exist (SQLSTATE 42703)'
      )
      expect(result.error_description).toContain('Database schema mismatch')
      expect(result.error_description).toContain('migration')
    })

    it('should detect missing relation by error code 42P01', () => {
      const result = classifyRegistrationError(
        'relation "registered_machines" does not exist (SQLSTATE 42P01)'
      )
      expect(result.error_description).toContain('Database schema mismatch')
    })

    it('should detect schema error by "column" keyword', () => {
      const result = classifyRegistrationError(
        'column "dispatch_public_key" of relation "registered_machines" does not exist'
      )
      expect(result.error_description).toContain('Database schema mismatch')
    })

    it('should detect schema error by "relation" keyword', () => {
      const result = classifyRegistrationError(
        'relation "device_codes" does not exist'
      )
      expect(result.error_description).toContain('Database schema mismatch')
    })
  })

  describe('Generic error passthrough', () => {
    it('should pass through unrecognized error messages as error_description', () => {
      const result = classifyRegistrationError('Something unexpected happened')
      expect(result.error_description).toBe('Something unexpected happened')
      expect(result.detail).toBeUndefined()
    })

    it('should pass through timeout errors', () => {
      const result = classifyRegistrationError('Query timeout after 30000ms')
      expect(result.error_description).toBe('Query timeout after 30000ms')
    })

    it('should pass through connection errors', () => {
      const result = classifyRegistrationError('Connection refused: ECONNREFUSED')
      expect(result.error_description).toBe('Connection refused: ECONNREFUSED')
    })
  })

  describe('Response structure', () => {
    it('should always include error and error_description fields', () => {
      const cases = [
        'foreign key violation',
        'column not found',
        'generic error',
      ]
      for (const msg of cases) {
        const result = classifyRegistrationError(msg)
        expect(result.error).toBe('Failed to register machine')
        expect(typeof result.error_description).toBe('string')
        expect(result.error_description.length).toBeGreaterThan(0)
        expect(result.statusCode).toBe(500)
      }
    })

    it('should include detail only for FK violations and schema errors', () => {
      const fk = classifyRegistrationError('foreign key constraint failed')
      expect(fk.detail).toBeDefined()

      const schema = classifyRegistrationError('column "x" does not exist')
      expect(schema.detail).toBeDefined()

      const generic = classifyRegistrationError('timeout')
      expect(generic.detail).toBeUndefined()
    })
  })
})

describe('client-side error parsing (mirrors api-client.ts registerMachine)', () => {
  /**
   * Simulates the client-side error parsing logic from api-client.ts.
   * Given a status code and response body text, build the error message.
   */
  function parseRegistrationError(statusCode: number, bodyText: string): string {
    let errorMsg = `Machine registration failed (${statusCode})`
    try {
      const body = JSON.parse(bodyText) as {
        error?: string
        error_description?: string
        detail?: string
      }
      if (body.error_description) {
        errorMsg += `: ${body.error_description}`
      } else if (body.error) {
        errorMsg += `: ${body.error}`
      }
      if (body.detail) {
        errorMsg += `\n  Detail: ${body.detail}`
      }
    } catch {
      if (bodyText) errorMsg += `: ${bodyText}`
    }
    return errorMsg
  }

  it('should extract error_description when present', () => {
    const body = JSON.stringify({
      error: 'Failed to register machine',
      error_description: 'Database constraint violation',
      detail: 'FK failed',
    })
    const msg = parseRegistrationError(500, body)
    expect(msg).toBe(
      'Machine registration failed (500): Database constraint violation\n  Detail: FK failed'
    )
  })

  it('should fall back to error field when no error_description', () => {
    const body = JSON.stringify({ error: 'Failed to register machine' })
    const msg = parseRegistrationError(500, body)
    expect(msg).toBe('Machine registration failed (500): Failed to register machine')
  })

  it('should handle non-JSON body gracefully', () => {
    const msg = parseRegistrationError(502, 'Bad Gateway')
    expect(msg).toBe('Machine registration failed (502): Bad Gateway')
  })

  it('should handle empty body', () => {
    const msg = parseRegistrationError(500, '')
    expect(msg).toBe('Machine registration failed (500)')
  })

  it('should handle JSON with only detail field', () => {
    const body = JSON.stringify({ detail: 'some detail' })
    const msg = parseRegistrationError(500, body)
    expect(msg).toContain('Machine registration failed (500)')
    expect(msg).toContain('Detail: some detail')
  })
})

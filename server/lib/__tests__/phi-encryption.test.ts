/**
 * Tests for server/lib/phi-encryption.ts
 *
 * Covers the Phase 4 (streaming events) helpers and the Phase 4b
 * column-group sanitizers. The contract:
 *
 *   - When HIPAA mode is OFF, every helper is a no-op (input === output for
 *     primitive values; structurally equal for objects).
 *   - When HIPAA mode is ON, write helpers transform PHI fields into
 *     encrypted blobs/wrappers; read helpers reverse the transform; legacy
 *     plaintext rows pass through unchanged on read.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { __resetEncryptionForTests, isEncrypted } from '../encryption.js'
import {
  decryptAuditLogRow,
  decryptBlobRow,
  decryptFileChangeRow,
  decryptMachineInstructionRow,
  decryptObservationRow,
  decryptPlanNodeRow,
  decryptProjectRow,
  decryptSessionRow,
  decryptSkillRow,
  decryptTaskChatMessageRow,
  decryptTaskExecutionRow,
  decryptToolTraceRow,
  encryptAuditLogWrite,
  encryptBlobWrite,
  encryptFileChangeWrite,
  encryptMachineInstructionWrite,
  encryptObservationWrite,
  encryptPlanNodeWrite,
  encryptProjectWrite,
  encryptSessionWrite,
  encryptSkillWrite,
  encryptTaskChatMessageWrite,
  encryptTaskExecutionWrite,
  encryptToolTraceWrite,
  isHipaaMode,
  maybeDecryptJsonb,
  maybeDecryptString,
  maybeDecryptText,
  maybeEncryptJsonb,
  maybeEncryptString,
  maybeEncryptText,
} from '../phi-encryption.js'

const TEST_KEY = randomBytes(32).toString('base64')

function setHipaa(on: boolean) {
  if (on) process.env.ASTRO_HIPAA_MODE = 'true'
  else delete process.env.ASTRO_HIPAA_MODE
}

describe('phi-encryption helpers', () => {
  let savedHipaa: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedHipaa = process.env.ASTRO_HIPAA_MODE
    savedKey = process.env.ASTRO_ENCRYPTION_KEY
    process.env.ASTRO_ENCRYPTION_KEY = TEST_KEY
    __resetEncryptionForTests()
  })

  afterEach(() => {
    if (savedHipaa === undefined) delete process.env.ASTRO_HIPAA_MODE
    else process.env.ASTRO_HIPAA_MODE = savedHipaa
    if (savedKey === undefined) delete process.env.ASTRO_ENCRYPTION_KEY
    else process.env.ASTRO_ENCRYPTION_KEY = savedKey
    __resetEncryptionForTests()
  })

  describe('isHipaaMode', () => {
    it('reflects ASTRO_HIPAA_MODE env var', () => {
      setHipaa(false)
      expect(isHipaaMode()).toBe(false)
      setHipaa(true)
      expect(isHipaaMode()).toBe(true)
    })
  })

  describe('text helpers (no-op when HIPAA off)', () => {
    it('passes plaintext through unchanged', () => {
      setHipaa(false)
      expect(maybeEncryptText('hello')).toBe('hello')
      expect(maybeDecryptText('hello')).toBe('hello')
      expect(maybeEncryptString('hello')).toBe('hello')
      expect(maybeDecryptString('hello')).toBe('hello')
    })
    it('preserves null/undefined', () => {
      setHipaa(false)
      expect(maybeEncryptText(null)).toBeNull()
      expect(maybeEncryptText(undefined)).toBeUndefined()
      expect(maybeDecryptText(null)).toBeNull()
    })
  })

  describe('text helpers (round-trip when HIPAA on)', () => {
    beforeEach(() => setHipaa(true))
    it('encrypts on write, decrypts on read', () => {
      const enc = maybeEncryptText('patient name: Alice')
      expect(typeof enc).toBe('string')
      expect(enc).not.toBe('patient name: Alice')
      expect(isEncrypted(enc as string)).toBe(true)
      expect(maybeDecryptText(enc)).toBe('patient name: Alice')
    })
    it('does not double-encrypt', () => {
      const enc1 = maybeEncryptText('x') as string
      const enc2 = maybeEncryptText(enc1)
      expect(enc1).toBe(enc2)
    })
    it('decrypt reads legacy plaintext unchanged', () => {
      expect(maybeDecryptText('legacy-plaintext')).toBe('legacy-plaintext')
    })
  })

  describe('jsonb helpers', () => {
    it('passes through when HIPAA off', () => {
      setHipaa(false)
      const obj = { foo: 'bar' }
      expect(maybeEncryptJsonb(obj)).toBe(obj)
      expect(maybeDecryptJsonb(obj)).toEqual(obj)
    })
    it('round-trips when HIPAA on', () => {
      setHipaa(true)
      const obj = { phi: 'patient X', n: 42 }
      const enc = maybeEncryptJsonb(obj) as { encrypted: string }
      expect(enc.encrypted).toBeDefined()
      expect(isEncrypted(enc)).toBe(true)
      expect(maybeDecryptJsonb(enc)).toEqual(obj)
    })
    it('legacy plaintext jsonb passes through on read', () => {
      setHipaa(true)
      const legacy = { legacy: true, value: 'plain' }
      expect(maybeDecryptJsonb(legacy)).toEqual(legacy)
    })
  })

  describe('per-table sanitizers (HIPAA off = identity)', () => {
    beforeEach(() => setHipaa(false))
    it('project write/read preserves shape', () => {
      const row = { id: 'p1', name: 'P', description: 'desc', visionDoc: 'vd', other: 1 }
      expect(encryptProjectWrite({ ...row })).toEqual(row)
      expect(decryptProjectRow({ ...row })).toEqual(row)
    })
    it('session write/read preserves shape (text + jsonb)', () => {
      const row = {
        id: 's1',
        streamText: 'st',
        messages: [{ role: 'user', content: 'hi' }],
        activityEvents: [{ kind: 'x' }],
        toolTraces: [],
        fileChanges: [],
        meta: 'k',
      }
      expect(encryptSessionWrite({ ...row })).toEqual(row)
      expect(decryptSessionRow({ ...row })).toEqual(row)
    })
  })

  describe('per-table sanitizers (HIPAA on = round-trip)', () => {
    beforeEach(() => setHipaa(true))

    it('project text columns are encrypted at rest', () => {
      const row = { id: 'p1', name: 'P', description: 'patient details', visionDoc: 'vision' }
      const enc = encryptProjectWrite({ ...row })
      expect(enc.description).not.toBe('patient details')
      expect(isEncrypted(enc.description as string)).toBe(true)
      expect(enc.visionDoc).not.toBe('vision')
      expect(enc.name).toBe('P') // non-PHI untouched
      expect(decryptProjectRow(enc)).toEqual(row)
    })

    it('planNode text columns are encrypted', () => {
      const row = { id: 'n1', title: 'T', description: 'd', content: '<p>html</p>', executionOutput: 'out' }
      const enc = encryptPlanNodeWrite({ ...row })
      expect(isEncrypted(enc.description as string)).toBe(true)
      expect(isEncrypted(enc.content as string)).toBe(true)
      expect(isEncrypted(enc.executionOutput as string)).toBe(true)
      expect(enc.title).toBe('T')
      expect(decryptPlanNodeRow(enc)).toEqual(row)
    })

    it('session text + jsonb columns are encrypted', () => {
      const row = {
        id: 's1',
        streamText: 'st',
        messages: [{ role: 'user', content: 'PHI' }],
        activityEvents: [{ k: 1 }],
        toolTraces: [{ name: 't' }],
        fileChanges: [{ path: '/p' }],
      }
      const enc = encryptSessionWrite({ ...row })
      expect(isEncrypted(enc.streamText as string)).toBe(true)
      expect(isEncrypted(enc.messages as object)).toBe(true)
      expect(isEncrypted(enc.activityEvents as object)).toBe(true)
      expect(isEncrypted(enc.toolTraces as object)).toBe(true)
      expect(isEncrypted(enc.fileChanges as object)).toBe(true)
      expect(decryptSessionRow(enc)).toEqual(row)
    })

    it('taskExecution streamText is encrypted', () => {
      const row = { id: 'x', streamText: 'transcript', status: 'success' }
      const enc = encryptTaskExecutionWrite({ ...row })
      expect(isEncrypted(enc.streamText as string)).toBe(true)
      expect(enc.status).toBe('success')
      expect(decryptTaskExecutionRow(enc)).toEqual(row)
    })

    it('taskChatMessage content is encrypted', () => {
      const row = { id: 'm', role: 'user', content: 'hello PHI' }
      const enc = encryptTaskChatMessageWrite({ ...row })
      expect(isEncrypted(enc.content as string)).toBe(true)
      expect(decryptTaskChatMessageRow(enc)).toEqual(row)
    })

    it('observationEvents input/output are encrypted', () => {
      const row = { id: 'o', input: { prompt: 'PHI' }, output: { text: 'PHI' } }
      const enc = encryptObservationWrite({ ...row })
      expect(isEncrypted(enc.input as object)).toBe(true)
      expect(isEncrypted(enc.output as object)).toBe(true)
      expect(decryptObservationRow(enc)).toEqual(row)
    })

    it('toolTraces toolInput/toolResult are encrypted', () => {
      const row = { id: 't', toolName: 'Read', toolInput: { path: '/p' }, toolResult: { text: 'PHI' } }
      const enc = encryptToolTraceWrite({ ...row })
      expect(isEncrypted(enc.toolInput as object)).toBe(true)
      expect(isEncrypted(enc.toolResult as object)).toBe(true)
      expect(decryptToolTraceRow(enc)).toEqual(row)
    })

    it('fileChanges path is encrypted', () => {
      const row = { id: 'f', executionId: 'e', path: '/Users/alice/secret.txt', action: 'create' }
      const enc = encryptFileChangeWrite({ ...row })
      expect(isEncrypted(enc.path as string)).toBe(true)
      expect(decryptFileChangeRow(enc)).toEqual(row)
    })

    it('machineInstruction content is encrypted', () => {
      const row = { id: 'mi', name: 'n', content: '# instructions' }
      const enc = encryptMachineInstructionWrite({ ...row })
      expect(isEncrypted(enc.content as string)).toBe(true)
      expect(decryptMachineInstructionRow(enc)).toEqual(row)
    })

    it('skill instructions/config are encrypted', () => {
      const row = { id: 'sk', name: 'n', instructions: 'do X', config: { endpoint: 'u' } }
      const enc = encryptSkillWrite({ ...row })
      expect(isEncrypted(enc.instructions as string)).toBe(true)
      expect(isEncrypted(enc.config as object)).toBe(true)
      expect(decryptSkillRow(enc)).toEqual(row)
    })

    it('blob data is encrypted', () => {
      const row = { id: 'b', mimeType: 'image/png', data: 'base64==' }
      const enc = encryptBlobWrite({ ...row })
      expect(isEncrypted(enc.data as string)).toBe(true)
      expect(decryptBlobRow(enc)).toEqual(row)
    })

    it('auditLog details is encrypted', () => {
      const row = { id: 'a', action: 'x', details: { ip: '1.2.3.4' } }
      const enc = encryptAuditLogWrite({ ...row })
      expect(isEncrypted(enc.details as object)).toBe(true)
      expect(decryptAuditLogRow(enc)).toEqual(row)
    })

    it('decrypt is idempotent on legacy plaintext rows', () => {
      const legacy = { id: 'p1', description: 'plain', visionDoc: 'plain' }
      expect(decryptProjectRow(legacy)).toEqual(legacy)
    })
  })
})

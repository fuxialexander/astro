/**
 * Shared mock TaskOutputStream factory for provider adapter tests.
 *
 * Provides a standardized mock of the TaskOutputStream interface from
 * packages/agent-runner/src/providers/base-adapter.ts, used across:
 * - provider-openclaw.test.ts
 * - provider-opencode.test.ts
 * - opencode-sdk-integration.test.ts
 * - provider-integration.test.ts
 */

import { vi } from 'vitest'

// =============================================================================
// Types
// =============================================================================

/**
 * TaskOutputStream mock interface — mirrors the real interface from base-adapter.
 * Uses `any` for return types since `vi.fn()` type inference varies by context.
 */
export interface MockTaskOutputStream {
  stdout: ReturnType<typeof vi.fn>
  stderr: ReturnType<typeof vi.fn>
  status: ReturnType<typeof vi.fn>
  toolTrace: ReturnType<typeof vi.fn>
  text: ReturnType<typeof vi.fn>
  toolUse: ReturnType<typeof vi.fn>
  toolResult: ReturnType<typeof vi.fn>
  fileChange: ReturnType<typeof vi.fn>
  sessionInit: ReturnType<typeof vi.fn>
  approvalRequest: ReturnType<typeof vi.fn>
}

/**
 * Extended call-tracking structure for detailed assertion in integration tests.
 */
export interface MockStreamCalls {
  text: string[]
  toolUse: Array<{ name: string; input: unknown }>
  toolResult: Array<{ name: string; result: unknown; success: boolean }>
  fileChange: Array<{ path: string; action: string }>
  sessionInit: Array<{ sessionId: string; model?: string }>
  status: Array<{ status: string; progress?: number; message?: string }>
}

export type TrackedMockTaskOutputStream = MockTaskOutputStream & {
  _calls: MockStreamCalls
  /** Reset all accumulated call arrays — useful for reusing the mock between test cases. */
  _reset: () => void
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a simple mock TaskOutputStream with vi.fn() for each method.
 * Suitable for unit tests that assert on individual mock calls.
 */
export function createMockStream(): MockTaskOutputStream {
  return {
    stdout: vi.fn(),
    stderr: vi.fn(),
    status: vi.fn(),
    toolTrace: vi.fn(),
    text: vi.fn(),
    toolUse: vi.fn(),
    toolResult: vi.fn(),
    fileChange: vi.fn(),
    sessionInit: vi.fn(),
    approvalRequest: vi.fn(),
  }
}

/**
 * Create a mock TaskOutputStream with call-tracking arrays.
 * Each method records its arguments for structured assertion in integration tests.
 */
export function createTrackedMockStream(): TrackedMockTaskOutputStream {
  const calls: MockStreamCalls = {
    text: [],
    toolUse: [],
    toolResult: [],
    fileChange: [],
    sessionInit: [],
    status: [],
  }

  return {
    _calls: calls,
    _reset: () => {
      calls.text.length = 0
      calls.toolUse.length = 0
      calls.toolResult.length = 0
      calls.fileChange.length = 0
      calls.sessionInit.length = 0
      calls.status.length = 0
    },
    stdout: vi.fn(),
    stderr: vi.fn(),
    status: vi.fn((status: string, progress?: number, message?: string) => {
      calls.status.push({ status, progress, message })
    }),
    toolTrace: vi.fn(),
    text: vi.fn((data: string) => {
      calls.text.push(data)
    }),
    toolUse: vi.fn((name: string, input: unknown) => {
      calls.toolUse.push({ name, input })
    }),
    toolResult: vi.fn((name: string, result: unknown, success: boolean) => {
      calls.toolResult.push({ name, result, success })
    }),
    fileChange: vi.fn((path: string, action: 'created' | 'modified' | 'deleted') => {
      calls.fileChange.push({ path, action })
    }),
    sessionInit: vi.fn((sessionId: string, model?: string) => {
      calls.sessionInit.push({ sessionId, model })
    }),
    approvalRequest: vi.fn(),
  }
}

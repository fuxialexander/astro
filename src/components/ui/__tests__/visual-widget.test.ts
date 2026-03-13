/**
 * Tests for VisualWidget component logic.
 *
 * Since the test environment is Node (not jsdom), we test the component's
 * core behavior by mocking React hooks and DOM APIs, then calling the
 * component function directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Track hook calls
const useEffectCallbacks: Array<() => void | (() => void)> = []
const useCallbackFns: Array<(...args: unknown[]) => unknown> = []
let useStateCalls: Array<[unknown, ReturnType<typeof vi.fn>]> = []

vi.mock('react', () => ({
  useRef: (init: unknown) => ({ current: init }),
  useState: (init: unknown) => {
    const setter = vi.fn()
    const entry: [unknown, ReturnType<typeof vi.fn>] = [init, setter]
    useStateCalls.push(entry)
    return entry
  },
  useEffect: (fn: () => void | (() => void)) => {
    useEffectCallbacks.push(fn)
  },
  useCallback: (fn: (...args: unknown[]) => unknown) => {
    useCallbackFns.push(fn)
    return fn
  },
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

// Stub DOM globals needed by the module
vi.stubGlobal('URL', {
  createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
  revokeObjectURL: vi.fn(),
})
vi.stubGlobal('Blob', class MockBlob {
  constructor(public content: unknown[], public options: Record<string, unknown>) {}
})
vi.stubGlobal('document', { documentElement: {} })
vi.stubGlobal('window', {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  open: vi.fn(),
})
vi.stubGlobal('getComputedStyle', () => ({
  getPropertyValue: () => '',
}))

// Import after mocks
import { VisualWidget } from '../visual-widget'

describe('VisualWidget', () => {
  beforeEach(() => {
    useEffectCallbacks.length = 0
    useCallbackFns.length = 0
    useStateCalls = []
    vi.clearAllMocks()
  })

  it('is a function component', () => {
    expect(typeof VisualWidget).toBe('function')
  })

  it('returns null when blobUrl is not set (initial state)', () => {
    // blobUrl starts as null, so initial render returns null
    const result = VisualWidget({ code: '<div>test</div>' })
    expect(result).toBeNull()
  })

  it('registers three useEffect hooks', () => {
    VisualWidget({ code: '<div>test</div>' })
    // 1: blob creation, 2: cleanup on unmount, 3: message listener
    expect(useEffectCallbacks).toHaveLength(3)
  })

  it('initializes blobUrl as null and iframeHeight as 200', () => {
    VisualWidget({ code: '<div>test</div>' })
    // useState is called twice: blobUrl(null) and iframeHeight(200)
    expect(useStateCalls.length).toBe(2)
    expect(useStateCalls[0][0]).toBeNull()  // blobUrl
    expect(useStateCalls[1][0]).toBe(200)   // iframeHeight
  })

  it('creates a message handler via useCallback', () => {
    VisualWidget({ code: '<div>test</div>' })
    expect(useCallbackFns).toHaveLength(1)
    expect(typeof useCallbackFns[0]).toBe('function')
  })

  it('message handler ignores non-object messages', () => {
    VisualWidget({ code: '<div>test</div>' })
    const handler = useCallbackFns[0] as (event: MessageEvent) => void

    // Should not throw for invalid data
    expect(() => handler({ data: null } as MessageEvent)).not.toThrow()
    expect(() => handler({ data: 'string' } as MessageEvent)).not.toThrow()
    expect(() => handler({ data: 42 } as MessageEvent)).not.toThrow()
    expect(() => handler({ data: undefined } as MessageEvent)).not.toThrow()
  })

  it('message handler calls onSendPrompt for sendPrompt events', () => {
    const onSendPrompt = vi.fn()
    VisualWidget({ code: '<div>test</div>', onSendPrompt })
    const handler = useCallbackFns[0] as (event: MessageEvent) => void

    handler({ data: { type: 'visualise:sendPrompt', text: 'run analysis' } } as MessageEvent)
    expect(onSendPrompt).toHaveBeenCalledWith('run analysis')
  })

  it('message handler does not call onSendPrompt if not provided', () => {
    VisualWidget({ code: '<div>test</div>' })
    const handler = useCallbackFns[0] as (event: MessageEvent) => void

    // Should not throw when onSendPrompt is undefined
    expect(() => {
      handler({ data: { type: 'visualise:sendPrompt', text: 'test' } } as MessageEvent)
    }).not.toThrow()
  })

  it('message handler opens links for openLink events', () => {
    VisualWidget({ code: '<div>test</div>' })
    const handler = useCallbackFns[0] as (event: MessageEvent) => void

    handler({ data: { type: 'visualise:openLink', url: 'https://example.com' } } as MessageEvent)
    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
  })

  it('blob creation effect creates a Blob with text/html type', () => {
    VisualWidget({ code: '<div>hello</div>' })

    // Run the first useEffect (blob creation)
    const createBlobEffect = useEffectCallbacks[0]
    createBlobEffect()

    // URL.createObjectURL should have been called
    expect(URL.createObjectURL).toHaveBeenCalled()
    const blobArg = vi.mocked(URL.createObjectURL).mock.calls[0][0]
    expect(blobArg).toBeInstanceOf(Blob)
    expect((blobArg as unknown as { options: Record<string, unknown> }).options).toEqual({ type: 'text/html' })
  })
})

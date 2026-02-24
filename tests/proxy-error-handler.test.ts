import { describe, it, expect, vi } from "vitest"

/**
 * Tests for the Vite proxy error handler logic in vite.config.ts.
 *
 * The handler intercepts ECONNREFUSED errors from the backend proxy and returns
 * a clean 503 response instead of letting the proxy crash noisily.
 *
 * Since the actual handler is embedded in Vite config (not easily importable),
 * we test the extracted logic as a pure function.
 */

interface MockResponse {
  headersSent: boolean
  writableEnded: boolean
  writeHead: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}

function createMockResponse(overrides: Partial<MockResponse> = {}): MockResponse {
  return {
    headersSent: false,
    writableEnded: false,
    writeHead: vi.fn(),
    end: vi.fn(),
    ...overrides,
  }
}

/**
 * Extracted proxy error handler logic from vite.config.ts.
 * Handles ECONNREFUSED by sending a 503 response.
 */
function handleProxyError(
  err: Error & { code?: string },
  res: MockResponse | null | undefined,
): { handled: boolean; error?: Error } {
  if ('code' in err && err.code === 'ECONNREFUSED') {
    try {
      if (res && 'writeHead' in res && !res.headersSent && !res.writableEnded) {
        res.writeHead(503, { 'Content-Type': 'text/plain' })
        res.end('Backend starting...')
        return { handled: true }
      }
      return { handled: false } // Could not write response
    } catch (writeErr) {
      return { handled: false, error: writeErr as Error }
    }
  }
  return { handled: false }
}

describe("proxy error handler", () => {
  describe("ECONNREFUSED handling", () => {
    it("sends 503 response for ECONNREFUSED errors", () => {
      const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3001"), { code: "ECONNREFUSED" })
      const res = createMockResponse()

      const result = handleProxyError(err, res)

      expect(result.handled).toBe(true)
      expect(res.writeHead).toHaveBeenCalledWith(503, { 'Content-Type': 'text/plain' })
      expect(res.end).toHaveBeenCalledWith('Backend starting...')
    })

    it("does not send response when headers already sent", () => {
      const err = Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" })
      const res = createMockResponse({ headersSent: true })

      const result = handleProxyError(err, res)

      expect(result.handled).toBe(false)
      expect(res.writeHead).not.toHaveBeenCalled()
      expect(res.end).not.toHaveBeenCalled()
    })

    it("does not send response when writable has ended", () => {
      const err = Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" })
      const res = createMockResponse({ writableEnded: true })

      const result = handleProxyError(err, res)

      expect(result.handled).toBe(false)
      expect(res.writeHead).not.toHaveBeenCalled()
    })

    it("handles null response object gracefully", () => {
      const err = Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" })
      const result = handleProxyError(err, null)

      expect(result.handled).toBe(false)
      expect(result.error).toBeUndefined()
    })

    it("handles undefined response object gracefully", () => {
      const err = Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" })
      const result = handleProxyError(err, undefined)

      expect(result.handled).toBe(false)
    })

    it("catches errors from writeHead (destroyed socket)", () => {
      const err = Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" })
      const res = createMockResponse()
      res.writeHead.mockImplementation(() => { throw new Error("write after end") })

      const result = handleProxyError(err, res)

      expect(result.handled).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!.message).toBe("write after end")
    })

    it("catches errors from end() (socket hangup)", () => {
      const err = Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" })
      const res = createMockResponse()
      res.end.mockImplementation(() => { throw new Error("socket hang up") })

      const result = handleProxyError(err, res)

      expect(result.handled).toBe(false)
      expect(result.error!.message).toBe("socket hang up")
    })
  })

  describe("non-ECONNREFUSED errors", () => {
    it("does not handle ETIMEDOUT errors", () => {
      const err = Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" })
      const res = createMockResponse()

      const result = handleProxyError(err, res)

      expect(result.handled).toBe(false)
      expect(res.writeHead).not.toHaveBeenCalled()
    })

    it("does not handle ENOTFOUND errors", () => {
      const err = Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" })
      const res = createMockResponse()

      const result = handleProxyError(err, res)

      expect(result.handled).toBe(false)
    })

    it("does not handle errors without a code property", () => {
      const err = new Error("generic error")
      const res = createMockResponse()

      const result = handleProxyError(err, res)

      expect(result.handled).toBe(false)
    })

    it("does not handle ECONNRESET errors", () => {
      const err = Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" })
      const res = createMockResponse()

      const result = handleProxyError(err, res)

      expect(result.handled).toBe(false)
    })
  })
})

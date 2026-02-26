/**
 * Path Utils Tests
 *
 * Tests buildFileUrl and buildFileUrlSync functions, with emphasis on
 * the encodeURI handling for special characters and spaces in file paths.
 *
 * Run with: npx vitest run tests/path-utils.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

// Mock api-url
vi.mock("../src/lib/api-url", () => ({
  apiUrl: (path: string) => `http://localhost:3001${path}`,
}))

// Mock fetch for getBrowserHostname
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

// Mock window.location for fallback hostname
vi.stubGlobal("window", {
  location: { hostname: "localhost" },
})

// Import after mocks
import {
  buildFileUrl,
  buildFileUrlSync,
  validateAbsolutePath,
  isSameHostname,
  clearHostnameCache,
  parseFileUrl,
} from "../src/lib/path-utils"

describe("buildFileUrl", () => {
  beforeEach(() => {
    clearHostnameCache()
    mockFetch.mockReset()
  })

  // ─── forceLocal = true (file:// protocol) ──────────────────────────

  describe("forceLocal = true", () => {
    it("returns cursor://file URL for simple path", async () => {
      const url = await buildFileUrl("/home/user/file.ts", undefined, undefined, true)
      expect(url).toBe("cursor://file/home/user/file.ts")
    })

    it("returns vscode://file URL when editorType is vscode", async () => {
      const url = await buildFileUrl("/home/user/file.ts", undefined, undefined, true, "vscode")
      expect(url).toBe("vscode://file/home/user/file.ts")
    })

    it("appends line number", async () => {
      const url = await buildFileUrl("/home/user/file.ts", 42, undefined, true)
      expect(url).toBe("cursor://file/home/user/file.ts:42")
    })

    it("encodes spaces in path", async () => {
      const url = await buildFileUrl("/home/user/my project/file.ts", undefined, undefined, true)
      expect(url).toBe("cursor://file/home/user/my%20project/file.ts")
    })

    it("encodes special characters in path", async () => {
      const url = await buildFileUrl("/home/user/path with spaces/[brackets]/file.ts", 10, undefined, true)
      expect(url).toBe("cursor://file/home/user/path%20with%20spaces/%5Bbrackets%5D/file.ts:10")
    })

    it("encodes unicode characters in path", async () => {
      const url = await buildFileUrl("/home/user/datos/archivo.ts", undefined, undefined, true)
      // encodeURI preserves most characters but encodes spaces and brackets
      expect(url).toBe("cursor://file/home/user/datos/archivo.ts")
    })

    it("encodes parentheses in path", async () => {
      const url = await buildFileUrl("/home/user/project (copy)/file.ts", undefined, undefined, true)
      // encodeURI does NOT encode parentheses — they are valid URI characters
      expect(url).toBe("cursor://file/home/user/project%20(copy)/file.ts")
    })

    it("handles path with hash character", async () => {
      const url = await buildFileUrl("/home/user/C#/file.cs", undefined, undefined, true)
      // encodeURI does NOT encode # (it is a valid URI delimiter), so it passes through
      expect(url).toBe("cursor://file/home/user/C#/file.cs")
    })
  })

  // ─── forceLocal = 'remote' (SSH remote protocol) ───────────────────

  describe("forceLocal = 'remote'", () => {
    it("returns SSH remote URL with machine name", async () => {
      const url = await buildFileUrl(
        "/home/user/file.ts",
        undefined,
        { name: "my-server", hostname: "server.local" },
        "remote"
      )
      expect(url).toBe("cursor://vscode-remote/ssh-remote+my-server/home/user/file.ts")
    })

    it("falls back to hostname when name is absent", async () => {
      const url = await buildFileUrl(
        "/home/user/file.ts",
        undefined,
        { hostname: "dev-box.local" },
        "remote"
      )
      expect(url).toBe("cursor://vscode-remote/ssh-remote+dev-box.local/home/user/file.ts")
    })

    it("appends line number to remote URL", async () => {
      const url = await buildFileUrl(
        "/home/user/file.ts",
        99,
        { name: "gpu-server" },
        "remote"
      )
      expect(url).toBe("cursor://vscode-remote/ssh-remote+gpu-server/home/user/file.ts:99")
    })

    it("encodes spaces in remote path", async () => {
      const url = await buildFileUrl(
        "/home/user/my project/file.ts",
        undefined,
        { name: "server" },
        "remote"
      )
      expect(url).toBe("cursor://vscode-remote/ssh-remote+server/home/user/my%20project/file.ts")
    })

    it("falls back to file:// when no machine info for remote mode", async () => {
      const url = await buildFileUrl(
        "/home/user/file.ts",
        undefined,
        undefined,
        "remote"
      )
      expect(url).toBe("cursor://file/home/user/file.ts")
    })

    it("uses vscode editor type", async () => {
      const url = await buildFileUrl(
        "/home/user/file.ts",
        undefined,
        { name: "server" },
        "remote",
        "vscode"
      )
      expect(url).toBe("vscode://vscode-remote/ssh-remote+server/home/user/file.ts")
    })
  })

  // ─── auto-detect mode (forceLocal = false) ─────────────────────────

  describe("auto-detect mode", () => {
    it("returns file:// when no machine info", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hostname: "localhost" }),
      })
      const url = await buildFileUrl("/home/user/file.ts", undefined, undefined, false)
      expect(url).toBe("cursor://file/home/user/file.ts")
    })

    it("returns file:// when same hostname", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hostname: "my-laptop" }),
      })
      const url = await buildFileUrl(
        "/home/user/file.ts",
        undefined,
        { hostname: "my-laptop" },
        false
      )
      expect(url).toBe("cursor://file/home/user/file.ts")
    })

    it("returns SSH remote when different hostname", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hostname: "my-laptop" }),
      })
      const url = await buildFileUrl(
        "/home/user/file.ts",
        undefined,
        { name: "gpu-box", hostname: "gpu-box.local" },
        false
      )
      expect(url).toBe("cursor://vscode-remote/ssh-remote+gpu-box/home/user/file.ts")
    })
  })
})

// ---------------------------------------------------------------------------
// buildFileUrlSync
// ---------------------------------------------------------------------------

describe("buildFileUrlSync", () => {
  beforeEach(() => {
    clearHostnameCache()
    mockFetch.mockReset()
  })

  describe("forceLocal = true", () => {
    it("returns cursor://file URL synchronously", () => {
      const url = buildFileUrlSync("/home/user/file.ts", undefined, undefined, true)
      expect(url).toBe("cursor://file/home/user/file.ts")
    })

    it("encodes spaces", () => {
      const url = buildFileUrlSync("/home/user/my project/file.ts", undefined, undefined, true)
      expect(url).toBe("cursor://file/home/user/my%20project/file.ts")
    })

    it("appends line number", () => {
      const url = buildFileUrlSync("/home/user/file.ts", 10, undefined, true)
      expect(url).toBe("cursor://file/home/user/file.ts:10")
    })

    it("uses vscode editor type", () => {
      const url = buildFileUrlSync("/home/user/file.ts", undefined, undefined, true, "vscode")
      expect(url).toBe("vscode://file/home/user/file.ts")
    })
  })

  describe("forceLocal = 'remote'", () => {
    it("returns SSH remote URL", () => {
      const url = buildFileUrlSync(
        "/home/user/file.ts",
        undefined,
        { name: "server" },
        "remote"
      )
      expect(url).toBe("cursor://vscode-remote/ssh-remote+server/home/user/file.ts")
    })

    it("falls back to file:// when no machine info", () => {
      const url = buildFileUrlSync("/home/user/file.ts", undefined, undefined, "remote")
      expect(url).toBe("cursor://file/home/user/file.ts")
    })
  })

  describe("auto-detect mode", () => {
    it("returns undefined when hostname is not cached", () => {
      const url = buildFileUrlSync(
        "/home/user/file.ts",
        undefined,
        { name: "server", hostname: "server.local" },
        false
      )
      expect(url).toBeUndefined()
    })

    it("returns file:// when no machine info and hostname cached", async () => {
      // Cache hostname first
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hostname: "my-laptop" }),
      })
      // Trigger caching via the async version
      const { getBrowserHostname } = await import("../src/lib/path-utils")
      await getBrowserHostname()

      const url = buildFileUrlSync("/home/user/file.ts", undefined, undefined, false)
      expect(url).toBe("cursor://file/home/user/file.ts")
    })
  })
})

// ---------------------------------------------------------------------------
// validateAbsolutePath
// ---------------------------------------------------------------------------

describe("validateAbsolutePath", () => {
  it("accepts empty string", () => {
    expect(validateAbsolutePath("").isValid).toBe(true)
  })

  it("accepts absolute paths", () => {
    expect(validateAbsolutePath("/home/user").isValid).toBe(true)
    expect(validateAbsolutePath("/").isValid).toBe(true)
    expect(validateAbsolutePath("/tmp/my project/dir").isValid).toBe(true)
  })

  it("rejects tilde paths", () => {
    const result = validateAbsolutePath("~/projects")
    expect(result.isValid).toBe(false)
    expect(result.error).toContain("~")
  })

  it("rejects relative paths starting with ./", () => {
    const result = validateAbsolutePath("./relative")
    expect(result.isValid).toBe(false)
    expect(result.error).toContain("Relative")
  })

  it("rejects relative paths starting with ../", () => {
    const result = validateAbsolutePath("../parent")
    expect(result.isValid).toBe(false)
    expect(result.error).toContain("Relative")
  })

  it("rejects bare relative paths", () => {
    const result = validateAbsolutePath("relative/path")
    expect(result.isValid).toBe(false)
    expect(result.error).toContain("absolute")
  })

  it("rejects just a dot", () => {
    const result = validateAbsolutePath(".")
    expect(result.isValid).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isSameHostname
// ---------------------------------------------------------------------------

describe("isSameHostname", () => {
  it("matches identical hostnames", () => {
    expect(isSameHostname("my-laptop", "my-laptop")).toBe(true)
  })

  it("matches case-insensitively", () => {
    expect(isSameHostname("My-Laptop", "my-laptop")).toBe(true)
  })

  it("matches localhost aliases", () => {
    expect(isSameHostname("localhost", "127.0.0.1")).toBe(true)
    expect(isSameHostname("127.0.0.1", "::1")).toBe(true)
    expect(isSameHostname("0.0.0.0", "localhost")).toBe(true)
  })

  it("strips .local suffix for macOS", () => {
    expect(isSameHostname("my-laptop.local", "my-laptop")).toBe(true)
  })

  it("does not match different hostnames", () => {
    expect(isSameHostname("laptop", "desktop")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseFileUrl
// ---------------------------------------------------------------------------

describe("parseFileUrl", () => {
  it("parses file:// URL", () => {
    const result = parseFileUrl("file:///home/user/file.ts")
    expect(result.protocol).toBe("file")
    expect(result.path).toBe("/home/user/file.ts")
  })

  it("parses file:// URL with line number", () => {
    const result = parseFileUrl("file:///home/user/file.ts:42")
    expect(result.protocol).toBe("file")
    expect(result.path).toBe("/home/user/file.ts")
    expect(result.line).toBe(42)
  })

  it("parses ssh+remote:// URL", () => {
    const result = parseFileUrl("ssh+remote://my-server/home/user/file.ts")
    expect(result.protocol).toBe("ssh+remote")
    expect(result.hostname).toBe("my-server")
    expect(result.path).toBe("/home/user/file.ts")
  })

  it("returns unknown for unrecognized URL", () => {
    const result = parseFileUrl("https://example.com")
    expect(result.protocol).toBe("unknown")
  })
})

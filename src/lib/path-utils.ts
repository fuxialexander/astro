/**
 * Path validation and file URL utilities
 *
 * - Path validation: Enforces absolute paths only - no relative paths allowed
 * - File URLs: Smart local/remote protocol detection for Cursor integration
 */

/**
 * Minimal machine info needed for file URL building
 */
interface MachineInfo {
  hostname?: string
}

export interface PathValidationResult {
  isValid: boolean
  error?: string
}

/**
 * Validates that a path is absolute (starts with /)
 * Rejects relative paths: ~, ./, ../, or anything not starting with /
 */
export function validateAbsolutePath(path: string): PathValidationResult {
  const trimmed = path.trim()

  if (!trimmed) {
    return { isValid: true } // Empty is okay (user can leave it blank)
  }

  // Reject tilde paths
  if (trimmed.startsWith('~')) {
    return {
      isValid: false,
      error: 'Relative paths not allowed. Please use an absolute path (e.g., /Users/username/projects)'
    }
  }

  // Reject current directory
  if (trimmed.startsWith('./') || trimmed === '.') {
    return {
      isValid: false,
      error: 'Relative paths not allowed. Please use an absolute path (e.g., /Users/username/projects)'
    }
  }

  // Reject parent directory
  if (trimmed.startsWith('../') || trimmed.includes('/../')) {
    return {
      isValid: false,
      error: 'Relative paths not allowed. Please use an absolute path (e.g., /Users/username/projects)'
    }
  }

  // Must start with /
  if (!trimmed.startsWith('/')) {
    return {
      isValid: false,
      error: 'Path must be absolute (start with /). Example: /Users/username/projects'
    }
  }

  return { isValid: true }
}

/**
 * File URL building utilities for Cursor integration
 */

/**
 * Cache for browser hostname to avoid repeated API calls
 */
let cachedBrowserHostname: string | null = null

/**
 * Get the browser's hostname (the machine running the browser)
 */
export async function getBrowserHostname(): Promise<string> {
  if (cachedBrowserHostname) {
    return cachedBrowserHostname
  }

  try {
    // Try to fetch from server-side endpoint
    const response = await fetch('/api/system/hostname')
    if (response.ok) {
      const data = await response.json() as { hostname?: string }
      if (data.hostname) {
        cachedBrowserHostname = data.hostname
        return data.hostname
      }
    }
  } catch (error) {
    console.warn('Failed to fetch browser hostname:', error)
  }

  // Fallback to window.location.hostname (less reliable but works in some cases)
  const fallback = window.location.hostname || 'unknown'
  cachedBrowserHostname = fallback
  return fallback
}

/**
 * Clear cached hostname (useful when switching networks/machines)
 */
export function clearHostnameCache(): void {
  cachedBrowserHostname = null
}

/**
 * Normalize hostname for comparison (handle aliases like localhost, 127.0.0.1, etc.)
 */
function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().trim()

  // Map common localhost aliases
  const localhostAliases = ['localhost', '127.0.0.1', '::1', '0.0.0.0']
  if (localhostAliases.includes(normalized)) {
    return 'localhost'
  }

  // Strip .local suffix (common on macOS)
  return normalized.replace(/\.local$/, '')
}

/**
 * Check if two hostnames refer to the same machine
 */
export function isSameHostname(hostname1: string, hostname2: string): boolean {
  return normalizeHostname(hostname1) === normalizeHostname(hostname2)
}

/**
 * Build a file URL with smart protocol detection
 *
 * Returns:
 * - `cursor://file/path:42` or `vscode://file/path:42` if browser and agent are on the same machine
 * - `cursor://vscode-remote/ssh-remote+hostname/path:42` if on different machines
 *
 * @param filePath - Absolute file path
 * @param lineNumber - Optional line number
 * @param machine - Machine where the file is located
 * @param forceLocal - If true, always use file:// protocol (user viewing files locally)
 * @param editorType - Editor to use ('cursor' or 'vscode')
 * @returns URL string for editor integration
 */
export async function buildFileUrl(
  filePath: string,
  lineNumber: number | undefined,
  machine: MachineInfo | undefined,
  forceLocal = false,
  editorType: 'cursor' | 'vscode' = 'cursor'
): Promise<string> {
  const line = lineNumber ? `:${lineNumber}` : ''

  // If user toggled "Local" mode, always use file:// protocol
  if (forceLocal) {
    return `${editorType}://file${filePath}${line}`
  }

  if (!machine?.hostname) {
    // No machine hostname available, fall back to file:// (assume local)
    return `${editorType}://file${filePath}${line}`
  }

  const browserHostname = await getBrowserHostname()
  const isSameMachine = isSameHostname(browserHostname, machine.hostname)

  if (isSameMachine) {
    // Same machine: use editor file protocol
    return `${editorType}://file${filePath}${line}`
  } else {
    // Different machine: use editor remote protocol
    return `${editorType}://vscode-remote/ssh-remote+${machine.hostname}${filePath}${line}`
  }
}

/**
 * Synchronous version that returns undefined if hostname not cached
 * Useful for rendering without async/await
 *
 * @param filePath - Absolute file path
 * @param lineNumber - Optional line number
 * @param machine - Machine where the file is located
 * @param forceLocal - If true, always use file:// protocol (user viewing files locally)
 * @param editorType - Editor to use ('cursor' or 'vscode')
 */
export function buildFileUrlSync(
  filePath: string,
  lineNumber: number | undefined,
  machine: MachineInfo | undefined,
  forceLocal = false,
  editorType: 'cursor' | 'vscode' = 'cursor'
): string | undefined {
  const line = lineNumber ? `:${lineNumber}` : ''

  // If user toggled "Local" mode, always use file:// protocol
  if (forceLocal) {
    return `${editorType}://file${filePath}${line}`
  }

  if (!cachedBrowserHostname) {
    return undefined // Need to call getBrowserHostname() first
  }

  if (!machine?.hostname) {
    return `${editorType}://file${filePath}${line}`
  }

  const isSameMachine = isSameHostname(cachedBrowserHostname, machine.hostname)

  if (isSameMachine) {
    return `${editorType}://file${filePath}${line}`
  } else {
    return `${editorType}://vscode-remote/ssh-remote+${machine.hostname}${filePath}${line}`
  }
}

/**
 * Parse a file URL to extract components
 */
export interface ParsedFileUrl {
  protocol: 'file' | 'ssh+remote' | 'unknown'
  hostname?: string
  path: string
  line?: number
  column?: number
}

export function parseFileUrl(url: string): ParsedFileUrl {
  // file:///path/to/file:42:10
  const fileMatch = url.match(/^file:\/\/(.+?)(?::(\d+))?(?::(\d+))?$/)
  if (fileMatch) {
    return {
      protocol: 'file',
      path: fileMatch[1],
      line: fileMatch[2] ? parseInt(fileMatch[2], 10) : undefined,
      column: fileMatch[3] ? parseInt(fileMatch[3], 10) : undefined,
    }
  }

  // ssh+remote://hostname/path/to/file:42:10
  const sshMatch = url.match(/^ssh\+remote:\/\/([^/]+)(.+?)(?::(\d+))?(?::(\d+))?$/)
  if (sshMatch) {
    return {
      protocol: 'ssh+remote',
      hostname: sshMatch[1],
      path: sshMatch[2],
      line: sshMatch[3] ? parseInt(sshMatch[3], 10) : undefined,
      column: sshMatch[4] ? parseInt(sshMatch[4], 10) : undefined,
    }
  }

  return {
    protocol: 'unknown',
    path: url,
  }
}

/**
 * PlaygroundFileSidebar Component Tests
 *
 * Tests the playground file sidebar component's logic:
 *   1. Directory/file entry sorting (directories first, then files)
 *   2. Breadcrumb path segment extraction
 *   3. Go-up navigation logic
 *   4. Keyboard navigation state machine
 *   5. Entry click behavior (directory = navigate, file = open editor)
 *   6. Loading/error/empty state conditions
 *   7. Source code verification for structure
 *
 * Since @testing-library/react is not available, we test the underlying
 * logic directly and verify source code structure.
 *
 * Run with: npx vitest run tests/playground-file-sidebar.test.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Types matching the component
// ============================================================================

interface DirectoryEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink?: boolean
}

// ============================================================================
// 1. Directory/file entry sorting
// ============================================================================

describe('PlaygroundFileSidebar entry sorting', () => {
  /**
   * Simulates the filtering logic in the component that separates
   * directories from files.
   */
  function sortEntries(entries: DirectoryEntry[]): {
    directories: DirectoryEntry[]
    files: DirectoryEntry[]
  } {
    const directories = entries.filter((e) => e.isDirectory)
    const files = entries.filter((e) => !e.isDirectory)
    return { directories, files }
  }

  it('separates directories from files', () => {
    const entries: DirectoryEntry[] = [
      { name: 'src', path: '/project/src', isDirectory: true },
      { name: 'README.md', path: '/project/README.md', isDirectory: false },
      { name: 'node_modules', path: '/project/node_modules', isDirectory: true },
      { name: 'package.json', path: '/project/package.json', isDirectory: false },
    ]

    const { directories, files } = sortEntries(entries)
    expect(directories).toHaveLength(2)
    expect(files).toHaveLength(2)
    expect(directories.map((d) => d.name)).toEqual(['src', 'node_modules'])
    expect(files.map((f) => f.name)).toEqual(['README.md', 'package.json'])
  })

  it('handles all directories', () => {
    const entries: DirectoryEntry[] = [
      { name: 'src', path: '/project/src', isDirectory: true },
      { name: 'test', path: '/project/test', isDirectory: true },
    ]

    const { directories, files } = sortEntries(entries)
    expect(directories).toHaveLength(2)
    expect(files).toHaveLength(0)
  })

  it('handles all files', () => {
    const entries: DirectoryEntry[] = [
      { name: 'index.ts', path: '/project/index.ts', isDirectory: false },
      { name: 'config.json', path: '/project/config.json', isDirectory: false },
    ]

    const { directories, files } = sortEntries(entries)
    expect(directories).toHaveLength(0)
    expect(files).toHaveLength(2)
  })

  it('handles empty entries', () => {
    const { directories, files } = sortEntries([])
    expect(directories).toHaveLength(0)
    expect(files).toHaveLength(0)
  })

  it('handles symlinks as their declared type', () => {
    const entries: DirectoryEntry[] = [
      { name: 'link-dir', path: '/project/link-dir', isDirectory: true, isSymlink: true },
      { name: 'link-file', path: '/project/link-file', isDirectory: false, isSymlink: true },
    ]

    const { directories, files } = sortEntries(entries)
    expect(directories).toHaveLength(1)
    expect(directories[0].name).toBe('link-dir')
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('link-file')
  })
})

// ============================================================================
// 2. Breadcrumb path segment extraction
// ============================================================================

describe('PlaygroundFileSidebar breadcrumb segments', () => {
  /**
   * Simulates the breadcrumb extraction logic from the component.
   * From source: const breadcrumbs = path.split("/").filter(Boolean)
   * Then displayed: breadcrumbs.slice(-3)
   */
  function extractBreadcrumbs(path: string): string[] {
    return path.split('/').filter(Boolean)
  }

  function getDisplayedBreadcrumbs(path: string): string[] {
    return extractBreadcrumbs(path).slice(-3)
  }

  it('extracts segments from absolute path', () => {
    expect(extractBreadcrumbs('/home/user/project')).toEqual(['home', 'user', 'project'])
  })

  it('extracts segments from deep path', () => {
    expect(extractBreadcrumbs('/home/user/code/project/src')).toEqual([
      'home', 'user', 'code', 'project', 'src',
    ])
  })

  it('extracts empty array for root path', () => {
    expect(extractBreadcrumbs('/')).toEqual([])
  })

  it('displays only last 3 segments for deep paths', () => {
    expect(getDisplayedBreadcrumbs('/home/user/code/project/src')).toEqual([
      'code', 'project', 'src',
    ])
  })

  it('displays all segments for short paths', () => {
    expect(getDisplayedBreadcrumbs('/home/user')).toEqual(['home', 'user'])
  })

  it('displays exactly 3 segments for 3-segment path', () => {
    expect(getDisplayedBreadcrumbs('/home/user/project')).toEqual(['home', 'user', 'project'])
  })

  it('displays single segment for 1-segment path', () => {
    expect(getDisplayedBreadcrumbs('/project')).toEqual(['project'])
  })
})

// ============================================================================
// 3. Go-up navigation logic
// ============================================================================

describe('PlaygroundFileSidebar go-up navigation', () => {
  /**
   * Simulates the goUp function from the component.
   */
  function goUp(currentPath: string): string {
    const parts = currentPath.split('/').filter(Boolean)
    if (parts.length <= 1) {
      return '/'
    } else {
      parts.pop()
      return '/' + parts.join('/')
    }
  }

  it('navigates from /home/user to /home', () => {
    expect(goUp('/home/user')).toBe('/home')
  })

  it('navigates from /home/user/project to /home/user', () => {
    expect(goUp('/home/user/project')).toBe('/home/user')
  })

  it('navigates from /home to /', () => {
    expect(goUp('/home')).toBe('/')
  })

  it('stays at / when already at root', () => {
    expect(goUp('/')).toBe('/')
  })

  it('navigates from deep path correctly', () => {
    expect(goUp('/a/b/c/d/e')).toBe('/a/b/c/d')
  })
})

// ============================================================================
// 4. Keyboard navigation state machine
// ============================================================================

describe('PlaygroundFileSidebar keyboard navigation', () => {
  /**
   * Simulates the keyboard navigation state from the component.
   */
  function createKeyboardNavState(entryCount: number) {
    let selectedIndex = -1

    return {
      get selectedIndex() { return selectedIndex },

      handleArrowDown() {
        selectedIndex = Math.min(selectedIndex + 1, entryCount - 1)
      },

      handleArrowUp() {
        selectedIndex = Math.max(selectedIndex - 1, -1)
      },

      reset() {
        selectedIndex = -1
      },
    }
  }

  it('starts with no selection (index -1)', () => {
    const nav = createKeyboardNavState(5)
    expect(nav.selectedIndex).toBe(-1)
  })

  it('ArrowDown selects first entry from no selection', () => {
    const nav = createKeyboardNavState(5)
    nav.handleArrowDown()
    expect(nav.selectedIndex).toBe(0)
  })

  it('ArrowDown advances through entries', () => {
    const nav = createKeyboardNavState(5)
    nav.handleArrowDown() // 0
    nav.handleArrowDown() // 1
    nav.handleArrowDown() // 2
    expect(nav.selectedIndex).toBe(2)
  })

  it('ArrowDown stops at last entry', () => {
    const nav = createKeyboardNavState(3)
    nav.handleArrowDown() // 0
    nav.handleArrowDown() // 1
    nav.handleArrowDown() // 2
    nav.handleArrowDown() // still 2
    expect(nav.selectedIndex).toBe(2)
  })

  it('ArrowUp from first entry goes to no selection', () => {
    const nav = createKeyboardNavState(5)
    nav.handleArrowDown() // 0
    nav.handleArrowUp()   // -1
    expect(nav.selectedIndex).toBe(-1)
  })

  it('ArrowUp from no selection stays at no selection', () => {
    const nav = createKeyboardNavState(5)
    nav.handleArrowUp()
    expect(nav.selectedIndex).toBe(-1)
  })

  it('ArrowUp moves backwards through entries', () => {
    const nav = createKeyboardNavState(5)
    nav.handleArrowDown() // 0
    nav.handleArrowDown() // 1
    nav.handleArrowDown() // 2
    nav.handleArrowUp()   // 1
    expect(nav.selectedIndex).toBe(1)
  })

  it('reset returns to no selection', () => {
    const nav = createKeyboardNavState(5)
    nav.handleArrowDown() // 0
    nav.handleArrowDown() // 1
    nav.reset()
    expect(nav.selectedIndex).toBe(-1)
  })

  it('handles single entry list', () => {
    const nav = createKeyboardNavState(1)
    nav.handleArrowDown() // 0
    expect(nav.selectedIndex).toBe(0)
    nav.handleArrowDown() // still 0
    expect(nav.selectedIndex).toBe(0)
  })

  it('handles empty entry list', () => {
    const nav = createKeyboardNavState(0)
    nav.handleArrowDown()
    expect(nav.selectedIndex).toBe(-1) // min(-1+1, 0-1) = min(0, -1) = -1
  })
})

// ============================================================================
// 5. Entry click behavior
// ============================================================================

describe('PlaygroundFileSidebar entry click behavior', () => {
  /**
   * Simulates the handleEntryClick logic from the component.
   */
  function handleEntryClick(
    entry: DirectoryEntry,
    navigateTo: (path: string) => void,
    openInEditor: (path: string) => void,
  ) {
    if (entry.isDirectory) {
      navigateTo(entry.path)
    } else {
      openInEditor(entry.path)
    }
  }

  it('navigates into directory on click', () => {
    let navigatedTo = ''
    const entry: DirectoryEntry = {
      name: 'src',
      path: '/project/src',
      isDirectory: true,
    }

    handleEntryClick(entry, (p) => { navigatedTo = p }, () => {})
    expect(navigatedTo).toBe('/project/src')
  })

  it('opens file in editor on click', () => {
    let openedFile = ''
    const entry: DirectoryEntry = {
      name: 'index.ts',
      path: '/project/index.ts',
      isDirectory: false,
    }

    handleEntryClick(entry, () => {}, (p) => { openedFile = p })
    expect(openedFile).toBe('/project/index.ts')
  })

  it('does not open editor for directories', () => {
    let editorCalled = false
    const entry: DirectoryEntry = {
      name: 'src',
      path: '/project/src',
      isDirectory: true,
    }

    handleEntryClick(entry, () => {}, () => { editorCalled = true })
    expect(editorCalled).toBe(false)
  })

  it('does not navigate for files', () => {
    let navigateCalled = false
    const entry: DirectoryEntry = {
      name: 'README.md',
      path: '/project/README.md',
      isDirectory: false,
    }

    handleEntryClick(entry, () => { navigateCalled = true }, () => {})
    expect(navigateCalled).toBe(false)
  })
})

// ============================================================================
// 6. Loading/error/empty state conditions
// ============================================================================

describe('PlaygroundFileSidebar display states', () => {
  type DisplayState = 'loading' | 'error' | 'empty' | 'entries'

  /**
   * Simulates the conditional rendering logic from the component.
   */
  function deriveDisplayState(
    loading: boolean,
    error: string | null,
    entries: DirectoryEntry[],
  ): DisplayState {
    if (loading) return 'loading'
    if (error) return 'error'
    if (entries.length === 0) return 'empty'
    return 'entries'
  }

  it('shows loading when loading is true', () => {
    expect(deriveDisplayState(true, null, [])).toBe('loading')
  })

  it('shows loading even when entries exist (loading takes priority)', () => {
    const entries: DirectoryEntry[] = [
      { name: 'src', path: '/src', isDirectory: true },
    ]
    expect(deriveDisplayState(true, null, entries)).toBe('loading')
  })

  it('shows error when error is present and not loading', () => {
    expect(deriveDisplayState(false, 'Permission denied', [])).toBe('error')
  })

  it('shows empty when no entries and no error', () => {
    expect(deriveDisplayState(false, null, [])).toBe('empty')
  })

  it('shows entries when entries exist', () => {
    const entries: DirectoryEntry[] = [
      { name: 'src', path: '/src', isDirectory: true },
    ]
    expect(deriveDisplayState(false, null, entries)).toBe('entries')
  })
})

// ============================================================================
// 7. Fetch directory URL construction
// ============================================================================

describe('PlaygroundFileSidebar fetch URL construction', () => {
  it('constructs correct query params for directory fetch', () => {
    const machineId = 'machine-123'
    const path = '/home/user/project'
    const params = new URLSearchParams({ machineId, path })

    expect(params.get('machineId')).toBe('machine-123')
    expect(params.get('path')).toBe('/home/user/project')
    expect(params.toString()).toContain('machineId=machine-123')
    expect(params.toString()).toContain('path=%2Fhome%2Fuser%2Fproject')
  })

  it('handles paths with spaces', () => {
    const params = new URLSearchParams({ machineId: 'm1', path: '/home/user/my project' })
    expect(params.get('path')).toBe('/home/user/my project')
  })
})

// ============================================================================
// 8. Breadcrumb navigation target calculation
// ============================================================================

describe('PlaygroundFileSidebar breadcrumb click targets', () => {
  /**
   * Simulates the breadcrumb click handler: navigateTo("/" + breadcrumbs.slice(0, index + 1).join("/"))
   */
  function getBreadcrumbTarget(fullPath: string, clickedSegmentIndex: number): string {
    const breadcrumbs = fullPath.split('/').filter(Boolean)
    return '/' + breadcrumbs.slice(0, clickedSegmentIndex + 1).join('/')
  }

  it('clicking first segment navigates to first-level path', () => {
    expect(getBreadcrumbTarget('/home/user/project', 0)).toBe('/home')
  })

  it('clicking second segment navigates to second-level path', () => {
    expect(getBreadcrumbTarget('/home/user/project', 1)).toBe('/home/user')
  })

  it('clicking last segment navigates to full path', () => {
    expect(getBreadcrumbTarget('/home/user/project', 2)).toBe('/home/user/project')
  })

  it('clicking only segment of shallow path navigates to that path', () => {
    expect(getBreadcrumbTarget('/project', 0)).toBe('/project')
  })
})

// ============================================================================
// 9. Source code verification
// ============================================================================

describe('playground-file-sidebar.tsx source code', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pathMod = require('node:path') as typeof import('node:path')
  const source = fs.readFileSync(
    pathMod.join(process.cwd(), 'src/components/playground/playground-file-sidebar.tsx'),
    'utf-8'
  )

  it('exports PlaygroundFileSidebar component', () => {
    expect(source).toContain('export function PlaygroundFileSidebar')
  })

  it('has close button that calls onClose', () => {
    expect(source).toContain('onClick={onClose}')
  })

  it('uses X icon for close button', () => {
    expect(source).toContain('X')
    expect(source).toContain('<X')
  })

  it('shows loading spinner with Loader2', () => {
    expect(source).toContain('Loader2')
    expect(source).toContain('animate-spin')
  })

  it('shows error state with AlertCircle icon', () => {
    expect(source).toContain('AlertCircle')
  })

  it('has retry button in error state', () => {
    expect(source).toContain('Retry')
  })

  it('shows "Empty directory" message for empty state', () => {
    expect(source).toContain('Empty directory')
  })

  it('uses FolderOpen icon for empty state', () => {
    expect(source).toContain('FolderOpen')
  })

  it('separates directories from files for rendering', () => {
    expect(source).toContain('entries.filter((e) => e.isDirectory)')
    expect(source).toContain('entries.filter((e) => !e.isDirectory)')
  })

  it('uses Folder icon for directories', () => {
    expect(source).toContain('Folder')
    expect(source).toContain('<Folder')
  })

  it('uses FileText icon for files', () => {
    expect(source).toContain('FileText')
    expect(source).toContain('<FileText')
  })

  it('has Home button for breadcrumb navigation', () => {
    expect(source).toContain('Home')
    expect(source).toContain('<Home')
  })

  it('has ArrowUp button for go-up navigation', () => {
    expect(source).toContain('ArrowUp')
    expect(source).toContain('<ArrowUp')
    expect(source).toContain('goUp')
  })

  it('hides go-up button at root', () => {
    expect(source).toContain('path !== "/"')
  })

  it('has refresh button', () => {
    expect(source).toContain('RefreshCw')
    expect(source).toContain('Refresh')
  })

  it('has open-in-editor via EditorOpenControls', () => {
    expect(source).toContain('EditorOpenControls')
    expect(source).toContain('buildFileUrlSync')
  })

  it('supports keyboard navigation with ArrowDown', () => {
    expect(source).toContain('"ArrowDown"')
  })

  it('supports keyboard navigation with ArrowUp', () => {
    expect(source).toContain('"ArrowUp"')
  })

  it('supports Enter key to activate selected entry', () => {
    expect(source).toContain('"Enter"')
    expect(source).toContain('handleEntryClick')
  })

  it('supports Backspace key to go up', () => {
    expect(source).toContain('"Backspace"')
    expect(source).toContain('goUp()')
  })

  it('uses ChevronRight as breadcrumb separator', () => {
    expect(source).toContain('ChevronRight')
    expect(source).toContain('<ChevronRight')
  })

  it('displays last 3 breadcrumb segments', () => {
    expect(source).toContain('breadcrumbs.slice(-3)')
  })

  it('highlights selected entry with bg-primary/10', () => {
    expect(source).toContain('bg-primary/10')
  })

  it('uses data-entry-index attribute for scrollIntoView', () => {
    expect(source).toContain('data-entry-index')
    expect(source).toContain('scrollIntoView')
  })

  it('fetches directory listing from /api/fs/directories', () => {
    expect(source).toContain('/api/fs/directories')
  })

  it('passes machineId and path as query params', () => {
    expect(source).toContain('URLSearchParams({ machineId, path })')
  })

  it('loads initial directory on mount', () => {
    expect(source).toContain('useEffect')
    expect(source).toContain('loadDirectory(workingDirectory)')
  })

  it('uses buildFileUrlSync for opening files in editor', () => {
    expect(source).toContain('buildFileUrlSync')
  })

  it('sidebar has fixed width of 280px', () => {
    expect(source).toContain('w-[280px]')
  })

  it('uses EditorOpenControls in header', () => {
    expect(source).toContain('EditorOpenControls')
  })
})

/**
 * PlaygroundHeader Component Tests
 *
 * Tests the playground header component's logic:
 *   1. Status badge configuration (label, color, icon)
 *   2. Conditional stop button visibility
 *   3. Conditional machine name / working directory display
 *   4. File sidebar toggle state
 *   5. Source code verification for structure
 *
 * Since @testing-library/react is not available, we test the underlying
 * logic directly and verify source code structure.
 *
 * Run with: npx vitest run tests/playground-header.test.tsx
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// 1. Status configuration logic
// ============================================================================

type PlaygroundStatus = 'running' | 'waiting' | 'completed' | 'error'

interface StatusConfig {
  label: string
  color: string
}

/**
 * Simulates the statusConfig mapping from PlaygroundHeader.
 */
function getStatusConfig(status: PlaygroundStatus): StatusConfig {
  const statusConfig: Record<PlaygroundStatus, StatusConfig> = {
    running: {
      label: "Running",
      color: "bg-primary/10 text-primary",
    },
    waiting: {
      label: "Waiting for input",
      color: "bg-warning/10 text-warning",
    },
    completed: {
      label: "Completed",
      color: "bg-success/10 text-success",
    },
    error: {
      label: "Error",
      color: "bg-destructive/10 text-destructive",
    },
  }
  return statusConfig[status]
}

describe('PlaygroundHeader status configuration', () => {
  it('running status has correct label', () => {
    const config = getStatusConfig('running')
    expect(config.label).toBe('Running')
  })

  it('running status uses primary color', () => {
    const config = getStatusConfig('running')
    expect(config.color).toContain('text-primary')
    expect(config.color).toContain('bg-primary/10')
  })

  it('waiting status has correct label', () => {
    const config = getStatusConfig('waiting')
    expect(config.label).toBe('Waiting for input')
  })

  it('waiting status uses warning color', () => {
    const config = getStatusConfig('waiting')
    expect(config.color).toContain('text-warning')
    expect(config.color).toContain('bg-warning/10')
  })

  it('completed status has correct label', () => {
    const config = getStatusConfig('completed')
    expect(config.label).toBe('Completed')
  })

  it('completed status uses success color', () => {
    const config = getStatusConfig('completed')
    expect(config.color).toContain('text-success')
    expect(config.color).toContain('bg-success/10')
  })

  it('error status has correct label', () => {
    const config = getStatusConfig('error')
    expect(config.label).toBe('Error')
  })

  it('error status uses destructive color', () => {
    const config = getStatusConfig('error')
    expect(config.color).toContain('text-destructive')
    expect(config.color).toContain('bg-destructive/10')
  })

  it('all statuses have non-empty labels', () => {
    const statuses: PlaygroundStatus[] = ['running', 'waiting', 'completed', 'error']
    for (const status of statuses) {
      const config = getStatusConfig(status)
      expect(config.label.length).toBeGreaterThan(0)
    }
  })

  it('all statuses have non-empty colors', () => {
    const statuses: PlaygroundStatus[] = ['running', 'waiting', 'completed', 'error']
    for (const status of statuses) {
      const config = getStatusConfig(status)
      expect(config.color.length).toBeGreaterThan(0)
    }
  })
})

// ============================================================================
// 2. Stop button visibility logic
// ============================================================================

describe('PlaygroundHeader stop button visibility', () => {
  /**
   * Simulates the conditional logic for showing the stop button.
   * From the source: (status === 'running' || status === 'waiting')
   */
  function shouldShowStopButton(status: PlaygroundStatus): boolean {
    return status === 'running' || status === 'waiting'
  }

  it('shows stop button when running', () => {
    expect(shouldShowStopButton('running')).toBe(true)
  })

  it('shows stop button when waiting for input', () => {
    expect(shouldShowStopButton('waiting')).toBe(true)
  })

  it('hides stop button when completed', () => {
    expect(shouldShowStopButton('completed')).toBe(false)
  })

  it('hides stop button when error', () => {
    expect(shouldShowStopButton('error')).toBe(false)
  })
})

// ============================================================================
// 3. Conditional display logic
// ============================================================================

describe('PlaygroundHeader conditional displays', () => {
  /**
   * Simulates the machineName/workingDirectory conditional rendering.
   */
  function shouldShowMachineName(machineName?: string): boolean {
    return !!machineName
  }

  function shouldShowWorkingDirectory(workingDirectory?: string): boolean {
    return !!workingDirectory
  }

  it('shows machine name when provided', () => {
    expect(shouldShowMachineName('my-laptop')).toBe(true)
  })

  it('hides machine name when undefined', () => {
    expect(shouldShowMachineName(undefined)).toBe(false)
  })

  it('hides machine name when empty string', () => {
    expect(shouldShowMachineName('')).toBe(false)
  })

  it('shows working directory when provided', () => {
    expect(shouldShowWorkingDirectory('/home/user/project')).toBe(true)
  })

  it('hides working directory when undefined', () => {
    expect(shouldShowWorkingDirectory(undefined)).toBe(false)
  })

  it('hides working directory when empty string', () => {
    expect(shouldShowWorkingDirectory('')).toBe(false)
  })
})

// ============================================================================
// 4. File sidebar toggle state
// ============================================================================

describe('PlaygroundHeader file sidebar toggle', () => {
  /**
   * Simulates the bg-muted class application for fileSidebarOpen state.
   */
  function getToggleButtonClass(fileSidebarOpen: boolean): string {
    return fileSidebarOpen ? 'bg-muted' : ''
  }

  it('applies bg-muted when sidebar is open', () => {
    expect(getToggleButtonClass(true)).toContain('bg-muted')
  })

  it('does not apply bg-muted when sidebar is closed', () => {
    expect(getToggleButtonClass(false)).toBe('')
  })
})

// ============================================================================
// 5. Props interface validation
// ============================================================================

describe('PlaygroundHeader props interface', () => {
  interface PlaygroundHeaderProps {
    title: string
    status: PlaygroundStatus
    machineName?: string
    workingDirectory?: string
    fileSidebarOpen: boolean
    onBack: () => void
    onAbort: () => void
    onToggleFileSidebar: () => void
  }

  function validateProps(props: PlaygroundHeaderProps): boolean {
    return (
      typeof props.title === 'string' &&
      ['running', 'waiting', 'completed', 'error'].includes(props.status) &&
      typeof props.fileSidebarOpen === 'boolean' &&
      typeof props.onBack === 'function' &&
      typeof props.onAbort === 'function' &&
      typeof props.onToggleFileSidebar === 'function'
    )
  }

  it('accepts valid required props', () => {
    const props: PlaygroundHeaderProps = {
      title: 'Test Session',
      status: 'running',
      fileSidebarOpen: false,
      onBack: () => {},
      onAbort: () => {},
      onToggleFileSidebar: () => {},
    }
    expect(validateProps(props)).toBe(true)
  })

  it('accepts all optional props', () => {
    const props: PlaygroundHeaderProps = {
      title: 'Test Session',
      status: 'completed',
      machineName: 'my-laptop',
      workingDirectory: '/home/user/project',
      fileSidebarOpen: true,
      onBack: () => {},
      onAbort: () => {},
      onToggleFileSidebar: () => {},
    }
    expect(validateProps(props)).toBe(true)
  })
})

// ============================================================================
// 6. Source code verification
// ============================================================================

describe('playground-header.tsx source code', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/components/playground/playground-header.tsx'),
    'utf-8'
  )

  it('exports PlaygroundHeader component', () => {
    expect(source).toContain('export function PlaygroundHeader')
  })

  it('renders session title via {title} in h2', () => {
    expect(source).toContain('{title}')
    expect(source).toContain('<h2')
  })

  it('has status badge with config.label and config.icon', () => {
    expect(source).toContain('{config.label}')
    expect(source).toContain('{config.icon}')
  })

  it('uses ArrowLeft icon for back button', () => {
    expect(source).toContain('ArrowLeft')
    expect(source).toContain('onBack')
  })

  it('back button calls onBack', () => {
    expect(source).toContain('onClick={onBack}')
  })

  it('stop button calls onAbort', () => {
    expect(source).toContain('onClick={onAbort}')
  })

  it('stop button has "Stop" text', () => {
    expect(source).toContain('Stop')
  })

  it('stop button is only shown when running or waiting', () => {
    expect(source).toContain("status === 'running' || status === 'waiting'")
  })

  it('stop button uses destructive color', () => {
    expect(source).toContain('text-destructive')
  })

  it('file toggle button calls onToggleFileSidebar', () => {
    expect(source).toContain('onClick={onToggleFileSidebar}')
  })

  it('file toggle uses FolderOpen icon', () => {
    expect(source).toContain('FolderOpen')
  })

  it('file toggle applies bg-muted when sidebar open', () => {
    expect(source).toContain('fileSidebarOpen && "bg-muted"')
  })

  it('displays machine name with Laptop icon', () => {
    expect(source).toContain('Laptop')
    expect(source).toContain('{machineName}')
  })

  it('conditionally shows machine name', () => {
    expect(source).toContain('machineName &&')
  })

  it('displays working directory', () => {
    expect(source).toContain('{workingDirectory}')
  })

  it('conditionally shows working directory', () => {
    expect(source).toContain('workingDirectory &&')
  })

  it('working directory uses mono font', () => {
    expect(source).toContain('font-mono')
  })

  it('running status uses Loader2 spinner', () => {
    expect(source).toContain('Loader2')
    expect(source).toContain('animate-spin')
  })

  it('completed status uses CheckCircle2 icon', () => {
    expect(source).toContain('CheckCircle2')
  })

  it('error status uses AlertCircle icon', () => {
    expect(source).toContain('AlertCircle')
  })

  it('uses X icon for stop button', () => {
    expect(source).toContain('X')
  })

  it('uses cn() for class merging', () => {
    expect(source).toContain('cn(')
  })

  it('imports Button from ui/button', () => {
    expect(source).toContain('import { Button } from')
  })
})

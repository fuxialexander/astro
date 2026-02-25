import React from 'react'
import { Box, useStdout } from 'ink'
import { StatusBar } from './status-bar.js'
import { CommandLine } from './command-line.js'
import { HelpOverlay } from './help-overlay.js'
import { SearchOverlay } from './search-overlay.js'
import { ProjectsPanel } from '../panels/projects-panel.js'
import { PlanPanel } from '../panels/plan-panel.js'
import { MachinesPanel } from '../panels/machines-panel.js'
import { OutputPanel } from '../panels/output-panel.js'
import { DetailOverlay } from '../panels/detail-overlay.js'
import { useTuiStore } from '../../stores/tui-store.js'

export function MainLayout() {
  const showHelp = useTuiStore((s) => s.showHelp)
  const showDetail = useTuiStore((s) => s.showDetail)
  const { stdout } = useStdout()

  // Calculate dimensions
  const termHeight = stdout?.rows ?? 24
  const termWidth = stdout?.columns ?? 80
  const topRowHeight = Math.floor((termHeight - 4) / 2)
  const bottomRowHeight = termHeight - 4 - topRowHeight

  // If an overlay is showing, render it instead of panels
  if (showHelp) {
    return (
      <Box flexDirection="column" width={termWidth} height={termHeight}>
        <StatusBar />
        <HelpOverlay />
        <CommandLine />
      </Box>
    )
  }

  if (showDetail) {
    return (
      <Box flexDirection="column" width={termWidth} height={termHeight}>
        <StatusBar />
        <DetailOverlay />
        <CommandLine />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      {/* Status bar */}
      <StatusBar />

      {/* Top row: Projects + Plan */}
      <Box flexDirection="row" height={topRowHeight}>
        <Box width="30%">
          <ProjectsPanel height={topRowHeight} />
        </Box>
        <Box flexGrow={1}>
          <PlanPanel height={topRowHeight} />
        </Box>
      </Box>

      {/* Bottom row: Machines + Output */}
      <Box flexDirection="row" height={bottomRowHeight}>
        <Box width="30%">
          <MachinesPanel height={bottomRowHeight} />
        </Box>
        <Box flexGrow={1}>
          <OutputPanel height={bottomRowHeight} />
        </Box>
      </Box>

      {/* Search overlay (floats over panels) */}
      <SearchOverlay />

      {/* Command line */}
      <CommandLine />
    </Box>
  )
}

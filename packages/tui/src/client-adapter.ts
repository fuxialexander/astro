/**
 * Re-export AstroClient and types from the CLI package.
 * The TUI reuses the same API client — no duplication.
 */
export {
  AstroClient,
  getClient,
  streamDispatchToStdout,
  type Project,
  type PlanNode,
  type PlanEdge,
  type Execution,
  type ToolTrace,
  type FileChange,
  type Machine,
  type ActivityEvent,
  type ObservationEvent,
  type ObservationStats,
  type SearchResults,
} from '../../cli/src/client.js'

export { loadConfig, getServerUrl, type CliConfig } from '../../cli/src/config.js'

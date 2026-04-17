/**
 * Frontend types for the "Import from history" feature.
 *
 * These mirror the server-side shapes in `server/types/relay.ts` and the
 * agent-runner types in `packages/agent-runner/src/types.ts`. They live
 * here so the inbox picker and execution store can share them without
 * pulling in server code.
 */

export type ExternalAgentProvider = 'claude' | 'codex' | 'pi';

/**
 * Normalized external-agent session, surfaced by `/api/relay/sessions`.
 * The legacy `ClaudeCodeSession` shape is a structural subset and remains
 * available as a deprecated alias in `stores/claude-sessions-store.ts`.
 */
export interface ExternalAgentSession {
  provider: ExternalAgentProvider;
  sessionId: string;
  summary: string;
  lastModified: number;
  fileSize: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  cwd?: string;
  machineId: string;
  machineName: string;
  /** Absolute path on the machine where the transcript file lives. */
  transcriptPath?: string;
}

/**
 * Single session selected for import, as sent from the inbox picker to
 * `POST /api/dispatch/task` inside `importManifest.sessions`.
 */
export interface ImportManifestSelection {
  provider: ExternalAgentProvider;
  sessionId: string;
  /** Human-readable title for the manifest + activity feed. */
  title: string;
  cwd?: string;
  gitBranch?: string;
  lastModified?: number;
}

/**
 * What the client posts on the dispatch body when bootstrapping a project
 * from external-agent transcripts. Machine + working directory are already
 * in the dispatch options; we carry the session list separately so the
 * server can trigger `requestImportSessions(...)` before the task runs.
 */
export interface ClientImportManifest {
  sessions: ImportManifestSelection[];
  /**
   * What the main agent should do after `.astro/imports/` is populated:
   * `plan` — generate an Astro plan graph from the summarized sessions.
   * `playground` — open a chat where the agent summarizes and asks what's next.
   */
  mode: 'plan' | 'playground';
}

/**
 * Manifest entry persisted server-side in `projects.importedFromSessions`
 * and written by the agent-runner to `.astro/imports/manifest.json`. The
 * agent-runner shape is authoritative; this re-declares it for frontend
 * type-checking.
 */
export interface ImportManifestEntry {
  provider: ExternalAgentProvider;
  sessionId: string;
  originalPath: string;
  localPath: string;
  memoryPath: string;
  cwd?: string;
  gitBranch?: string;
  lastModified?: number;
  title: string;
}

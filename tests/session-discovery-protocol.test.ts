/**
 * Session discovery protocol tests.
 *
 * Verifies the wire-format additions that the Astro backend uses to talk
 * to the agent-runner's new session-discovery layer:
 *   - `SessionsListRequestMessage` gains optional `providers` + `cwd` filters.
 *   - `ClaudeCodeSessionInfo` gains optional `provider` + `transcriptPath`.
 *   - New `ImportSessionsRequestMessage` / `ImportSessionsResponseMessage`
 *     carry the import manifest plus per-session failure list.
 *
 * Pure type-level checks — no network or fs I/O.
 */

import { describe, expect, it } from 'vitest';
import type {
  ClaudeCodeSessionInfo,
  ExternalAgentProvider,
  ImportSessionsRequestMessage,
  ImportSessionsResponseMessage,
  SessionsListRequestMessage,
  SessionsListResponseMessage,
} from '../server/types/relay';

describe('SessionsListRequestMessage (scoping fields)', () => {
  it('accepts an unfiltered request (legacy shape)', () => {
    const msg: SessionsListRequestMessage = {
      type: 'sessions_list.request',
      correlationId: 'corr-1',
    };
    expect(msg.providers).toBeUndefined();
    expect(msg.cwd).toBeUndefined();
  });

  it('accepts providers + cwd + maxAgeMs filters', () => {
    const msg: SessionsListRequestMessage = {
      type: 'sessions_list.request',
      correlationId: 'corr-2',
      providers: ['claude', 'codex', 'pi'],
      cwd: '/Users/alice/app',
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    };
    expect(msg.providers).toEqual(['claude', 'codex', 'pi']);
    expect(msg.cwd).toBe('/Users/alice/app');
  });

  it('ExternalAgentProvider is a string-literal union of the three supported providers', () => {
    const all: ExternalAgentProvider[] = ['claude', 'codex', 'pi'];
    expect(all).toHaveLength(3);
  });
});

describe('ClaudeCodeSessionInfo (provider tagging, back-compat)', () => {
  it('accepts the legacy shape with no provider / transcriptPath', () => {
    const legacy: ClaudeCodeSessionInfo = {
      sessionId: 'abc',
      summary: 'Fix login bug',
      lastModified: Date.now(),
      fileSize: 1234,
    };
    expect(legacy.provider).toBeUndefined();
    expect(legacy.transcriptPath).toBeUndefined();
  });

  it('accepts tagged sessions from the new walker', () => {
    const tagged: ClaudeCodeSessionInfo = {
      provider: 'codex',
      sessionId: '019d0972-90f7-7300-a6b5-03af0946668f',
      summary: 'Refactor auth',
      lastModified: Date.now(),
      fileSize: 54_321,
      cwd: '/Users/alice/app',
      gitBranch: 'feat/auth',
      transcriptPath: '/Users/alice/.codex/sessions/2026/04/16/rollout-...jsonl',
    };
    expect(tagged.provider).toBe('codex');
    expect(tagged.transcriptPath).toContain('.codex');
  });
});

describe('SessionsListResponseMessage (mixed providers)', () => {
  it('carries a list tagged with different providers', () => {
    const resp: SessionsListResponseMessage = {
      type: 'sessions_list.response',
      correlationId: 'corr-3',
      sessions: [
        { provider: 'claude', sessionId: 's1', summary: '', lastModified: 0, fileSize: 0 },
        { provider: 'codex', sessionId: 's2', summary: '', lastModified: 0, fileSize: 0 },
        { provider: 'pi', sessionId: 's3', summary: '', lastModified: 0, fileSize: 0 },
      ],
    };
    expect(resp.sessions.map((s) => s.provider)).toEqual(['claude', 'codex', 'pi']);
  });
});

describe('ImportSessionsRequestMessage', () => {
  it('carries a workingDirectory and a list of sessions with titles', () => {
    const req: ImportSessionsRequestMessage = {
      type: 'import_sessions.request',
      correlationId: 'corr-4',
      workingDirectory: '/Users/alice/app',
      sessions: [
        { provider: 'claude', sessionId: 'c-1', title: 'Auth refactor', cwd: '/Users/alice/app' },
        { provider: 'pi', sessionId: 'p-1', title: 'CLI tweaks' },
      ],
    };
    expect(req.sessions).toHaveLength(2);
    expect(req.sessions[0].title).toBe('Auth refactor');
  });
});

describe('ImportSessionsResponseMessage', () => {
  it('reports success with raw count and empty failures', () => {
    const resp: ImportSessionsResponseMessage = {
      type: 'import_sessions.response',
      correlationId: 'corr-5',
      ok: true,
      manifestPath: '/Users/alice/app/.astro/imports/manifest.json',
      rawCount: 2,
      failures: [],
    };
    expect(resp.ok).toBe(true);
    expect(resp.rawCount).toBe(2);
  });

  it('carries per-session failures when partial', () => {
    const resp: ImportSessionsResponseMessage = {
      type: 'import_sessions.response',
      correlationId: 'corr-6',
      ok: true,
      rawCount: 1,
      failures: [{ provider: 'codex', sessionId: 'missing', reason: 'transcript file not found' }],
    };
    expect(resp.failures).toHaveLength(1);
    expect(resp.failures[0].reason).toMatch(/not found/);
  });

  it('carries a hard error + empty rawCount when the whole import aborts', () => {
    const resp: ImportSessionsResponseMessage = {
      type: 'import_sessions.response',
      correlationId: 'corr-7',
      ok: false,
      rawCount: 0,
      failures: [],
      error: 'workingDirectory is required',
    };
    expect(resp.ok).toBe(false);
    expect(resp.error).toBe('workingDirectory is required');
  });
});

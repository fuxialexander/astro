/**
 * Unit tests for @astroanywhere/openclaw-plugin
 *
 * All HTTP calls to the Astro API are intercepted via vi.stubGlobal('fetch', ...)
 * so these tests run without a real server.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPlugin } from '../src/index.js';
import { AstroClient, AstroApiError } from '../src/client.js';
import type { PluginConfig } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFetch(
  status: number,
  body: unknown,
): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof globalThis.fetch;
}

const DEFAULT_CONFIG: PluginConfig = {
  serverUrl: 'http://localhost:3001',
  authToken: 'test-token',
  teamId: 'team-1',
};

// ── AstroClient ───────────────────────────────────────────────────────────────

describe('AstroClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends Authorization and X-Team-Id headers', async () => {
    const mockFetch = makeFetch(200, []);
    vi.stubGlobal('fetch', mockFetch);

    const client = new AstroClient({ serverUrl: 'http://localhost:3001', authToken: 'tok', teamId: 'tid' });
    await client.get('/api/data/projects');

    const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/api/data/projects');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok');
    expect(headers['X-Team-Id']).toBe('tid');
  });

  it('omits Authorization header when authToken is empty', async () => {
    const mockFetch = makeFetch(200, []);
    vi.stubGlobal('fetch', mockFetch);

    const client = new AstroClient({ serverUrl: 'http://localhost:3001', authToken: '' });
    await client.get('/api/data/projects');

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('strips trailing slash from serverUrl', async () => {
    const mockFetch = makeFetch(200, {});
    vi.stubGlobal('fetch', mockFetch);

    const client = new AstroClient({ serverUrl: 'http://localhost:3001/', authToken: '' });
    await client.get('/api/data/projects');

    const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('http://localhost:3001/api/data/projects');
  });

  it('throws AstroApiError on non-2xx response', async () => {
    const mockFetch = makeFetch(404, { error: 'Not found' });
    vi.stubGlobal('fetch', mockFetch);

    const client = new AstroClient({ serverUrl: 'http://localhost:3001', authToken: '' });
    await expect(client.get('/api/data/projects/missing')).rejects.toThrow(AstroApiError);
    await expect(client.get('/api/data/projects/missing')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Not found',
    });
  });

  it('throws AstroApiError with fallback message when response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => { throw new Error('not json'); },
    }));

    const client = new AstroClient({ serverUrl: 'http://localhost:3001', authToken: '' });
    await expect(client.get('/api/data/projects')).rejects.toThrow(AstroApiError);
  });
});

// ── createPlugin ──────────────────────────────────────────────────────────────

describe('createPlugin', () => {
  it('returns a plugin with id "astro"', () => {
    const plugin = createPlugin(DEFAULT_CONFIG);
    expect(plugin.id).toBe('astro');
    expect(plugin.name).toBe('Astro Planning Platform');
    expect(plugin.version).toBe('0.1.0');
  });

  it('registers all four tools', () => {
    const plugin = createPlugin(DEFAULT_CONFIG);
    expect([...plugin.tools.keys()]).toEqual(
      expect.arrayContaining([
        'astro_list_projects',
        'astro_get_plan',
        'astro_run_task',
        'astro_task_status',
      ]),
    );
  });

  it('returns isError result for unknown tool name', async () => {
    const plugin = createPlugin(DEFAULT_CONFIG);
    const result = await plugin.invoke('astro_unknown_tool', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });
});

// ── astro_list_projects ───────────────────────────────────────────────────────

describe('astro_list_projects', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns formatted project list when projects exist', async () => {
    vi.stubGlobal('fetch', makeFetch(200, [
      { id: 'proj-1', name: 'Alpha', description: 'First project', repository: 'https://github.com/org/alpha', githubOwner: 'org', githubRepo: 'alpha', teamId: 'team-1', ownerId: 'u1', status: null, createdAt: '2025-01-01', updatedAt: '2025-01-02' },
      { id: 'proj-2', name: 'Beta', description: null, repository: null, githubOwner: null, githubRepo: null, teamId: 'team-1', ownerId: 'u1', status: null, createdAt: '2025-02-01', updatedAt: '2025-02-02' },
    ]));

    const plugin = createPlugin(DEFAULT_CONFIG);
    const result = await plugin.invoke('astro_list_projects', {});

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Found 2 project(s)');
    expect(result.content[0].text).toContain('Alpha');
    expect(result.content[0].text).toContain('Beta');
    expect(result.metadata?.projects).toHaveLength(2);
  });

  it('returns empty-state message when no projects exist', async () => {
    vi.stubGlobal('fetch', makeFetch(200, []));

    const plugin = createPlugin(DEFAULT_CONFIG);
    const result = await plugin.invoke('astro_list_projects', {});

    expect(result.content[0].text).toContain('No projects found');
  });

  it('surfaces API errors as isError result', async () => {
    vi.stubGlobal('fetch', makeFetch(401, { error: 'Unauthorized' }));

    const plugin = createPlugin(DEFAULT_CONFIG);
    const result = await plugin.invoke('astro_list_projects', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unauthorized');
  });
});

// ── astro_get_plan ────────────────────────────────────────────────────────────

describe('astro_get_plan', () => {
  afterEach(() => vi.restoreAllMocks());

  const mockNodes = [
    { id: 'node-1', projectId: 'proj-1', title: 'Setup', description: null, status: 'completed', type: null, priority: 'high', estimate: 'S', verification: 'auto', assigneeId: null, milestoneId: null, startDate: null, endDate: null, dueDate: null, executionId: 'exec-1', executionOutput: 'Done', executionError: null, executionStartedAt: null, executionCompletedAt: null, number: 1, createdAt: '2025-01-01', updatedAt: '2025-01-02' },
    { id: 'node-2', projectId: 'proj-1', title: 'Implement', description: 'Core logic', status: 'in_progress', type: null, priority: 'medium', estimate: 'M', verification: 'human', assigneeId: null, milestoneId: null, startDate: null, endDate: null, dueDate: null, executionId: null, executionOutput: null, executionError: null, executionStartedAt: null, executionCompletedAt: null, number: 2, createdAt: '2025-01-01', updatedAt: '2025-01-02' },
  ];
  const mockEdges = [
    { id: 'edge-1', projectId: 'proj-1', source: 'node-1', target: 'node-2', type: 'default' },
  ];

  it('returns plan graph summary with node and edge counts', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => mockNodes })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => mockEdges });
    vi.stubGlobal('fetch', mockFetch);

    const plugin = createPlugin(DEFAULT_CONFIG);
    const result = await plugin.invoke('astro_get_plan', { projectId: 'proj-1' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('2 node(s), 1 edge(s)');
    expect(result.content[0].text).toContain('Setup');
    expect(result.content[0].text).toContain('Implement');
    const graph = result.metadata?.graph as { nodes: unknown[]; edges: unknown[] };
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });

  it('returns error for missing projectId', async () => {
    const plugin = createPlugin(DEFAULT_CONFIG);
    const result = await plugin.invoke('astro_get_plan', { projectId: '' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('projectId is required');
  });

  it('returns empty-state message when project has no nodes', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });
    vi.stubGlobal('fetch', mockFetch);

    const plugin = createPlugin(DEFAULT_CONFIG);
    const result = await plugin.invoke('astro_get_plan', { projectId: 'proj-empty' });

    expect(result.content[0].text).toContain('no plan nodes yet');
  });
});

// ── astro_run_task ────────────────────────────────────────────────────────────

describe('astro_run_task', () => {
  afterEach(() => vi.restoreAllMocks());

  const mockDispatchResponse = {
    executionId: 'exec-abc123',
    nodeId: 'node-1',
    projectId: 'proj-1',
    status: 'dispatched',
    message: 'Task queued on agent runner',
  };

  it('dispatches task and returns executionId', async () => {
    vi.stubGlobal('fetch', makeFetch(200, mockDispatchResponse));

    const plugin = createPlugin(DEFAULT_CONFIG);
    const result = await plugin.invoke('astro_run_task', {
      nodeId: 'node-1',
      projectId: 'proj-1',
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('exec-abc123');
    expect(result.content[0].text).toContain('dispatched');
    expect(result.metadata?.executionId).toBe('exec-abc123');
  });

  it('passes optional fields (title, description, verification) in request body', async () => {
    const mockFetch = makeFetch(200, mockDispatchResponse);
    vi.stubGlobal('fetch', mockFetch);

    const plugin = createPlugin(DEFAULT_CONFIG);
    await plugin.invoke('astro_run_task', {
      nodeId: 'node-1',
      projectId: 'proj-1',
      title: 'My Task',
      description: 'Do the thing',
      verification: 'auto',
    });

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['title']).toBe('My Task');
    expect(body['description']).toBe('Do the thing');
    expect(body['verification']).toBe('auto');
  });

  it('returns error for missing nodeId', async () => {
    const plugin = createPlugin(DEFAULT_CONFIG);
    const result = await plugin.invoke('astro_run_task', { nodeId: '', projectId: 'proj-1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('nodeId is required');
  });

  it('returns error for missing projectId', async () => {
    const plugin = createPlugin(DEFAULT_CONFIG);
    const result = await plugin.invoke('astro_run_task', { nodeId: 'node-1', projectId: '' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('projectId is required');
  });
});

// ── astro_task_status ─────────────────────────────────────────────────────────

describe('astro_task_status', () => {
  afterEach(() => vi.restoreAllMocks());

  const makeExecution = (overrides: Partial<{
    id: string; nodeId: string; projectId: string; status: string;
    output: string | null; error: string | null; startedAt: string | null;
    completedAt: string | null; model: string | null; tokensInput: number | null;
    tokensOutput: number | null; costUsd: number | null; turnCount: number | null;
    providerId: string | null; providerSessionId: string | null;
  }> = {}) => ({
    id: 'exec-abc123',
    nodeId: 'node-1',
    projectId: 'proj-1',
    status: 'completed',
    output: 'Build succeeded.',
    error: null,
    startedAt: '2025-03-01T10:00:00Z',
    completedAt: '2025-03-01T10:05:00Z',
    model: 'claude-opus-4',
    tokensInput: 5000,
    tokensOutput: 1200,
    costUsd: 0.042,
    turnCount: 8,
    providerId: 'machine-1',
    providerSessionId: 'sess-1',
    ...overrides,
  });

  it('returns execution details for completed task', async () => {
    vi.stubGlobal('fetch', makeFetch(200, makeExecution()));

    const plugin = createPlugin(DEFAULT_CONFIG);
    const result = await plugin.invoke('astro_task_status', { executionId: 'exec-abc123' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Completed');
    expect(result.content[0].text).toContain('Build succeeded.');
    expect(result.content[0].text).toContain('$0.0420');
    expect(result.metadata?.isTerminal).toBe(true);
    expect(result.metadata?.isSuccess).toBe(true);
  });

  it('marks in-progress task as non-terminal', async () => {
    vi.stubGlobal('fetch', makeFetch(200, makeExecution({ status: 'in_progress', output: null, completedAt: null })));

    const plugin = createPlugin(DEFAULT_CONFIG);
    const result = await plugin.invoke('astro_task_status', { executionId: 'exec-abc123' });

    expect(result.metadata?.isTerminal).toBe(false);
    expect(result.metadata?.isSuccess).toBe(false);
    expect(result.content[0].text).toContain('Poll again');
  });

  it('includes error output for failed tasks', async () => {
    vi.stubGlobal('fetch', makeFetch(200, makeExecution({ status: 'error', output: null, error: 'Out of memory' })));

    const plugin = createPlugin(DEFAULT_CONFIG);
    const result = await plugin.invoke('astro_task_status', { executionId: 'exec-abc123' });

    expect(result.metadata?.isTerminal).toBe(true);
    expect(result.metadata?.isSuccess).toBe(false);
    expect(result.content[0].text).toContain('Out of memory');
  });

  it('returns error for missing executionId', async () => {
    const plugin = createPlugin(DEFAULT_CONFIG);
    const result = await plugin.invoke('astro_task_status', { executionId: '' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('executionId is required');
  });

  it('handles auto_verified status as terminal + success', async () => {
    vi.stubGlobal('fetch', makeFetch(200, makeExecution({ status: 'auto_verified' })));

    const plugin = createPlugin(DEFAULT_CONFIG);
    const result = await plugin.invoke('astro_task_status', { executionId: 'exec-abc123' });

    expect(result.metadata?.isTerminal).toBe(true);
    expect(result.metadata?.isSuccess).toBe(true);
    expect(result.content[0].text).toContain('auto-verified');
  });
});

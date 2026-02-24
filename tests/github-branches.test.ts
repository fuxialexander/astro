/**
 * Tests for GitHub branch fetching:
 * - GitHubClient.getBranches() method
 * - GET /api/github/branches/:owner/:name route
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── GitHubClient.getBranches ─────────────────────────────────────

describe('GitHubClient.getBranches', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('fetches branches and marks default branch', async () => {
    // Import the real class (not mocked)
    const { GitHubClient } = await import('../server/lib/github-client')
    const client = new GitHubClient('client-id', 'client-secret', 'http://localhost/callback')

    // First call: getRepository (to get defaultBranch)
    // Second call: branches page 1
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 1, node_id: 'abc', name: 'my-repo', full_name: 'owner/my-repo',
          owner: { login: 'owner', avatar_url: 'https://example.com/avatar' },
          private: false, html_url: 'https://github.com/owner/my-repo',
          description: null, fork: false, language: 'TypeScript',
          default_branch: 'main', updated_at: '2025-01-01', pushed_at: '2025-01-01',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { name: 'main' },
          { name: 'develop' },
          { name: 'feature/auth' },
        ],
      })

    const branches = await client.getBranches('test-token', 'owner', 'my-repo')

    expect(branches).toHaveLength(3)
    expect(branches[0]).toEqual({ name: 'main', isDefault: true })
    expect(branches[1]).toEqual({ name: 'develop', isDefault: false })
    expect(branches[2]).toEqual({ name: 'feature/auth', isDefault: false })

    // Verify API calls
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0]).toContain(
      '/repos/owner/my-repo/branches'
    )
  })

  it('paginates when there are more branches than perPage', async () => {
    const { GitHubClient } = await import('../server/lib/github-client')
    const client = new GitHubClient('id', 'secret', 'http://localhost/cb')

    const page1 = [{ name: 'branch-a' }, { name: 'branch-b' }]
    const page2 = [{ name: 'branch-c' }]

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 1, node_id: 'abc', name: 'repo', full_name: 'owner/repo',
          owner: { login: 'owner', avatar_url: '' },
          private: false, html_url: 'https://github.com/owner/repo',
          description: null, fork: false, language: null,
          default_branch: 'branch-a', updated_at: '', pushed_at: '',
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => page1 })
      .mockResolvedValueOnce({ ok: true, json: async () => page2 })

    const branches = await client.getBranches('token', 'owner', 'repo', { perPage: 2 })

    expect(branches).toHaveLength(3)
    expect(branches.map(b => b.name)).toEqual(['branch-a', 'branch-b', 'branch-c'])
    expect(branches[0].isDefault).toBe(true)
    expect(branches[1].isDefault).toBe(false)
  })

  it('stops pagination on empty page', async () => {
    const { GitHubClient } = await import('../server/lib/github-client')
    const client = new GitHubClient('id', 'secret', 'http://localhost/cb')

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 1, node_id: 'abc', name: 'repo', full_name: 'owner/repo',
          owner: { login: 'owner', avatar_url: '' },
          private: false, html_url: 'https://github.com/owner/repo',
          description: null, fork: false, language: null,
          default_branch: 'main', updated_at: '', pushed_at: '',
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })

    const branches = await client.getBranches('token', 'owner', 'repo')

    expect(branches).toHaveLength(0)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws on API error', async () => {
    const { GitHubClient } = await import('../server/lib/github-client')
    const client = new GitHubClient('id', 'secret', 'http://localhost/cb')

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 1, node_id: 'abc', name: 'repo', full_name: 'owner/repo',
          owner: { login: 'owner', avatar_url: '' },
          private: false, html_url: 'https://github.com/owner/repo',
          description: null, fork: false, language: null,
          default_branch: 'main', updated_at: '', pushed_at: '',
        }),
      })
      .mockResolvedValueOnce({ ok: false, statusText: 'Not Found' })

    await expect(client.getBranches('token', 'owner', 'nonexistent')).rejects.toThrow(
      'GitHub API error: Not Found'
    )
  })

  it('sends correct authorization header', async () => {
    const { GitHubClient } = await import('../server/lib/github-client')
    const client = new GitHubClient('id', 'secret', 'http://localhost/cb')

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 1, node_id: 'abc', name: 'repo', full_name: 'owner/repo',
          owner: { login: 'owner', avatar_url: '' },
          private: false, html_url: 'https://github.com/owner/repo',
          description: null, fork: false, language: null,
          default_branch: 'main', updated_at: '', pushed_at: '',
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })

    await client.getBranches('my-secret-token', 'owner', 'repo')

    const branchesCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    expect(branchesCall[1].headers.Authorization).toBe('Bearer my-secret-token')
    expect(branchesCall[1].headers.Accept).toBe('application/vnd.github.v3+json')
  })
})

// ─── GET /api/github/branches/:owner/:name route ──────────────────

describe('GET /api/github/branches/:owner/:name', () => {
  const mockGetConnection = vi.fn()
  const mockGetBranches = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.doMock('../server/lib/github-store', () => ({
      githubStore: {
        getConnection: mockGetConnection,
        isConnected: vi.fn(),
        setOAuthState: vi.fn(),
        verifyOAuthState: vi.fn(),
        setConnection: vi.fn(),
        disconnect: vi.fn(),
        getRepoSelection: vi.fn(),
        setRepoSelection: vi.fn(),
        updateSelectedRepos: vi.fn(),
      },
    }))

    vi.doMock('../server/lib/github-client', () => ({
      GitHubClient: class MockGitHubClient {
        getBranches = mockGetBranches
        getAuthorizationUrl = vi.fn()
        getAccessToken = vi.fn()
        getUser = vi.fn()
        getRepositories = vi.fn()
        getRepository = vi.fn()
      },
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when GitHub is not connected', async () => {
    mockGetConnection.mockReturnValue(null)

    const { default: app } = await import('../server/routes/github')
    const res = await app.request('/branches/owner/repo')

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('GitHub not connected')
  })

  it('returns branches in BranchListResult format', async () => {
    mockGetConnection.mockReturnValue({
      userId: 'default-user',
      accessToken: 'test-token',
      scope: 'repo',
      connectedAt: '2025-01-01',
      user: { id: 1, login: 'testuser' },
    })

    mockGetBranches.mockResolvedValue([
      { name: 'main', isDefault: true },
      { name: 'develop', isDefault: false },
      { name: 'feature/auth', isDefault: false },
    ])

    const { default: app } = await import('../server/routes/github')
    const res = await app.request('/branches/owner/my-repo')

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.branches).toHaveLength(3)
    expect(body.branches[0]).toEqual({
      name: 'main', isRemote: true, isCurrent: false, isDefault: true,
    })
    expect(body.branches[1]).toEqual({
      name: 'develop', isRemote: true, isCurrent: false, isDefault: false,
    })
    expect(body.defaultBranch).toBe('main')
  })

  it('returns 500 when GitHub API fails', async () => {
    mockGetConnection.mockReturnValue({
      userId: 'default-user',
      accessToken: 'test-token',
      scope: 'repo',
      connectedAt: '2025-01-01',
      user: { id: 1, login: 'testuser' },
    })

    mockGetBranches.mockRejectedValue(new Error('API rate limit exceeded'))

    const { default: app } = await import('../server/routes/github')
    const res = await app.request('/branches/owner/repo')

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Failed to fetch branches')
  })

  it('passes correct owner and repo to client', async () => {
    mockGetConnection.mockReturnValue({
      userId: 'default-user',
      accessToken: 'my-token',
      scope: 'repo',
      connectedAt: '2025-01-01',
      user: { id: 1, login: 'testuser' },
    })
    mockGetBranches.mockResolvedValue([])

    const { default: app } = await import('../server/routes/github')
    await app.request('/branches/my-org/my-project')

    expect(mockGetBranches).toHaveBeenCalledWith('my-token', 'my-org', 'my-project')
  })

  it('returns undefined defaultBranch when no branches have isDefault', async () => {
    mockGetConnection.mockReturnValue({
      userId: 'default-user',
      accessToken: 'test-token',
      scope: 'repo',
      connectedAt: '2025-01-01',
      user: { id: 1, login: 'testuser' },
    })
    mockGetBranches.mockResolvedValue([
      { name: 'branch-a', isDefault: false },
    ])

    const { default: app } = await import('../server/routes/github')
    const res = await app.request('/branches/owner/repo')
    const body = await res.json()

    expect(body.defaultBranch).toBeUndefined()
    expect(body.branches).toHaveLength(1)
  })
})

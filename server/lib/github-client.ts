/**
 * GitHub API client for OAuth and repository management
 */

import { createSign } from 'node:crypto';
import type { GitHubRepo, GitHubUser, GitHubTokenResponse, GitHubApiRepo, GitHubComment } from '../types/github';
import { convertToSshUrl } from './git-url-utils.js';
import { db } from './db/index.js';
import { githubConnections, teamMembers } from './db/schema.js';
import { eq } from 'drizzle-orm';

// ── Token Resolution Types ──────────────────────────────────────────────────

export type GitHubTokenType = 'installation' | 'oauth' | 'env';

export interface GitHubTokenResult {
  token: string;
  type: GitHubTokenType;
  /** Human-readable description of where the token came from, for logging */
  source: string;
}

// ── GitHub App JWT ──────────────────────────────────────────────────────────

/**
 * Encode a buffer as URL-safe base64 (base64url) without padding.
 */
function toBase64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Create a signed JWT for GitHub App authentication using RS256.
 *
 * The JWT is valid for 10 minutes and is back-dated by 60 seconds to
 * account for clock skew between the server and GitHub.
 */
function createGitHubAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = toBase64Url(
    JSON.stringify({
      iat: now - 60,  // issued 60 s ago to account for clock skew
      exp: now + 600, // expires in 10 minutes (GitHub's max)
      iss: appId,
    })
  );

  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signatureB64 = sign.sign(privateKey, 'base64');
  // Convert standard base64 → base64url
  const signature = signatureB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return `${header}.${payload}.${signature}`;
}

// ── Installation Token ──────────────────────────────────────────────────────

/**
 * Get a GitHub App installation access token for a specific repository.
 *
 * Requires GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY environment variables.
 * Returns null if the app is not configured or not installed on the repo.
 */
async function getInstallationTokenForRepo(owner: string, repo: string): Promise<string | null> {
  const appId = process.env.GITHUB_APP_ID;
  // Support \n-escaped newlines that are common in env vars stored as single-line strings
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!appId || !privateKey) return null;

  try {
    const jwt = createGitHubAppJwt(appId, privateKey);

    // Look up which installation covers this repo
    const installRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/installation`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (!installRes.ok) {
      // 404 means the app is not installed on this repo — not an error, just no coverage
      if (installRes.status !== 404) {
        console.warn(
          `[github-token] Installation lookup failed for ${owner}/${repo}: HTTP ${installRes.status}`
        );
      }
      return null;
    }

    const install = await installRes.json() as { id: number };
    const installationId = install.id;

    // Exchange the installation ID for a short-lived access token
    const tokenRes = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (!tokenRes.ok) {
      console.warn(
        `[github-token] Failed to create installation token for ${owner}/${repo}: HTTP ${tokenRes.status}`
      );
      return null;
    }

    const tokenData = await tokenRes.json() as { token: string };
    return tokenData.token;
  } catch (err) {
    console.warn(
      `[github-token] Error obtaining installation token for ${owner}/${repo}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

// ── Unified Token Resolver ──────────────────────────────────────────────────

/**
 * Resolve a GitHub API token using the unified priority chain:
 *
 * 1. **GitHub App installation token** — generated dynamically from the app's
 *    private key (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY). Preferred because
 *    it is scoped to the specific repo and has no expiry concerns.
 *
 * 2. **GITHUB_TOKEN env var** — a pre-configured token (e.g. a GitHub Actions
 *    installation token or admin PAT). Used for CI/CD compatibility.
 *
 * 3. **Project owner's OAuth token** — the token stored for the user who owns
 *    the project, fetched from the `githubConnections` table.
 *
 * 4. **Any team member's OAuth token** — last resort; useful when the project
 *    owner has not connected GitHub but a team member has.
 *
 * @param owner  - Repository owner (org or user login)
 * @param repo   - Repository name
 * @param userId - Project owner's user ID; enables OAuth fallback (tier 3)
 * @param teamId - Project's team ID; enables team-member fallback (tier 4)
 * @returns Token result with type + human-readable source, or null if unavailable
 */
export async function resolveGitHubToken(
  owner: string,
  repo: string,
  userId?: string,
  teamId?: string | null,
): Promise<GitHubTokenResult | null> {
  // ── Tier 1: GitHub App installation token ──────────────────────────
  const installToken = await getInstallationTokenForRepo(owner, repo);
  if (installToken) {
    console.log(`[github-token] tier=installation repo=${owner}/${repo}`);
    return {
      token: installToken,
      type: 'installation',
      source: `GitHub App installation for ${owner}`,
    };
  }

  // ── Tier 2: GITHUB_TOKEN env var ──────────────────────────────────
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) {
    console.log(`[github-token] tier=env repo=${owner}/${repo}`);
    return { token: envToken, type: 'env', source: 'GITHUB_TOKEN env var' };
  }

  // ── Tier 3: Project owner's OAuth token ───────────────────────────
  if (userId) {
    const [ownerConn] = await db
      .select({ accessToken: githubConnections.accessToken })
      .from(githubConnections)
      .where(eq(githubConnections.userId, userId))
      .limit(1);

    if (ownerConn?.accessToken) {
      console.log(`[github-token] tier=owner-oauth repo=${owner}/${repo} userId=${userId}`);
      return {
        token: ownerConn.accessToken,
        type: 'oauth',
        source: `owner OAuth (userId=${userId})`,
      };
    }
  }

  // ── Tier 4: Any team member's OAuth token ─────────────────────────
  if (teamId) {
    const [memberConn] = await db
      .select({ accessToken: githubConnections.accessToken })
      .from(githubConnections)
      .innerJoin(teamMembers, eq(teamMembers.userId, githubConnections.userId))
      .where(eq(teamMembers.teamId, teamId))
      .limit(1);

    if (memberConn?.accessToken) {
      console.log(`[github-token] tier=team-oauth repo=${owner}/${repo} teamId=${teamId}`);
      return {
        token: memberConn.accessToken,
        type: 'oauth',
        source: `team member OAuth (teamId=${teamId})`,
      };
    }
  }

  return null;
}

export class GitHubClient {
  private readonly baseUrl = 'https://api.github.com';
  private readonly oauthUrl = 'https://github.com/login/oauth';

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string
  ) {}

  /**
   * Get OAuth authorization URL
   */
  getAuthorizationUrl(state: string, scope = 'repo'): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope,
      state,
    });
    return `${this.oauthUrl}/authorize?${params}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async getAccessToken(code: string): Promise<GitHubTokenResponse> {
    const response = await fetch(`${this.oauthUrl}/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub OAuth error: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Refresh an expired access token using a refresh token.
   * Returns a new token response with fresh access_token and refresh_token.
   */
  async refreshAccessToken(refreshToken: string): Promise<GitHubTokenResponse> {
    const response = await fetch(`${this.oauthUrl}/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub token refresh error: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`GitHub token refresh failed: ${data.error_description || data.error}`);
    }

    return data;
  }

  /**
   * Get authenticated user info
   */
  async getUser(accessToken: string): Promise<GitHubUser> {
    const response = await fetch(`${this.baseUrl}/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      id: data.id,
      login: data.login,
      name: data.name,
      email: data.email,
      avatarUrl: data.avatar_url,
    };
  }

  /**
   * Fetch all repositories for authenticated user
   */
  async getRepositories(
    accessToken: string,
    options: {
      type?: 'all' | 'owner' | 'member';
      sort?: 'created' | 'updated' | 'pushed' | 'full_name';
      direction?: 'asc' | 'desc';
      perPage?: number;
    } = {}
  ): Promise<GitHubRepo[]> {
    const {
      type = 'all',
      sort = 'updated',
      direction = 'desc',
      perPage = 100,
    } = options;

    const repos: GitHubRepo[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        type,
        sort,
        direction,
        per_page: perPage.toString(),
        page: page.toString(),
      });

      const response = await fetch(`${this.baseUrl}/user/repos?${params}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.length === 0) {
        hasMore = false;
      } else {
        repos.push(
          ...data.map((repo: GitHubApiRepo) => ({
            id: repo.id,
            nodeId: repo.node_id,
            name: repo.name,
            fullName: repo.full_name,
            owner: {
              login: repo.owner.login,
              avatarUrl: repo.owner.avatar_url,
            },
            private: repo.private,
            htmlUrl: repo.html_url,
            sshUrl: convertToSshUrl(repo.html_url) || `git@github.com:${repo.full_name}.git`,
            description: repo.description,
            fork: repo.fork,
            language: repo.language,
            defaultBranch: repo.default_branch,
            updatedAt: repo.updated_at,
            pushedAt: repo.pushed_at,
          }))
        );
        page++;
      }
    }

    return repos;
  }

  /**
   * List issues for a repository (paginated through all pages)
   */
  async listIssues(
    accessToken: string,
    owner: string,
    repo: string,
    options: { state?: 'open' | 'closed' | 'all'; perPage?: number } = {}
  ): Promise<Array<{
    number: number;
    title: string;
    body: string | null;
    state: string;
    html_url: string;
    labels: Array<{ name: string; color: string }>;
    assignee: { login: string } | null;
    created_at: string;
    updated_at: string;
  }>> {
    const { state = 'open', perPage = 100 } = options;

    const issues: Array<{
      number: number;
      title: string;
      body: string | null;
      state: string;
      html_url: string;
      labels: Array<{ name: string; color: string }>;
      assignee: { login: string } | null;
      created_at: string;
      updated_at: string;
    }> = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        state,
        per_page: perPage.toString(),
        page: page.toString(),
      });

      const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/issues?${params}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.length === 0) {
        hasMore = false;
      } else {
        // Filter out pull requests (GitHub's issues API includes PRs)
        const issueItems = data.filter(
          (item: Record<string, unknown>) => !item.pull_request
        );
        issues.push(
          ...issueItems.map(
            (item: Record<string, unknown>) => ({
              number: item.number as number,
              title: item.title as string,
              body: (item.body as string | null) ?? null,
              state: item.state as string,
              html_url: item.html_url as string,
              labels: ((item.labels as Array<Record<string, unknown>>) || []).map(
                (l) => ({ name: l.name as string, color: l.color as string })
              ),
              assignee: item.assignee
                ? { login: (item.assignee as Record<string, unknown>).login as string }
                : null,
              created_at: item.created_at as string,
              updated_at: item.updated_at as string,
            })
          )
        );
        if (data.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }

    return issues;
  }

  /**
   * List branches for a repository
   */
  async getBranches(
    accessToken: string,
    owner: string,
    repo: string,
    options: { perPage?: number } = {}
  ): Promise<Array<{ name: string; isDefault: boolean }>> {
    const { perPage = 100 } = options
    const branches: Array<{ name: string; isDefault: boolean }> = []
    let page = 1
    let hasMore = true

    // Fetch repo to get default branch name
    const repoData = await this.getRepository(accessToken, owner, repo)
    const defaultBranch = repoData.defaultBranch

    while (hasMore) {
      const params = new URLSearchParams({
        per_page: perPage.toString(),
        page: page.toString(),
      })

      const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/branches?${params}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      })

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`)
      }

      const data = await response.json()

      if (data.length === 0) {
        hasMore = false
      } else {
        branches.push(
          ...data.map((b: { name: string }) => ({
            name: b.name,
            isDefault: b.name === defaultBranch,
          }))
        )
        if (data.length < perPage) {
          hasMore = false
        } else {
          page++
        }
      }
    }

    return branches
  }

  /**
   * Close a GitHub issue by setting its state to 'closed'
   */
  async closeIssue(
    accessToken: string,
    owner: string,
    repo: string,
    issueNumber: number,
    options: { stateReason?: 'completed' | 'not_planned' } = {}
  ): Promise<{ success: boolean; error?: string }> {
    const { stateReason = 'completed' } = options;

    try {
      const response = await fetch(
        `${this.baseUrl}/repos/${owner}/${repo}/issues/${issueNumber}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            state: 'closed',
            state_reason: stateReason,
          }),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          error: `GitHub API error ${response.status}: ${errorBody}`,
        };
      }

      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  /**
   * Get a specific repository
   */
  async getRepository(
    accessToken: string,
    owner: string,
    repo: string
  ): Promise<GitHubRepo> {
    const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      id: data.id,
      nodeId: data.node_id,
      name: data.name,
      fullName: data.full_name,
      owner: {
        login: data.owner.login,
        avatarUrl: data.owner.avatar_url,
      },
      private: data.private,
      htmlUrl: data.html_url,
      description: data.description,
      fork: data.fork,
      language: data.language,
      defaultBranch: data.default_branch,
      updatedAt: data.updated_at,
      pushedAt: data.pushed_at,
    };
  }

  /**
   * Create a new issue in a repository
   */
  async createIssue(
    accessToken: string,
    owner: string,
    repo: string,
    options: {
      title: string;
      body?: string;
      labels?: string[];
      assignees?: string[];
    }
  ): Promise<{
    number: number;
    title: string;
    html_url: string;
    state: string;
  }> {
    const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: options.title,
        body: options.body || '',
        labels: options.labels || [],
        assignees: options.assignees || [],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    return {
      number: data.number,
      title: data.title,
      html_url: data.html_url,
      state: data.state,
    };
  }

  /**
   * Search issues in a repository by query string
   */
  async searchIssues(
    accessToken: string,
    owner: string,
    repo: string,
    options: { query?: string; state?: 'open' | 'closed' | 'all'; perPage?: number } = {}
  ): Promise<Array<{
    number: number;
    title: string;
    state: string;
    html_url: string;
    labels: Array<{ name: string; color: string }>;
  }>> {
    const { query, state = 'open', perPage = 20 } = options;

    // Use GitHub search API for query, or list API for browsing
    if (query && query.trim()) {
      const searchQuery = `${query} repo:${owner}/${repo} is:issue state:${state}`;
      const params = new URLSearchParams({
        q: searchQuery,
        per_page: perPage.toString(),
        sort: 'updated',
        order: 'desc',
      });

      const response = await fetch(`${this.baseUrl}/search/issues?${params}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }

      const data = await response.json();
      return (data.items || [])
        .filter((item: Record<string, unknown>) => !item.pull_request)
        .map((item: Record<string, unknown>) => ({
          number: item.number as number,
          title: item.title as string,
          state: item.state as string,
          html_url: item.html_url as string,
          labels: ((item.labels as Array<Record<string, unknown>>) || []).map(
            (l) => ({ name: l.name as string, color: l.color as string })
          ),
        }));
    }

    // No query — just list recent issues
    return this.listIssues(accessToken, owner, repo, { state, perPage });
  }

  /**
   * Fetch issue comments for a given issue/PR number.
   * Uses conditional requests (ETag/If-None-Match) for efficient polling.
   */
  async getIssueComments(
    accessToken: string,
    owner: string,
    repo: string,
    issueNumber: number,
    options: { perPage?: number; etag?: string } = {}
  ): Promise<{ comments: GitHubComment[]; etag?: string; notModified: boolean }> {
    const { perPage = 100, etag } = options;
    const comments: GitHubComment[] = [];
    let page = 1;
    let hasMore = true;
    let responseEtag: string | undefined;

    while (hasMore) {
      const params = new URLSearchParams({
        per_page: perPage.toString(),
        page: page.toString(),
        sort: 'created',
        direction: 'asc',
      });

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      };
      if (etag && page === 1) {
        headers['If-None-Match'] = etag;
      }

      const response = await fetch(
        `${this.baseUrl}/repos/${owner}/${repo}/issues/${issueNumber}/comments?${params}`,
        { headers }
      );

      if (response.status === 304) {
        return { comments: [], notModified: true, etag };
      }

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }

      if (page === 1) {
        responseEtag = response.headers.get('etag') ?? undefined;
      }

      const data = await response.json();
      if (data.length === 0) {
        hasMore = false;
      } else {
        comments.push(
          ...data.map((c: Record<string, unknown>) => ({
            id: c.id as number,
            author: {
              login: (c.user as Record<string, unknown>)?.login as string ?? 'unknown',
              avatar: (c.user as Record<string, unknown>)?.avatar_url as string ?? '',
            },
            body: (c.body as string) ?? '',
            createdAt: c.created_at as string,
            updatedAt: c.updated_at as string,
            type: 'issue_comment' as const,
          }))
        );
        if (data.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }

    return { comments, etag: responseEtag, notModified: false };
  }

  /**
   * Fetch PR review comments (inline code comments) for a pull request.
   * Uses conditional requests (ETag/If-None-Match) for efficient polling.
   */
  async getPRReviewComments(
    accessToken: string,
    owner: string,
    repo: string,
    prNumber: number,
    options: { perPage?: number; etag?: string } = {}
  ): Promise<{ comments: GitHubComment[]; etag?: string; notModified: boolean }> {
    const { perPage = 100, etag } = options;
    const comments: GitHubComment[] = [];
    let page = 1;
    let hasMore = true;
    let responseEtag: string | undefined;

    while (hasMore) {
      const params = new URLSearchParams({
        per_page: perPage.toString(),
        page: page.toString(),
        sort: 'created',
        direction: 'asc',
      });

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      };
      if (etag && page === 1) {
        headers['If-None-Match'] = etag;
      }

      const response = await fetch(
        `${this.baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}/comments?${params}`,
        { headers }
      );

      if (response.status === 304) {
        return { comments: [], notModified: true, etag };
      }

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }

      if (page === 1) {
        responseEtag = response.headers.get('etag') ?? undefined;
      }

      const data = await response.json();
      if (data.length === 0) {
        hasMore = false;
      } else {
        comments.push(
          ...data.map((c: Record<string, unknown>) => ({
            id: c.id as number,
            author: {
              login: (c.user as Record<string, unknown>)?.login as string ?? 'unknown',
              avatar: (c.user as Record<string, unknown>)?.avatar_url as string ?? '',
            },
            body: (c.body as string) ?? '',
            createdAt: c.created_at as string,
            updatedAt: c.updated_at as string,
            type: 'review_comment' as const,
            inReplyTo: (c.in_reply_to_id as number) ?? undefined,
            path: (c.path as string) ?? undefined,
            line: (c.line as number) ?? (c.original_line as number) ?? undefined,
          }))
        );
        if (data.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }

    return { comments, etag: responseEtag, notModified: false };
  }

  /**
   * Fetch all comments (issue + PR review) for an issue/PR number.
   * Merges both types into a unified list sorted by creation time.
   */
  async getAllComments(
    accessToken: string,
    owner: string,
    repo: string,
    issueOrPrNumber: number,
    options: { perPage?: number; issueEtag?: string; reviewEtag?: string } = {}
  ): Promise<{
    comments: GitHubComment[];
    issueEtag?: string;
    reviewEtag?: string;
    totalCount: number;
  }> {
    // Fetch both issue comments and PR review comments in parallel
    const [issueResult, reviewResult] = await Promise.allSettled([
      this.getIssueComments(accessToken, owner, repo, issueOrPrNumber, {
        perPage: options.perPage,
        etag: options.issueEtag,
      }),
      this.getPRReviewComments(accessToken, owner, repo, issueOrPrNumber, {
        perPage: options.perPage,
        etag: options.reviewEtag,
      }),
    ]);

    const issueComments = issueResult.status === 'fulfilled' && !issueResult.value.notModified
      ? issueResult.value.comments
      : [];
    const reviewComments = reviewResult.status === 'fulfilled' && !reviewResult.value.notModified
      ? reviewResult.value.comments
      : [];

    const allComments = [...issueComments, ...reviewComments]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return {
      comments: allComments,
      issueEtag: issueResult.status === 'fulfilled' ? issueResult.value.etag : undefined,
      reviewEtag: reviewResult.status === 'fulfilled' ? reviewResult.value.etag : undefined,
      totalCount: allComments.length,
    };
  }
}

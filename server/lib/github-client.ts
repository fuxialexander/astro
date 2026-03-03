/**
 * GitHub API client for OAuth and repository management
 */

import type { GitHubRepo, GitHubUser, GitHubTokenResponse, GitHubApiRepo, GitHubComment } from '../types/github';
import { convertToSshUrl } from './git-url-utils.js';

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

/**
 * GitHub API client for OAuth and repository management
 */

import type { GitHubRepo, GitHubUser, GitHubTokenResponse, GitHubApiRepo } from '../types/github';
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
}

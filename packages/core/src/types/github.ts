/**
 * GitHub integration types (shared)
 */

// Raw GitHub API response (snake_case from API)
export interface GitHubApiRepo {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  owner: {
    login: string;
    avatar_url: string;
  };
  private: boolean;
  html_url: string;
  description: string | null;
  fork: boolean;
  language: string | null;
  default_branch: string;
  updated_at: string;
  pushed_at: string;
}

export interface GitHubRepo {
  id: number;
  nodeId: string;
  name: string;
  fullName: string;
  owner: {
    login: string;
    avatarUrl: string;
  };
  private: boolean;
  htmlUrl: string;
  sshUrl: string;
  description: string | null;
  fork: boolean;
  language: string | null;
  defaultBranch: string;
  updatedAt: string;
  pushedAt: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string;
}

export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface GitHubConnection {
  userId: string;
  accessToken: string;
  scope: string;
  connectedAt: string;
  user: GitHubUser;
}

export interface GitHubRepoSelection {
  userId: string;
  selectedRepoIds: number[];
  repos: GitHubRepo[];
  lastSyncedAt: string;
}

// ── GitHub Comments ──────────────────────────────────────────────

/** Unified comment format for issue comments and PR review comments */
export interface GitHubComment {
  id: number;
  author: {
    login: string;
    avatar: string;
  };
  body: string;
  createdAt: string;
  updatedAt: string;
  type: 'issue_comment' | 'review_comment';
  /** For threaded review comments — the parent comment ID */
  inReplyTo?: number;
  /** File path for PR review comments */
  path?: string;
  /** Line number for PR review comments */
  line?: number;
}

/** Response from the comments API endpoint */
export interface GitHubCommentsResponse {
  comments: GitHubComment[];
  totalCount: number;
  etag?: string;
}

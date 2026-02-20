/**
 * GitHub REST API Client
 *
 * Thin wrapper around GitHub's REST API for posting comments,
 * updating issues, and creating check runs.
 */

const GITHUB_API_BASE = 'https://api.github.com'

interface GitHubApiResponse {
  id?: number
  html_url?: string
  message?: string
  [key: string]: unknown
}

/**
 * Post a comment on a GitHub issue or pull request.
 */
export async function postGitHubComment(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<GitHubApiResponse> {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    }
  )

  const data = (await response.json()) as GitHubApiResponse
  if (!response.ok) {
    console.error(`[github-api] postComment failed: ${data.message}`)
  }
  return data
}

/**
 * Update a GitHub issue (title, state, labels, assignees, etc.).
 */
export async function updateGitHubIssue(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  updates: Record<string, unknown>
): Promise<GitHubApiResponse> {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    }
  )

  const data = (await response.json()) as GitHubApiResponse
  if (!response.ok) {
    console.error(`[github-api] updateIssue failed: ${data.message}`)
  }
  return data
}

/**
 * Create a check run on a commit.
 */
export async function createCheckRun(
  token: string,
  owner: string,
  repo: string,
  headSha: string,
  data: Record<string, unknown>
): Promise<GitHubApiResponse> {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/check-runs`,
    {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ head_sha: headSha, ...data }),
    }
  )

  const result = (await response.json()) as GitHubApiResponse
  if (!response.ok) {
    console.error(`[github-api] createCheckRun failed: ${result.message}`)
  }
  return result
}

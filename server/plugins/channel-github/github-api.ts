/**
 * GitHub REST API Client
 *
 * Thin wrapper around GitHub's REST API for posting comments,
 * updating issues, and creating check runs.
 */

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql'

interface GitHubApiResponse {
  id?: number
  node_id?: string
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

/**
 * Add labels to a GitHub issue or pull request.
 */
export async function addLabelsToIssue(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[]
): Promise<GitHubApiResponse> {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
    {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ labels }),
    }
  )

  const data = (await response.json()) as GitHubApiResponse
  if (!response.ok) {
    console.error(`[github-api] addLabelsToIssue failed: ${data.message}`)
  }
  return data
}

/**
 * Get a pull request by number.
 */
export async function getPullRequest(
  token: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<GitHubApiResponse> {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
      },
    }
  )

  const data = (await response.json()) as GitHubApiResponse
  if (!response.ok) {
    console.error(`[github-api] getPullRequest failed: ${data.message}`)
  }
  return data
}

/**
 * Update the body (description) of a pull request.
 */
export async function updatePullRequestBody(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      }
    )

    if (!response.ok) {
      const data = (await response.json()) as GitHubApiResponse
      const errorMsg = data.message || `HTTP ${response.status}`
      console.error(`[github-api] updatePullRequestBody failed: ${errorMsg}`)
      return { success: false, error: errorMsg }
    }

    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[github-api] updatePullRequestBody error: ${msg}`)
    return { success: false, error: msg }
  }
}

/**
 * Enable auto-merge on a pull request via GitHub's GraphQL API.
 * This requires the repo to have merge queue or auto-merge enabled in branch protection.
 */
export async function enableAutoMerge(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  mergeMethod: 'MERGE' | 'SQUASH' | 'REBASE' = 'SQUASH'
): Promise<{ success: boolean; error?: string }> {
  // First get the PR's node_id (GraphQL global ID)
  const pr = await getPullRequest(token, owner, repo, prNumber)
  const nodeId = pr.node_id
  if (!nodeId) {
    return { success: false, error: 'Could not get PR node_id' }
  }

  const mutation = `
    mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
      enablePullRequestAutoMerge(input: {
        pullRequestId: $pullRequestId
        mergeMethod: $mergeMethod
      }) {
        pullRequest {
          autoMergeRequest {
            enabledAt
            mergeMethod
          }
        }
      }
    }
  `

  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Authorization': `bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        pullRequestId: nodeId,
        mergeMethod,
      },
    }),
  })

  const result = (await response.json()) as { data?: unknown; errors?: Array<{ message: string }> }

  if (result.errors?.length) {
    const errorMsg = result.errors.map((e) => e.message).join(', ')
    console.error(`[github-api] enableAutoMerge failed: ${errorMsg}`)
    return { success: false, error: errorMsg }
  }

  return { success: true }
}

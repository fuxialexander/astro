/**
 * Linear GraphQL API Client
 *
 * Thin wrapper around Linear's GraphQL API for posting comments,
 * updating issues, and querying issue details.
 */

const LINEAR_API_URL = 'https://api.linear.app/graphql'

interface LinearApiResponse {
  data?: Record<string, unknown>
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>
}

async function linearRequest(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<LinearApiResponse> {
  const response = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  const data = (await response.json()) as LinearApiResponse
  if (data.errors?.length) {
    console.error(`[linear-api] GraphQL errors:`, data.errors.map((e) => e.message).join(', '))
  }
  return data
}

/**
 * Post a comment on a Linear issue.
 */
export async function postLinearComment(
  token: string,
  issueId: string,
  body: string
): Promise<LinearApiResponse> {
  const query = `
    mutation CommentCreate($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment {
          id
          body
        }
      }
    }
  `
  return linearRequest(token, query, {
    input: { issueId, body },
  })
}

/**
 * Update a Linear issue (title, state, assignee, priority, etc.).
 */
export async function updateLinearIssue(
  token: string,
  issueId: string,
  input: Record<string, unknown>
): Promise<LinearApiResponse> {
  const query = `
    mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          id
          title
          state {
            name
          }
        }
      }
    }
  `
  return linearRequest(token, query, { id: issueId, input })
}

/**
 * Query details for a Linear issue.
 */
export async function queryLinearIssue(
  token: string,
  issueId: string
): Promise<LinearApiResponse> {
  const query = `
    query Issue($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        state {
          id
          name
          type
        }
        assignee {
          id
          name
        }
        priority
        team {
          id
          name
        }
        labels {
          nodes {
            id
            name
          }
        }
      }
    }
  `
  return linearRequest(token, query, { id: issueId })
}

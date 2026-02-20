/**
 * Slack Web API Client
 *
 * Thin wrapper around the Slack Web API for posting and updating messages.
 */

interface SlackPostMessageParams {
  channel: string
  text: string
  thread_ts?: string
}

interface SlackUpdateMessageParams {
  channel: string
  ts: string
  text: string
}

interface SlackApiResponse {
  ok: boolean
  error?: string
  ts?: string
  channel?: string
}

const SLACK_API_BASE = 'https://slack.com/api'

/**
 * Post a message to a Slack channel or thread.
 */
export async function postSlackMessage(
  token: string,
  params: SlackPostMessageParams
): Promise<SlackApiResponse> {
  const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  })

  const data = (await response.json()) as SlackApiResponse
  if (!data.ok) {
    console.error(`[slack-api] chat.postMessage failed: ${data.error}`)
  }
  return data
}

/**
 * Update an existing Slack message.
 */
export async function updateSlackMessage(
  token: string,
  params: SlackUpdateMessageParams
): Promise<SlackApiResponse> {
  const response = await fetch(`${SLACK_API_BASE}/chat.update`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  })

  const data = (await response.json()) as SlackApiResponse
  if (!data.ok) {
    console.error(`[slack-api] chat.update failed: ${data.error}`)
  }
  return data
}

/**
 * Telegram Bot API Client
 *
 * Thin wrapper around the Telegram Bot API for sending messages
 * and configuring webhooks.
 */

interface TelegramSendMessageParams {
  chat_id: string | number
  text: string
  parse_mode?: 'HTML' | 'MarkdownV2'
  reply_to_message_id?: number
}

interface TelegramSetWebhookParams {
  url: string
  secret_token?: string
}

interface TelegramApiResponse {
  ok: boolean
  description?: string
  result?: unknown
}

/**
 * Send a message to a Telegram chat.
 */
export async function sendTelegramMessage(
  token: string,
  params: TelegramSendMessageParams
): Promise<TelegramApiResponse> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })

  const data = (await response.json()) as TelegramApiResponse
  if (!data.ok) {
    console.error(`[telegram-api] sendMessage failed: ${data.description}`)
  }
  return data
}

/**
 * Set the webhook URL for the Telegram bot.
 * @param secret - Optional secret token for webhook verification
 */
export async function setTelegramWebhook(
  token: string,
  url: string,
  secret?: string
): Promise<TelegramApiResponse> {
  const params: TelegramSetWebhookParams = { url }
  if (secret) {
    params.secret_token = secret
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })

  const data = (await response.json()) as TelegramApiResponse
  if (!data.ok) {
    console.error(`[telegram-api] setWebhook failed: ${data.description}`)
  }
  return data
}

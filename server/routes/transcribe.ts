import { Hono } from 'hono'

const transcribeRoute = new Hono()

/**
 * POST /api/transcribe
 *
 * Transcribes audio using OpenAI's Whisper API.
 * Expects multipart/form-data with an 'audio' file field.
 *
 * Returns: { text: string } on success
 * Returns: { error: string } on failure
 */
transcribeRoute.post('/', async (c) => {
  const openaiApiKey = process.env.OPENAI_API_KEY

  if (!openaiApiKey) {
    return c.json({ error: 'OpenAI API key not configured. Set OPENAI_API_KEY environment variable.' }, 500)
  }

  try {
    // Parse the multipart form data
    const formData = await c.req.formData()
    const audioFile = formData.get('audio')

    if (!audioFile || !(audioFile instanceof File)) {
      return c.json({ error: 'No audio file provided' }, 400)
    }

    // Validate file size (max 25MB for Whisper API)
    const maxSize = 25 * 1024 * 1024
    if (audioFile.size > maxSize) {
      return c.json({ error: 'Audio file too large. Maximum size is 25MB.' }, 400)
    }

    // Create FormData for OpenAI API
    const openaiFormData = new FormData()
    openaiFormData.append('file', audioFile, audioFile.name || 'audio.webm')
    openaiFormData.append('model', 'whisper-1')
    openaiFormData.append('response_format', 'json')

    // Call OpenAI Whisper API
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
      },
      body: openaiFormData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[transcribe] OpenAI API error:', response.status, errorText)
      return c.json({ error: `Transcription failed: ${response.status}` }, 500)
    }

    const result = await response.json() as { text: string }
    return c.json({ text: result.text })
  } catch (error) {
    console.error('[transcribe] Error:', error)
    return c.json({ error: 'Transcription failed' }, 500)
  }
})

/**
 * GET /api/transcribe/status
 *
 * Check if transcription service is available (OpenAI API key configured)
 */
transcribeRoute.get('/status', async (c) => {
  const openaiApiKey = process.env.OPENAI_API_KEY
  return c.json({
    available: !!openaiApiKey,
    provider: 'openai',
    model: 'whisper-1',
  })
})

export { transcribeRoute }

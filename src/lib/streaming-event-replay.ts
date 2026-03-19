import type { StreamingEventRow } from '@/lib/api-client'

/**
 * DB-backed catch-up rows store text as { text: "..." }, while live SSE sends
 * raw text payloads. Replay paths must convert DB rows back into the live SSE
 * shape before handing them to SSE-oriented handlers.
 */
export function getStreamingReplayData(
  eventType: string,
  data: unknown,
): string {
  if (eventType === 'text' && typeof data === 'object' && data !== null && 'text' in data) {
    const text = (data as { text?: unknown }).text
    return typeof text === 'string' ? text : ''
  }

  return typeof data === 'string' ? data : JSON.stringify(data)
}

export function getStreamingRowReplayData(
  row: Pick<StreamingEventRow, 'eventType' | 'data'>,
): string {
  return getStreamingReplayData(row.eventType, row.data)
}

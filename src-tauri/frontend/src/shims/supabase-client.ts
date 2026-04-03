/**
 * Supabase client shim for Tauri desktop.
 *
 * The desktop app does not use Supabase auth — it talks directly to the
 * backend API.  This shim satisfies imports from the shared web-app code
 * without pulling in @supabase/supabase-js.
 */

export function setCachedSession(_session: unknown): void {}

export function getSupabase(): null {
  return null
}

export function shouldUseSupabase(): boolean {
  return false
}

export function isSupabaseConfigured(): boolean {
  return false
}

export async function getAccessToken(): Promise<string | null> {
  return null
}

export async function getSession(): Promise<null> {
  return null
}

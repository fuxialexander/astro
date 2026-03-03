/**
 * Shared helper for building authenticated fetch headers.
 * Used by Zustand stores that call authenticated API endpoints.
 */
import { getAccessToken } from '@/lib/supabase-client';

export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = await getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * Shared helper for building authenticated fetch headers.
 * Used by Zustand stores that call authenticated API endpoints.
 * Includes the default team context for team-owned resources when available.
 *
 * In HIPAA mode the token comes from the local hipaa-auth-bus (localStorage)
 * instead of Supabase.
 */
import { getAccessToken } from '@/lib/supabase-client';
import { getActiveTeamId } from '@/lib/api-client';
import { isHipaaMode } from '@/lib/app-mode';
import { getHipaaAccessToken } from '@/lib/hipaa-auth-bus';

export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = isHipaaMode() ? getHipaaAccessToken() : await getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const teamId = getActiveTeamId();
  if (teamId) headers['X-Team-Id'] = teamId;
  return headers;
}

/**
 * Ensure User Profile Exists
 *
 * Safety net for auth.users ↔ user_profiles desync.
 * If a user exists in auth.users but not in user_profiles (e.g. trigger failed),
 * this function creates the missing profile row.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Check if a user_profiles row exists for the given user ID.
 * If not, look up auth.users metadata and create the profile.
 *
 * @returns The user profile row, or null if the user doesn't exist in auth.users either.
 */
export async function ensureUserProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ id: string; name: string; email: string } | null> {
  // 1. Check if profile already exists
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('id, name, email')
    .eq('id', userId)
    .single()

  if (existing) return existing

  // 2. Profile missing — look up auth.users for metadata
  const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(userId)

  if (authError || !authUser?.user) {
    console.error('[ensure-profile] Auth user not found for ID:', userId, authError)
    return null
  }

  const name = authUser.user.user_metadata?.name || ''
  const email = authUser.user.email || ''

  // 3. Create the missing profile (upsert to handle race conditions)
  const { data: created, error: createError } = await supabase
    .from('user_profiles')
    .upsert(
      { id: userId, name, email },
      { onConflict: 'id' },
    )
    .select('id, name, email')
    .single()

  if (createError) {
    console.error('[ensure-profile] Failed to create profile for:', userId, createError)
    return null
  }

  console.log('[ensure-profile] Created missing profile for user:', userId)
  return created
}

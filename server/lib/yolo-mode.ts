/**
 * Check if YOLO mode is enabled for a user.
 * Reads fresh from DB each time (not cached) so mid-session toggles work.
 */
export async function isYoloMode(userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  try {
    const { userProfiles } = await import('./db/schema.js')
    const { eq } = await import('drizzle-orm')
    const { db } = await import('./db/index.js')
    const [profile] = await db.select({ settings: userProfiles.settings })
      .from(userProfiles).where(eq(userProfiles.id, userId)).limit(1)
    return (profile?.settings as Record<string, string> | null)?.yoloMode === 'true'
  } catch {
    return false
  }
}

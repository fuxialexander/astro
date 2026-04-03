/**
 * Check if YOLO mode is enabled for a user.
 * Reads fresh from DB each time (not cached) so mid-session toggles work.
 *
 * For playground tasks (taskId starts with "playground-"), checks the separate
 * playgroundYoloMode setting so users can have different YOLO behavior for
 * playground vs project tasks.
 */
export async function isYoloMode(userId: string | undefined, taskId?: string): Promise<boolean> {
  if (!userId) return false
  try {
    const { userProfiles } = await import('./db/schema.js')
    const { eq } = await import('drizzle-orm')
    const { db } = await import('./db/index.js')
    const [profile] = await db.select({ settings: userProfiles.settings })
      .from(userProfiles).where(eq(userProfiles.id, userId)).limit(1)
    const settings = profile?.settings as Record<string, string> | null
    if (taskId?.startsWith('playground-') || taskId?.startsWith('session-')) {
      return settings?.playgroundYoloMode === 'true'
    }
    // Default ON when unset (matches frontend default for new users)
    return settings?.yoloMode !== 'false'
  } catch {
    return false
  }
}

// Color palette for projects and initiatives
export const COLOR_PALETTE = [
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#84cc16', // lime
  '#22c55e', // green
  '#10b981', // emerald
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#6366f1', // indigo
  '#a855f7', // violet
  '#d946ef', // fuchsia
  '#64748b', // slate
] as const;

// Emoji icons for projects
export const PROJECT_ICONS = [
  '📋', '📝', '💻', '🚀', '⚡', '🎯',
  '📊', '🔬', '🧪', '📈', '🎨', '🏗️',
  '🔧', '⚙️', '🛠️', '📱', '🌐', '🔐',
  '📦', '🎮', '🎬', '📷', '🎵', '📚',
  '🧬', '🔭', '🌟', '💡', '🧠', '🎓',
] as const;

// Emoji icons for initiatives
export const INITIATIVE_ICONS = [
  '🎯', '🚀', '⭐', '🏆', '💎', '🔥',
  '⚡', '🌟', '💫', '✨', '🎪', '🎭',
  '🎨', '🎬', '🎯', '🏅', '🎖️', '👑',
  '🔮', '🌈', '🎁', '🎊', '🎉', '🎈',
] as const;

// Get a random color from the palette
export function getRandomColor(): string {
  return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
}

// Get a random project icon
export function getRandomProjectIcon(): string {
  return PROJECT_ICONS[Math.floor(Math.random() * PROJECT_ICONS.length)];
}

// Get a random initiative icon
export function getRandomInitiativeIcon(): string {
  return INITIATIVE_ICONS[Math.floor(Math.random() * INITIATIVE_ICONS.length)];
}

// Get a color that's distinct from the given colors
export function getDistinctColor(existingColors: string[]): string {
  const available = COLOR_PALETTE.filter(c => !existingColors.includes(c));
  if (available.length === 0) return getRandomColor();
  return available[0];
}

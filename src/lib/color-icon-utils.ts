// Color palette for projects and initiatives
export const COLOR_PALETTE = [
  '#64748b', // slate
  '#71717a', // zinc
  '#6366f1', // indigo
  '#06b6d4', // cyan
  '#22c55e', // green
  '#eab308', // yellow
  '#f97316', // orange
  '#dc2626', // red
  '#e11d48', // rose
] as const;

// Font Awesome icon names for projects (from react-icons/fa)
export const PROJECT_FA_ICONS = [
  'FaBox', 'FaSmile', 'FaFrown', 'FaGrinTongue', 'FaMeh', 'FaGrimace',
  'FaMask', 'FaHandsClapping', 'FaRunning', 'FaFootball', 'FaAccessibleIcon',
  'FaDna', 'FaHeart', 'FaPlus', 'FaPills', 'FaTag', 'FaDroplet',
  'FaPalette', 'FaCookie', 'FaPyramid', 'FaLeaf', 'FaTree',
  'FaPalm', 'FaSeedling', 'FaClover', 'FaBowlFood', 'FaCoffee',
  'FaBreadSlice', 'FaBowlRice', 'FaStar', 'FaSun', 'FaCloud',
  'FaCloudBolt', 'FaBolt', 'FaFire', 'FaUmbrella', 'FaFlagCheckered',
  'FaFlag', 'FaGolf', 'FaDumbbell', 'FaBaseball', 'FaMusic',
  'FaGuitar', 'FaCamera', 'FaFilm', 'FaTv', 'FaGamepad',
  'FaPuzzlePiece', 'FaDice', 'FaChess', 'FaCarrot', 'FaPepperHot',
  'FaIceCream', 'FaBirthdayCake', 'FaMugHot', 'FaBeer', 'FaWineBottle',
  'FaPizzaSlice', 'FaHamburger', 'FaHotdog', 'FaAppleWhole', 'FaLemon',
  'FaWorm', 'FaBug', 'FaSpider', 'FaCat', 'FaDog',
  'FaFish', 'FaHorse', 'FaCrow', 'FaDragon', 'FaRocket',
  'FaPlane', 'FaHelicopter', 'FaCar', 'FaBicycle', 'FaShip',
  'FaTruck', 'FaBus', 'FaTrain', 'FaEarthAmerica', 'FaGlobe',
  'FaMountain', 'FaMapPin', 'FaCompass', 'FaAnchor', 'FaKiwiBird',
] as const;

// Emoji icons for projects (kept for backwards compatibility)
export const PROJECT_EMOJI_ICONS = [
  '📋', '📝', '💻', '🚀', '⚡', '🎯',
  '📊', '🔬', '🧪', '📈', '🎨', '🏗️',
  '🔧', '⚙️', '🛠️', '📱', '🌐', '🔐',
  '📦', '🎮', '🎬', '📷', '🎵', '📚',
  '🧬', '🔭', '🌟', '💡', '🧠', '🎓',
] as const;

// Font Awesome icon names for initiatives
export const INITIATIVE_FA_ICONS = [
  'FaBullseye', 'FaRocket', 'FaStar', 'FaTrophy', 'FaGem', 'FaFire',
  'FaBolt', 'FaMagic', 'FaCrown', 'FaMedal', 'FaAward', 'FaFlag',
  'FaChartLine', 'FaLightbulb', 'FaBrain', 'FaEye', 'FaHeart',
  'FaHandshake', 'FaUsers', 'FaGlobe', 'FaMountain', 'FaCompass',
  'FaDiamond', 'FaFlask', 'FaAtom', 'FaDna', 'FaMicroscope',
] as const;

// Emoji icons for initiatives (kept for backwards compatibility)
export const INITIATIVE_EMOJI_ICONS = [
  '🎯', '🚀', '⭐', '🏆', '💎', '🔥',
  '⚡', '🌟', '💫', '✨', '🎪', '🎭',
  '🎨', '🎬', '🎯', '🏅', '🎖️', '👑',
  '🔮', '🌈', '🎁', '🎊', '🎉', '🎈',
] as const;

// Get a random color from the palette
export function getRandomColor(): string {
  return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
}

// Get a random project icon (Font Awesome)
export function getRandomProjectIcon(): string {
  return PROJECT_FA_ICONS[Math.floor(Math.random() * PROJECT_FA_ICONS.length)];
}

// Get a random initiative icon (Font Awesome)
export function getRandomInitiativeIcon(): string {
  return INITIATIVE_FA_ICONS[Math.floor(Math.random() * INITIATIVE_FA_ICONS.length)];
}

// Get a random project emoji (backwards compatibility)
export function getRandomProjectEmoji(): string {
  return PROJECT_EMOJI_ICONS[Math.floor(Math.random() * PROJECT_EMOJI_ICONS.length)];
}

// Get a random initiative emoji (backwards compatibility)
export function getRandomInitiativeEmoji(): string {
  return INITIATIVE_EMOJI_ICONS[Math.floor(Math.random() * INITIATIVE_EMOJI_ICONS.length)];
}

// Get a color that's distinct from the given colors
export function getDistinctColor(existingColors: string[]): string {
  const available = COLOR_PALETTE.filter(c => !existingColors.includes(c));
  if (available.length === 0) return getRandomColor();
  return available[0];
}

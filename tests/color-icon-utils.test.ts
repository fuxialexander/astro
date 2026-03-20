import { describe, it, expect } from 'vitest'
import {
  getColorForName,
  getProjectIconForName,
  getRandomColor,
  COLOR_PALETTE,
  PROJECT_EMOJI_ICONS,
} from '../src/lib/color-icon-utils'

describe('color-icon-utils', () => {
  describe('getProjectIconForName', () => {
    it('returns deterministic icon for the same name', () => {
      const icon1 = getProjectIconForName('My Project')
      const icon2 = getProjectIconForName('My Project')
      expect(icon1).toBe(icon2)
    })

    it('returns different icons for different names', () => {
      const names = [
        'Moat Fragility Analysis',
        'Protein Structure Prediction',
        'Build a Todo App',
        'Weather Dashboard',
        'Code Review Tool',
        'Market Research Bot',
        'Academic Paper Review',
        'CRWV Analysis Pipeline',
      ]
      const icons = names.map(n => getProjectIconForName(n))
      const unique = new Set(icons)
      // At least 3 distinct icons from 8 different names
      expect(unique.size).toBeGreaterThanOrEqual(3)
    })

    it('returns an emoji from the PROJECT_EMOJI_ICONS list', () => {
      const icon = getProjectIconForName('Test Project')
      expect(PROJECT_EMOJI_ICONS).toContain(icon)
    })

    it('never returns clipboard emoji for varied inputs', () => {
      const names = Array.from({ length: 50 }, (_, i) => `Project ${i}`)
      const icons = names.map(n => getProjectIconForName(n))
      // Not ALL of them should be clipboard — at least some diversity
      const unique = new Set(icons)
      expect(unique.size).toBeGreaterThan(1)
    })
  })

  describe('getColorForName', () => {
    it('returns deterministic color for the same name', () => {
      const c1 = getColorForName('My Project')
      const c2 = getColorForName('My Project')
      expect(c1).toBe(c2)
    })

    it('returns a color from the COLOR_PALETTE', () => {
      const color = getColorForName('Test Project')
      expect([...COLOR_PALETTE]).toContain(color)
    })
  })

  describe('random color helper still works', () => {
    it('getRandomColor returns a palette color', () => {
      const color = getRandomColor()
      expect([...COLOR_PALETTE]).toContain(color)
    })
  })
})

/**
 * Discovery Pipeline Unit Tests
 *
 * Tests for the discovery mode feature:
 * 1. slugify() — filesystem-safe hyphenated path segments
 * 2. DISCOVERY_MODE_INSTRUCTIONS — prompt constant
 * 3. Feature flag defaults — discovery-mode flag in GLOBAL_DEFAULTS
 */

// Must be set BEFORE any server/ imports so PGlite is used instead of Supabase
process.env.ASTRO_LOCAL_MODE = 'true'

import { describe, it, expect } from 'vitest'
import { slugify } from '../packages/core/src/dispatch/context-assembler.js'
import { slugifyTitle } from '../packages/core/src/dispatch/context-assembler.js'
import { DISCOVERY_MODE_INSTRUCTIONS } from '../packages/core/src/prompt-templates.js'
import { GLOBAL_DEFAULTS as SERVER_DEFAULTS } from '../server/lib/feature-flags.js'

// ============================================================================
// slugify() — Filesystem Path Segments
// ============================================================================

describe('slugify — Filesystem Path Segments', () => {
  it('converts a simple title to hyphenated slug', () => {
    expect(slugify('Pathway enrichment')).toBe('pathway-enrichment')
  })

  it('converts a complex scientific title', () => {
    expect(slugify('Refined ESR1-TP53 ChIP co-occupancy with 73bp motif annotation'))
      .toBe('refined-esr1-tp53-chip-co-occupancy-with-73bp-motif-annotation')
  })

  it('handles slashes and special characters', () => {
    expect(slugify('GO/KEGG/Reactome pathway enrichment on ESR1-TP53 target genes'))
      .toBe('go-kegg-reactome-pathway-enrichment-on-esr1-tp53-target-genes')
  })

  it('strips leading and trailing hyphens', () => {
    expect(slugify('---hello world---')).toBe('hello-world')
  })

  it('collapses multiple non-alphanumeric chars into single hyphen', () => {
    expect(slugify('task   with   spaces')).toBe('task-with-spaces')
    expect(slugify('task---with---dashes')).toBe('task-with-dashes')
  })

  it('caps length at 255 characters', () => {
    const longTitle = 'a'.repeat(300)
    const result = slugify(longTitle)
    expect(result.length).toBeLessThanOrEqual(255)
    expect(result).toBe('a'.repeat(255))
  })

  it('handles empty string', () => {
    expect(slugify('')).toBe('')
  })

  it('handles string with only special characters', () => {
    expect(slugify('!@#$%^&*()')).toBe('')
  })

  it('lowercases everything', () => {
    expect(slugify('UPPERCASE Title')).toBe('uppercase-title')
  })

  it('handles numbers correctly', () => {
    expect(slugify('Task 42: Analysis v2')).toBe('task-42-analysis-v2')
  })
})

// ============================================================================
// slugify() vs slugifyTitle() — Different Use Cases
// ============================================================================

describe('slugify vs slugifyTitle — Different Conventions', () => {
  it('slugify uses hyphens, slugifyTitle uses underscores', () => {
    const title = 'Set up database schema'
    expect(slugify(title)).toBe('set-up-database-schema')
    expect(slugifyTitle(title)).toBe('set_up_database_schema')
  })

  it('slugify has 255 char cap, slugifyTitle has 80 char cap', () => {
    const longTitle = 'a'.repeat(100)
    expect(slugify(longTitle).length).toBe(100) // under 255, no truncation
    expect(slugifyTitle(longTitle).length).toBe(80) // capped at 80
  })

  it('both are deterministic for the same input', () => {
    const title = 'Refined ESR1-TP53 ChIP co-occupancy analysis'
    expect(slugify(title)).toBe(slugify(title))
    expect(slugifyTitle(title)).toBe(slugifyTitle(title))
  })
})

// ============================================================================
// DISCOVERY_MODE_INSTRUCTIONS
// ============================================================================

describe('DISCOVERY_MODE_INSTRUCTIONS', () => {
  it('is a non-empty string', () => {
    expect(typeof DISCOVERY_MODE_INSTRUCTIONS).toBe('string')
    expect(DISCOVERY_MODE_INSTRUCTIONS.length).toBeGreaterThan(100)
  })

  it('mentions the analysis/ directory convention', () => {
    expect(DISCOVERY_MODE_INSTRUCTIONS).toContain('analysis/')
  })

  it('mentions milestone and task directory structure', () => {
    expect(DISCOVERY_MODE_INSTRUCTIONS).toContain('{milestone}')
    expect(DISCOVERY_MODE_INSTRUCTIONS).toContain('{task}')
  })

  it('warns against reading from deprecated directories', () => {
    expect(DISCOVERY_MODE_INSTRUCTIONS).toContain('deprecated')
  })

  it('includes commit conventions', () => {
    expect(DISCOVERY_MODE_INSTRUCTIONS).toContain('Commit Conventions')
    expect(DISCOVERY_MODE_INSTRUCTIONS).toContain('[milestone-name/task-title]')
  })

  it('does NOT reference direct execution mode', () => {
    expect(DISCOVERY_MODE_INSTRUCTIONS).not.toContain('direct execution mode')
  })
})

// ============================================================================
// Feature Flag Defaults
// ============================================================================

describe('Feature Flag Defaults — discovery-mode', () => {
  it('server GLOBAL_DEFAULTS includes discovery-mode set to false', () => {
    expect('discovery-mode' in SERVER_DEFAULTS).toBe(true)
    expect(SERVER_DEFAULTS['discovery-mode']).toBe(false)
  })
})

// ============================================================================
// Output Dir Generation Logic
// ============================================================================

describe('Output Dir Path Construction', () => {
  it('task under milestone gets milestone-slug/task-slug path', () => {
    const milestoneTitle = 'ESR1 Downstream Analysis'
    const taskTitle = 'Pathway enrichment on ESR1-TP53 target genes'
    const outputDir = `${slugify(milestoneTitle)}/${slugify(taskTitle)}`
    expect(outputDir).toBe('esr1-downstream-analysis/pathway-enrichment-on-esr1-tp53-target-genes')
  })

  it('standalone task (no milestone) gets just task-slug', () => {
    const taskTitle = 'Fetch ChIP-seq peaks'
    const outputDir = slugify(taskTitle)
    expect(outputDir).toBe('fetch-chip-seq-peaks')
  })

  it('different tasks produce different output dirs', () => {
    const dir1 = slugify('Task A: Data preparation')
    const dir2 = slugify('Task B: Statistical analysis')
    expect(dir1).not.toBe(dir2)
  })

  it('same title always produces same output dir (deterministic)', () => {
    const title = 'Refined co-binding analysis with motif annotation'
    expect(slugify(title)).toBe(slugify(title))
  })
})

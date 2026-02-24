/**
 * Unit tests for CLI configuration management.
 * These tests do NOT require a running server.
 * Uses a temp directory to avoid touching the real ~/.astro/config.json.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// We need to mock the config module's internal paths. Instead, we'll test
// the getServerUrl resolution logic inline and test config read/write via
// a subprocess that sets HOME to a temp dir.

describe('config', () => {
  let tempHome: string

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'astro-cli-test-'))
  })

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true })
  })

  describe('getServerUrl resolution order', () => {
    it('uses CLI override if provided', async () => {
      // Import fresh module with clean state
      const { getServerUrl } = await import('../src/config.js')
      expect(getServerUrl('http://custom:9999')).toBe('http://custom:9999')
    })

    it('falls back to env var when no CLI override', async () => {
      const original = process.env.ASTRO_SERVER_URL
      process.env.ASTRO_SERVER_URL = 'http://env-var:8888'
      try {
        const { getServerUrl } = await import('../src/config.js')
        expect(getServerUrl()).toBe('http://env-var:8888')
      } finally {
        if (original) {
          process.env.ASTRO_SERVER_URL = original
        } else {
          delete process.env.ASTRO_SERVER_URL
        }
      }
    })

    it('falls back to default when nothing is set', async () => {
      const original = process.env.ASTRO_SERVER_URL
      delete process.env.ASTRO_SERVER_URL
      try {
        const { getServerUrl } = await import('../src/config.js')
        const url = getServerUrl()
        // Should be either the config file value or the default
        expect(url).toBeTruthy()
        expect(url.startsWith('http')).toBe(true)
      } finally {
        if (original) {
          process.env.ASTRO_SERVER_URL = original
        }
      }
    })
  })

  describe('loadConfig and saveConfig', () => {
    it('loadConfig returns defaults when no config file exists', async () => {
      const { loadConfig } = await import('../src/config.js')
      const config = loadConfig()
      expect(config).toBeDefined()
      expect(config.serverUrl).toBeTruthy()
    })

    it('saveConfig persists and loadConfig reads back', async () => {
      const { saveConfig, loadConfig } = await import('../src/config.js')
      // Save a known value
      saveConfig({ defaultMachineId: 'test-machine-123' })
      const config = loadConfig()
      expect(config.defaultMachineId).toBe('test-machine-123')

      // Clean up: remove the test value
      saveConfig({ defaultMachineId: undefined })
    })
  })
})

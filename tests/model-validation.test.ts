/**
 * Model alias validation tests.
 *
 * Tests that model values from the settings store use CLI aliases
 * for claude-code provider. The Claude Code CLI resolves these
 * aliases via environment variables:
 *   ANTHROPIC_DEFAULT_OPUS_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL, ANTHROPIC_DEFAULT_HAIKU_MODEL
 *
 * This ensures Bedrock/Vertex users whose env vars point to provider-specific
 * model names (e.g. "us.anthropic.claude-opus-4-6-vl") are not overridden.
 *
 * Run with: npx vitest run tests/model-validation.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  defaultModelTierMap,
  resolveModel,
  type ModelTier,
} from '../src/stores/settings-store'

// Valid CLI aliases that Claude Code understands
const VALID_CLI_ALIASES = ['opus', 'sonnet', 'haiku']

describe('Model alias validation', () => {
  describe('defaultModelTierMap claude-code models use CLI aliases', () => {
    const claudeCodeModels = Object.entries(defaultModelTierMap).map(
      ([tier, providers]) => ({ tier, model: providers['claude-sdk'] })
    )

    for (const { tier, model } of claudeCodeModels) {
      it(`${tier} tier: "${model}" is a valid CLI alias`, () => {
        expect(VALID_CLI_ALIASES).toContain(model)
      })
    }
  })

  describe('alias-to-tier mapping is correct', () => {
    it('large tier uses "opus" alias', () => {
      expect(defaultModelTierMap.large['claude-sdk']).toBe('opus')
    })

    it('medium tier uses "sonnet" alias', () => {
      expect(defaultModelTierMap.medium['claude-sdk']).toBe('sonnet')
    })

    it('small tier uses "haiku" alias', () => {
      expect(defaultModelTierMap.small['claude-sdk']).toBe('haiku')
    })
  })

  describe('aliases contain model family names', () => {
    const allClaudeModels = Object.values(defaultModelTierMap)
      .map((providers) => providers['claude-sdk'])

    for (const model of allClaudeModels) {
      it(`"${model}" contains a model family name`, () => {
        expect(model).toMatch(/opus|sonnet|haiku/)
      })
    }
  })

  describe('resolveModel returns valid aliases for all tiers', () => {
    const tiers: ModelTier[] = ['large', 'medium', 'small']

    for (const tier of tiers) {
      it(`resolveModel("${tier}") returns a non-empty string`, () => {
        const model = resolveModel(tier)
        expect(model).toBeTruthy()
        expect(typeof model).toBe('string')
        expect(model.length).toBeGreaterThan(0)
      })

      it(`resolveModel("${tier}", "claude-code") is a valid CLI alias`, () => {
        const model = resolveModel(tier, 'claude-sdk')
        expect(VALID_CLI_ALIASES).toContain(model)
      })
    }
  })

  describe('SDK passes alias as --model CLI arg (no transformation)', () => {
    // This test documents the SDK behavior: it passes the model string
    // directly as `--model <value>` to the Claude Code CLI.
    // The CLI then resolves the alias via ANTHROPIC_DEFAULT_*_MODEL env vars.
    it('alias is passed through unchanged', () => {
      // Simulate what the SDK does (sdk.mjs line 7686-7687):
      // if (model) args.push("--model", model);
      const model = resolveModel('medium', 'claude-sdk')
      const args: string[] = []
      if (model) {
        args.push('--model', model)
      }
      expect(args).toEqual(['--model', 'sonnet'])
    })

    it('undefined model results in no --model arg (uses CLI default)', () => {
      const model: string | undefined = undefined
      const args: string[] = []
      if (model) {
        args.push('--model', model)
      }
      expect(args).toEqual([])
    })
  })

  describe('codex models are full model IDs (not aliases)', () => {
    it('codex large is "o3"', () => {
      expect(defaultModelTierMap.large.codex).toBe('o3')
    })

    it('codex medium is "gpt-5.3-codex"', () => {
      expect(defaultModelTierMap.medium.codex).toBe('gpt-5.3-codex')
    })

    it('codex small is "codex-mini"', () => {
      expect(defaultModelTierMap.small.codex).toBe('codex-mini')
    })
  })
})

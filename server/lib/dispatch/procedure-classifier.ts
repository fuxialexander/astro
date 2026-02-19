/**
 * Procedure Classifier
 *
 * Auto-classifies task descriptions into procedure types using a fast model.
 * Maps classification to built-in procedure names for the subroutine pipeline.
 */

import Anthropic from '@anthropic-ai/sdk'
import { errorMessage } from '../error-utils.js'

/** Classification result */
export interface ClassificationResult {
  /** Procedure name to use (null means skip pipeline, run direct) */
  procedure: string | null
  /** Raw classification label */
  classification: string
}

/**
 * Classify a task to determine which procedure pipeline to use.
 *
 * Uses haiku for fast, cheap classification. Returns null procedure for
 * simple tasks that don't need the full pipeline.
 */
export async function classifyTask(
  title: string,
  description: string
): Promise<ClassificationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // No API key — skip classification, run direct
    return { procedure: null, classification: 'simple' }
  }

  try {
    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: `Classify this task into exactly one category. Respond with ONLY the category name, nothing else.

Categories:
- code: Writing new code, implementing features, adding functionality
- bug-fix: Fixing bugs, resolving errors, debugging issues
- research: Investigating, analyzing, exploring codebase, gathering information
- simple: Quick questions, config changes, one-line fixes, documentation edits

Task title: ${title}
Task description: ${description}`,
        },
      ],
    })

    const text =
      response.content[0]?.type === 'text'
        ? response.content[0].text.trim().toLowerCase()
        : 'simple'

    // Map classification to procedure name
    const procedureMap: Record<string, string | null> = {
      code: 'full-development',
      'bug-fix': 'bug-fix',
      research: 'research',
      simple: null,
    }

    // Normalize: strip whitespace, match known categories
    const normalized = text.replace(/[^a-z-]/g, '')
    const classification = Object.keys(procedureMap).includes(normalized)
      ? normalized
      : 'simple'

    return {
      procedure: procedureMap[classification] ?? null,
      classification,
    }
  } catch (err) {
    console.warn(
      `[procedure-classifier] Classification failed, defaulting to direct execution: ${errorMessage(err)}`
    )
    return { procedure: null, classification: 'simple' }
  }
}

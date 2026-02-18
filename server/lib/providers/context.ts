/**
 * Context Injection Abstraction
 *
 * Provides a unified interface for injecting context into provider tasks.
 * Different providers have different mechanisms for context injection:
 * - Claude Code: --context-file flag or system prompt
 * - Codex: Environment variables or prompt prefix
 * - Gemini: System instruction or context parameter
 *
 * This module abstracts those differences so the agent runner can inject
 * context uniformly regardless of the provider.
 */

import { writeFile, unlink, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type {
  TaskContext,
  PreparedContext,
  ContextInjectionMethod,
} from './types.js'

/**
 * Context builder that creates prepared context for any injection method.
 */
export class ContextBuilder {
  private parts: Map<string, string> = new Map()
  private tempFiles: string[] = []

  /**
   * Add a vision document to the context.
   */
  withVisionDoc(visionDoc: string | undefined): this {
    if (visionDoc) {
      this.parts.set('vision', `## Project Vision Document\n\n${visionDoc}`)
    }
    return this
  }

  /**
   * Add dependency context (upstream task outputs, etc.).
   */
  withDependencyContext(dependencyContext: string | undefined): this {
    if (dependencyContext) {
      this.parts.set('dependencies', `## Dependency Context\n\n${dependencyContext}`)
    }
    return this
  }

  /**
   * Add working directory information.
   */
  withWorkingDirectory(workingDirectory: string | undefined): this {
    if (workingDirectory) {
      this.parts.set('workdir', `## Working Directory\n\n${workingDirectory}`)
    }
    return this
  }

  /**
   * Add execution environment information.
   */
  withEnvironment(environment: string | undefined): this {
    if (environment) {
      this.parts.set('environment', `## Execution Environment\n\n${environment}`)
    }
    return this
  }

  /**
   * Add arbitrary context section.
   */
  withSection(key: string, title: string, content: string): this {
    this.parts.set(key, `## ${title}\n\n${content}`)
    return this
  }

  /**
   * Build context from a TaskContext object.
   */
  fromTaskContext(context: TaskContext): this {
    return this
      .withVisionDoc(context.visionDoc)
      .withDependencyContext(context.dependencyContext)
      .withWorkingDirectory(context.workingDirectory)
      .withEnvironment(context.environment)
  }

  /**
   * Get the raw context content as a single string.
   */
  getContent(): string {
    if (this.parts.size === 0) {
      return ''
    }
    return Array.from(this.parts.values()).join('\n\n---\n\n')
  }

  /**
   * Check if the builder has any content.
   */
  hasContent(): boolean {
    return this.parts.size > 0
  }

  /**
   * Build prepared context for a specific injection method.
   */
  async build(method: ContextInjectionMethod): Promise<PreparedContext> {
    const content = this.getContent()

    if (!content) {
      return { method }
    }

    switch (method) {
      case 'context_file':
        return this.buildContextFile(content)

      case 'system_prompt':
        return {
          method: 'system_prompt',
          promptContent: content,
        }

      case 'prompt_prefix':
        return {
          method: 'prompt_prefix',
          promptContent: content,
        }

      case 'custom':
        return {
          method: 'custom',
          customData: {
            sections: Object.fromEntries(this.parts),
            combined: content,
          },
        }

      default:
        return { method }
    }
  }

  /**
   * Build a context file and return its path.
   */
  private async buildContextFile(content: string): Promise<PreparedContext> {
    const tempDir = join(tmpdir(), 'astro-context')
    await mkdir(tempDir, { recursive: true })

    const fileName = `context-${randomUUID()}.md`
    const filePath = join(tempDir, fileName)

    await writeFile(filePath, content, 'utf-8')
    this.tempFiles.push(filePath)

    return {
      method: 'context_file',
      filePath,
      promptContent: content, // Also include content for fallback
    }
  }

  /**
   * Clean up any temporary files created.
   */
  async cleanup(): Promise<void> {
    for (const file of this.tempFiles) {
      try {
        await unlink(file)
      } catch {
        // Ignore cleanup errors
      }
    }
    this.tempFiles = []
  }
}

/**
 * Helper function to quickly prepare context from a TaskContext.
 */
export async function prepareContext(
  context: TaskContext,
  method: ContextInjectionMethod
): Promise<PreparedContext> {
  const builder = new ContextBuilder().fromTaskContext(context)
  return builder.build(method)
}

/**
 * Helper function to inject context into a prompt.
 * Returns the modified prompt with context prepended (if applicable).
 */
export function injectContextIntoPrompt(
  prompt: string,
  preparedContext: PreparedContext
): string {
  if (preparedContext.method === 'prompt_prefix' && preparedContext.promptContent) {
    return `${preparedContext.promptContent}\n\n---\n\n${prompt}`
  }
  return prompt
}

/**
 * Context injection strategy interface.
 * Providers can implement this for custom context handling.
 */
export interface ContextInjectionStrategy {
  /**
   * Prepare context for injection.
   */
  prepare(context: TaskContext): Promise<PreparedContext>

  /**
   * Apply the prepared context to a task execution.
   * Returns any modifications to the execution parameters.
   */
  apply(
    preparedContext: PreparedContext,
    params: {
      prompt: string
      systemPrompt?: string
      options?: Record<string, unknown>
    }
  ): {
    prompt: string
    systemPrompt?: string
    options?: Record<string, unknown>
  }

  /**
   * Clean up any resources (temp files, etc.).
   */
  cleanup(preparedContext: PreparedContext): Promise<void>
}

/**
 * System prompt injection strategy.
 * Injects context via the system prompt parameter.
 */
export class SystemPromptStrategy implements ContextInjectionStrategy {
  async prepare(context: TaskContext): Promise<PreparedContext> {
    return prepareContext(context, 'system_prompt')
  }

  apply(
    preparedContext: PreparedContext,
    params: {
      prompt: string
      systemPrompt?: string
      options?: Record<string, unknown>
    }
  ): {
    prompt: string
    systemPrompt?: string
    options?: Record<string, unknown>
  } {
    if (!preparedContext.promptContent) {
      return params
    }

    const contextSystemPrompt = preparedContext.promptContent
    const existingSystemPrompt = params.systemPrompt

    return {
      ...params,
      systemPrompt: existingSystemPrompt
        ? `${contextSystemPrompt}\n\n---\n\n${existingSystemPrompt}`
        : contextSystemPrompt,
    }
  }

  async cleanup(): Promise<void> {
    // No cleanup needed for system prompt strategy
  }
}

/**
 * Prompt prefix injection strategy.
 * Prepends context to the user prompt.
 */
export class PromptPrefixStrategy implements ContextInjectionStrategy {
  async prepare(context: TaskContext): Promise<PreparedContext> {
    return prepareContext(context, 'prompt_prefix')
  }

  apply(
    preparedContext: PreparedContext,
    params: {
      prompt: string
      systemPrompt?: string
      options?: Record<string, unknown>
    }
  ): {
    prompt: string
    systemPrompt?: string
    options?: Record<string, unknown>
  } {
    return {
      ...params,
      prompt: injectContextIntoPrompt(params.prompt, preparedContext),
    }
  }

  async cleanup(): Promise<void> {
    // No cleanup needed for prompt prefix strategy
  }
}

/**
 * Context file injection strategy.
 * Creates a temporary file and passes its path to the provider.
 */
export class ContextFileStrategy implements ContextInjectionStrategy {
  private builder: ContextBuilder | null = null

  async prepare(context: TaskContext): Promise<PreparedContext> {
    this.builder = new ContextBuilder().fromTaskContext(context)
    return this.builder.build('context_file')
  }

  apply(
    preparedContext: PreparedContext,
    params: {
      prompt: string
      systemPrompt?: string
      options?: Record<string, unknown>
    }
  ): {
    prompt: string
    systemPrompt?: string
    options?: Record<string, unknown>
  } {
    if (!preparedContext.filePath) {
      // Fall back to prompt prefix if no file path
      return {
        ...params,
        prompt: injectContextIntoPrompt(params.prompt, {
          method: 'prompt_prefix',
          promptContent: preparedContext.promptContent,
        }),
      }
    }

    return {
      ...params,
      options: {
        ...params.options,
        contextFile: preparedContext.filePath,
      },
    }
  }

  async cleanup(): Promise<void> {
    if (this.builder) {
      await this.builder.cleanup()
      this.builder = null
    }
  }
}

/**
 * Get the appropriate context injection strategy for a method.
 */
export function getContextStrategy(method: ContextInjectionMethod): ContextInjectionStrategy {
  switch (method) {
    case 'system_prompt':
      return new SystemPromptStrategy()
    case 'prompt_prefix':
      return new PromptPrefixStrategy()
    case 'context_file':
      return new ContextFileStrategy()
    case 'custom':
      // Custom methods should implement their own strategy
      return new SystemPromptStrategy() // Default fallback
    default:
      return new SystemPromptStrategy()
  }
}

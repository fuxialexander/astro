/**
 * OpenClaw Plugin SDK type definitions.
 *
 * These types model the OpenClaw gateway plugin contract:
 * - Tool definitions declare input schemas that the gateway validates.
 * - Tool results carry both human-readable content and machine-readable metadata.
 * - The plugin descriptor wires tools into named gateway methods.
 *
 * NOTE: OpenClaw is a pluggable AI tool gateway. This file defines the subset
 * of its SDK types used by the Astro plugin. Update if the upstream SDK evolves.
 */

// ── JSON Schema subset (input schema declarations) ────────────────────────────

export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

export interface JsonSchemaProperty {
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
  default?: unknown;
}

export interface JsonSchema {
  type: 'object';
  required?: string[];
  properties?: Record<string, JsonSchemaProperty>;
  additionalProperties?: boolean;
}

// ── Tool primitives ───────────────────────────────────────────────────────────

/** A single content block returned by a tool. */
export interface ToolContentBlock {
  type: 'text' | 'image' | 'json';
  text?: string;
  data?: unknown;
  mimeType?: string;
}

/** The result returned by every tool handler. */
export interface OpenClawToolResult {
  /** Human-readable content blocks surfaced to the caller. */
  content: ToolContentBlock[];
  /** Machine-readable structured data attached alongside content. */
  metadata?: Record<string, unknown>;
  /** Set to true when the tool invocation itself failed (vs. API error). */
  isError?: boolean;
}

/** Declarative description of a single OpenClaw tool. */
export interface OpenClawToolDefinition {
  /** Unique tool name (snake_case, no spaces). */
  name: string;
  /** Human-readable description shown to the LLM / gateway console. */
  description: string;
  /** JSON Schema describing the tool's input object. */
  inputSchema: JsonSchema;
}

// ── Plugin gateway registration ───────────────────────────────────────────────

/**
 * Typed handler for a single tool invocation.
 * The generic parameter describes the validated input shape.
 */
export type ToolHandler<TInput = Record<string, unknown>> = (
  input: TInput,
) => Promise<OpenClawToolResult>;

/** A fully wired tool: definition + handler bound to a configured client. */
export interface RegisteredTool {
  definition: OpenClawToolDefinition;
  handler: ToolHandler;
}

/** The plugin descriptor returned by the plugin entry-point factory. */
export interface OpenClawPlugin {
  /** Plugin identifier — matches `id` in openclaw.plugin.json. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Semantic version string. */
  version: string;
  /** All tools exposed by this plugin, keyed by tool name. */
  tools: Map<string, RegisteredTool>;
  /**
   * Invoke a named tool with raw (unvalidated) input.
   * The plugin is responsible for its own validation.
   */
  invoke(toolName: string, input: Record<string, unknown>): Promise<OpenClawToolResult>;
}

/** Configuration supplied by the OpenClaw gateway when loading this plugin. */
export interface PluginConfig {
  serverUrl: string;
  authToken: string;
  teamId?: string;
}

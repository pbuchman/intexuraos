/**
 * Tool Calling Types.
 *
 * Abstract types for LLM tool calling / function calling.
 * Provider-specific implementations live in infra-* packages.
 *
 * @packageDocumentation
 */

import type { Result } from '@intexuraos/common-core';
import type { LLMError, NormalizedUsage } from './types.js';

/**
 * A message in the tool calling conversation.
 *
 * The 'tool' role is not needed — Gemini uses functionResponse parts
 * within the conversation contents, not a separate role.
 */
export interface ToolCallingMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Definition of a tool that can be invoked by the LLM.
 *
 * Tool definitions include both the schema (sent to the LLM as
 * function declarations) and the `run` callback (executed when
 * the LLM invokes the tool).
 *
 * Callbacks are caller-provided closures that capture application
 * dependencies (e.g., taskDispatcher, codeTaskRepo) via closure scope.
 */
export interface ToolDefinition {
  /** Tool name (must match what the LLM calls) */
  name: string;
  /** Human-readable description for the LLM */
  description: string;
  /** JSON Schema for the tool's parameters */
  parameters: Record<string, unknown>;
  /**
   * Execute the tool. Called by the agent loop when the LLM invokes this tool.
   * Returns a JSON string that is sent back to the LLM as a functionResponse.
   */
  run: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * Abstract tool calling client interface.
 *
 * Logger, auditSink, and usageSink are baked into the client instance
 * at factory creation time — callers do not pass them.
 */
export interface ToolCallingClient {
  /**
   * Run the agent loop.
   *
   * Sends the system prompt + messages to the LLM with tool declarations.
   * The loop continues until the LLM returns a text response (no tool calls)
   * or maxIterations is reached.
   */
  run(params: {
    systemPrompt: string;
    messages: ToolCallingMessage[];
    tools: ToolDefinition[];
    /** Maximum iterations of the tool calling loop (default: 5) */
    maxIterations?: number;
    /** Called when maxIterations exhausted without text. Return a repair message to inject, or undefined to fail. */
    onExhausted?: (context: {
      iterationCount: number;
      toolCallsMade: number;
    }) => string | undefined;
    /** Max extra iterations after repair message injection (default: 2) */
    repairIterations?: number;
  }): Promise<Result<ToolCallingResult, LLMError>>;
}

/**
 * Result of a completed tool calling session.
 */
export interface ToolCallingResult {
  /** Final LLM text response */
  content: string;
  /** Total tool calls made across all iterations */
  toolCallsMade: number;
  /** Total iterations (including final text response) */
  iterationCount: number;
  /** Aggregated token usage and cost across all iterations */
  usage: NormalizedUsage;
}

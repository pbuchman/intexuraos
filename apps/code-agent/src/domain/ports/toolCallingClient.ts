import type { Result } from '@intexuraos/common-core';

export interface ToolCallingMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<string>;
}

export interface ToolCallingUsage {
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ToolCallingResult {
  content: string;
  toolCallsMade: number;
  iterationCount: number;
  usage: ToolCallingUsage;
}

export interface ToolCallingError {
  code: string;
  message: string;
}

export interface ToolCallingClient {
  run(params: {
    systemPrompt: string;
    messages: ToolCallingMessage[];
    tools: ToolDefinition[];
    maxIterations?: number;
  }): Promise<Result<ToolCallingResult, ToolCallingError>>;
}

/**
 * LLM Client Factory
 *
 * Provides a unified interface for creating LLM clients
 * across different providers (Anthropic, OpenAI, Perplexity, OpenRouter).
 *
 * @packageDocumentation
 *
 * @remarks
 * This factory abstracts away the provider-specific client creation,
 * allowing apps to switch between LLM providers using a single interface.
 *
 * @example
 * ```ts
 * import { createLlmClient } from '@intexuraos/llm-factory';
 *
 * const client = createLlmClient({
 *   apiKey: 'sk-...',
 *   model: 'or:google/gemini-3-flash-preview',
 *   userId: 'user-123',
 *   logger: pinoLogger,
 *   usageSink: myUsageSink,
 * });
 *
 * const result = await client.generate('Write a poem');
 * if (result.ok) {
 *   console.log(result.value.content);
 * }
 * ```
 */

import { createOpenRouterToolCallingClient } from '@intexuraos/infra-openrouter';
import type { UsageSink } from '@intexuraos/llm-pricing';
import {
  getOpenRouterRawId,
  getProviderForModel,
  isOpenRouterModel,
  isLegacyGoogleModel,
  isToolCallingModel,
  isValidModel,
  LlmProviders,
  type GenerateChatOptions,
  type GenerateChatResult,
  type GenerateChatStreamEvent,
  type MatrixCorpusLlmCallContextV1,
  type MatrixCorpusProviderCallUsageV1,
  type LLMError,
  type LLMModel,
  type LlmChatMessage,
  type LlmResponseFormat,
  type OpenRouterModelId,
  type ToolCallingClient,
  type ToolCallingModel,
  type OwnerType,
} from '@intexuraos/llm-contract';
import { createOpenRouterGenerateClient } from './openRouterGenerateClient.js';
import { createClaudeGenerateClient } from './claudeGenerateClient.js';
import { createGptGenerateClient } from './gptGenerateClient.js';
import { createPerplexityGenerateClient } from './perplexityGenerateClient.js';
import { IntexuraOSError, type Logger, type Result } from '@intexuraos/common-core';

/**
 * Configuration for creating an LLM client.
 */
export interface LlmClientConfig {
  /** API key for the LLM provider */
  apiKey: string;
  /** Model identifier (for Google models use an `or:google/...` OpenRouter ID) */
  model: LLMModel | OpenRouterModelId;
  /** User ID for usage tracking */
  userId: string;
  /** Logger for structured LLM usage logging */
  logger: Logger;
  /** Usage sink. Required — pass NoopUsageSink to explicitly opt out. */
  usageSink: UsageSink;
  /**
   * Owner scope of the call.
   * When omitted, downstream defaults to 'system' to preserve legacy behavior.
   * Pass 'user' for calls initiated directly by a human (e.g. chat, code tasks).
   */
  ownerType?: OwnerType;
  /** Optional provider request timeout in milliseconds. */
  timeoutMs?: number;
  /** Optional transient provider attempt cap. */
  maxAttempts?: number;
  /** Optional absolute wall-clock deadline shared by provider calls. */
  deadlineAtMs?: number;
}

export interface ToolCallingClientConfig {
  apiKey: string;
  model: ToolCallingModel;
  userId: string;
  logger: Logger;
  usageSink: UsageSink;
  ownerType?: OwnerType;
  /** Optional provider request timeout in milliseconds. */
  timeoutMs?: number;
  /** Optional transient provider attempt cap. */
  maxAttempts?: number;
  /** Optional absolute wall-clock deadline shared by provider calls. */
  deadlineAtMs?: number;
}

/**
 * Result of a successful LLM generation.
 */
export interface GenerateResult {
  /** Generated text content */
  content: string;
  /** Usage statistics */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    providerReportedUsd?: number;
  };
  providerCall?: MatrixCorpusProviderCallUsageV1;
}

/**
 * Options for LLM generation.
 */
export interface GenerateOptions {
  /** Semantic identifier for the prompt type (e.g., 'linear-issue-title', 'code-worker-validation') */
  promptType: string;
  /** Optional provider-enforced response shape. */
  responseFormat?: LlmResponseFormat;
  /**
   * Optional per-call correlation overrides. Threaded through to the
   * usage event's `correlation` block so attribution to a specific
   * research run / chat session / code task / orchestrator request is
   * preserved at the granularity of a single LLM call.
   */
  correlation?: {
    researchId?: string | null;
    sessionId?: string | null;
    taskId?: string | null;
    requestId?: string | null;
  };
  matrixCorpusContext?: MatrixCorpusLlmCallContextV1;
}

/**
 * Unified LLM client interface.
 * All provider clients implement this interface.
 */
export interface LlmGenerateClient {
  /**
   * Generate text using the LLM.
   * @param prompt - Text prompt to send to the LLM
   * @param options - Generation options including promptType for usage tracking
   * @returns Result with content and usage, or error
   */
  generate(prompt: string, options: GenerateOptions): Promise<Result<GenerateResult, LLMError>>;

  generateChat?(
    messages: LlmChatMessage[],
    options: GenerateChatOptions
  ): Promise<Result<GenerateChatResult, LLMError>>;

  generateChatStream?(
    messages: LlmChatMessage[],
    options: GenerateChatOptions,
    onEvent: (event: GenerateChatStreamEvent) => void
  ): Promise<Result<GenerateChatResult, LLMError>>;
}

/**
 * Supported providers for the factory.
 * App-side: Anthropic, OpenAI, Perplexity, and OpenRouter are supported.
 */
type SupportedProvider =
  | typeof LlmProviders.Anthropic
  | typeof LlmProviders.OpenAI
  | typeof LlmProviders.Perplexity
  | typeof LlmProviders.OpenRouter;

/**
 * Maps model to provider and creates the appropriate client.
 *
 * @param config - Client configuration
 * @returns LLM client instance
 * @throws Error if provider is not supported
 *
 * @example
 * ```ts
 * // Create a Gemini client routed through OpenRouter
 * const geminiViaOpenRouter = createLlmClient({
 *   apiKey: 'sk-...',
 *   model: 'or:google/gemini-3-flash-preview',
 *   userId: 'user-123',
 *   logger: pinoLogger,
 *   usageSink: myUsageSink,
 * });
 * ```
 */
export function createLlmClient(config: LlmClientConfig): LlmGenerateClient {
  const model = config.model as string;

  // OpenRouter models (or: prefix) are routed to the OpenRouter client
  if (isOpenRouterModel(model)) {
    return createOpenRouterGenerateClient(config);
  }

  if (isLegacyGoogleModel(model)) {
    throw new IntexuraOSError(
      'INVALID_REQUEST',
      'Direct Google LLM models are disabled; use an or:google/ OpenRouter model'
    );
  }

  // Validate model is a known static model
  if (!isValidModel(config.model)) {
    throw new IntexuraOSError('INVALID_REQUEST', `Unsupported LLM model: ${model}`);
  }

  // Static models: dispatch on provider
  const providerForModel = getProviderForModel(config.model);
  switch (providerForModel) {
    case LlmProviders.Anthropic:
      return withUnsupportedGenerateChat(createClaudeGenerateClient(config));
    case LlmProviders.OpenAI:
      return withUnsupportedGenerateChat(createGptGenerateClient(config));
    case LlmProviders.Perplexity:
      return withUnsupportedGenerateChat(createPerplexityGenerateClient(config));
    default:
      // OpenRouter (or any future provider not in the switch) lands here. Static
      // OpenRouter models don't exist in MODEL_PROVIDER_MAP — the `or:` prefix
      // path above handles every OpenRouter call. Throwing keeps the factory
      // closed under unknown providers.
      throw new IntexuraOSError('INVALID_REQUEST', `Unsupported LLM provider: ${providerForModel}`);
  }
}

function withUnsupportedGenerateChat(client: {
  generate(prompt: string, options: GenerateOptions): Promise<Result<GenerateResult, LLMError>>;
}): LlmGenerateClient {
  return {
    async generate(
      prompt: string,
      options: GenerateOptions
    ): Promise<Result<GenerateResult, LLMError>> {
      return await client.generate(prompt, options);
    },
    generateChat(): Promise<Result<GenerateChatResult, LLMError>> {
      return Promise.reject(
        new IntexuraOSError(
          'INVALID_REQUEST',
          'Chat message generation is only supported for OpenRouter clients'
        )
      );
    },
    generateChatStream(): Promise<Result<GenerateChatResult, LLMError>> {
      return Promise.reject(
        new IntexuraOSError(
          'INVALID_REQUEST',
          'Chat message streaming is only supported for OpenRouter clients'
        )
      );
    },
  };
}

/**
 * Type guard to check if a provider is supported by the factory.
 */
export function isSupportedProvider(provider: string): provider is SupportedProvider {
  return (
    provider === LlmProviders.Anthropic ||
    provider === LlmProviders.OpenAI ||
    provider === LlmProviders.Perplexity ||
    provider === LlmProviders.OpenRouter
  );
}

/**
 * Create a tool calling client for LLM agent loops.
 *
 * Routes to the appropriate provider-specific tool calling implementation.
 * Direct Google calls are disabled; tool calling is routed through OpenRouter.
 *
 * @param config - Tool calling client configuration
 * @returns ToolCallingClient instance
 */
export function createToolCallingClient(config: ToolCallingClientConfig): ToolCallingClient {
  const model = config.model as string;

  if (isOpenRouterModel(model)) {
    if (!isToolCallingModel(model)) {
      throw new IntexuraOSError('INVALID_REQUEST', `Unsupported LLM model: ${model}`);
    }

    return createOpenRouterToolCallingClient({
      apiKey: config.apiKey,
      model: getOpenRouterRawId(model),
      userId: config.userId,
      logger: config.logger,
      usageSink: config.usageSink,
      ...(config.ownerType !== undefined && { ownerType: config.ownerType }),
      ...(config.timeoutMs !== undefined && { timeoutMs: config.timeoutMs }),
      ...(config.maxAttempts !== undefined && { maxAttempts: config.maxAttempts }),
      ...(config.deadlineAtMs !== undefined && { deadlineAtMs: config.deadlineAtMs }),
      evidenceModelId: model,
    });
  }

  if (isLegacyGoogleModel(model)) {
    throw new IntexuraOSError(
      'INVALID_REQUEST',
      'Direct Google LLM models are disabled; use an or:google/ OpenRouter model'
    );
  }

  // Validate model is supported
  if (!isValidModel(model)) {
    throw new IntexuraOSError('INVALID_REQUEST', `Unsupported LLM model: ${model}`);
  }

  const providerForModel = getProviderForModel(model);
  throw new IntexuraOSError(
    'INVALID_REQUEST',
    `Tool calling not supported for provider: ${providerForModel}. Use an OpenRouter tool-calling model.`
  );
}

// Re-export for convenience
export type { LLMError };

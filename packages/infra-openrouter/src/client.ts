/**
 * OpenRouter client implementation using native fetch.
 *
 * OpenRouter (openrouter.ai) provides access to multiple frontier models
 * from various providers through a unified OpenAI-compatible API.
 * Web search is enabled via :online model suffix (powered by Exa).
 *
 * @packageDocumentation
 *
 * @example
 * ```ts
 * import { createOpenRouterClient } from '@intexuraos/infra-openrouter';
 *
 * const client = createOpenRouterClient({
 *   apiKey: process.env.OPENROUTER_API_KEY,
 *   model: 'anthropic/claude-sonnet-4.6',
 *   userId: 'user-123',
 *   timeoutMs: 840000,
 *   logger: pinoLogger,
 *   usageSink: myUsageSink,
 * });
 *
 * // Research with web search (append :online to model ID)
 * const research = await client.research('Latest AI developments');
 * if (research.ok) {
 *   console.log(research.value.content);
 *   console.log('Sources:', research.value.sources);
 * }
 *
 * // Synthesis without web search
 * const synthesis = await client.generate('Summarize this research');
 * ```
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import {
  LlmProviders,
  type GenerateChatOptions,
  type GenerateChatResult,
  type GenerateChatStreamEvent,
  type GenerateResult,
  type LlmChatMessage,
  type NormalizedUsage,
} from '@intexuraos/llm-contract';
import { createUsageLogger, type CallType } from '@intexuraos/llm-pricing';
import { measureLlmCall, withRetry } from '@intexuraos/llm-utils';
import type {
  GenerateOptions,
  OpenRouterConfig,
  OpenRouterError,
  OpenRouterKeyInfo,
  OpenRouterResponse,
  OpenRouterUsage,
  ResearchOptions,
  ResearchResult,
} from './types.js';
import { normalizeUsage } from './costCalculator.js';

export interface OpenRouterClient {
  /**
   * Performs research using the model's web-search-augmented mode (`:online` suffix).
   */
  research: (
    prompt: string,
    options?: ResearchOptions
  ) => Promise<Result<ResearchResult, OpenRouterError>>;

  /**
   * Generates text completion without web search.
   * Accepts generation options (e.g., response format, promptType).
   */
  generate: (
    prompt: string,
    options: GenerateOptions
  ) => Promise<Result<GenerateResult, OpenRouterError>>;

  /**
   * Generates a chat completion using application-facing chat messages.
   */
  generateChat: (
    messages: LlmChatMessage[],
    options: GenerateChatOptions
  ) => Promise<Result<GenerateChatResult, OpenRouterError>>;

  /**
   * Streams a chat completion using application-facing chat messages.
   */
  generateChatStream: (
    messages: LlmChatMessage[],
    options: GenerateChatOptions,
    onEvent: (event: GenerateChatStreamEvent) => void
  ) => Promise<Result<GenerateChatResult, OpenRouterError>>;

  /**
   * Validate an OpenRouter API key using the lightweight /api/v1/key endpoint.
   * This is a free, no-token-cost introspection call.
   */
  validateKey: (apiKey: string) => Promise<Result<OpenRouterKeyInfo, OpenRouterError>>;
}

/** OpenRouter API base URL */
const API_BASE_URL = 'https://openrouter.ai/api/v1';

/** Default fetch timeout: 14 minutes (840s) - below Cloud Run's 15min limit */
const DEFAULT_TIMEOUT_MS = 840_000;

/** Application name sent to OpenRouter */
const APP_TITLE = 'IntexuraOS';
const RESEARCH_PROMPT_TYPE = 'research-web-search';
const INVALID_COMPLETION_RESPONSE_MESSAGE = 'OpenRouter returned an invalid completion response';

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

class OpenRouterApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'OpenRouterApiError';
  }
}

interface OpenRouterStreamChunk {
  choices?: { delta?: { content?: string }; error?: { message?: string } }[];
  usage?: OpenRouterUsage;
  error?: { message?: string };
}

function toOpenRouterReasoning(
  reasoning: GenerateChatOptions['reasoning']
): Record<string, unknown> | undefined {
  if (reasoning === undefined) {
    return undefined;
  }
  return {
    ...(reasoning.enabled !== undefined && { enabled: reasoning.enabled }),
    ...(reasoning.effort !== undefined && { effort: reasoning.effort }),
    ...(reasoning.maxTokens !== undefined && { max_tokens: reasoning.maxTokens }),
    ...(reasoning.exclude !== undefined && { exclude: reasoning.exclude }),
  };
}

/**
 * Create an OpenRouter client.
 *
 * The client uses native fetch with OpenRouter-specific configuration:
 * - Custom base URL pointing to openrouter.ai/api/v1
 * - HTTP-Referer and X-Title headers for API identification
 * - Timeout via AbortController (default 14 minutes)
 * - Error mapping to LLMError codes
 */
export function createOpenRouterClient(config: OpenRouterConfig): OpenRouterClient {
  const {
    apiKey,
    model,
    userId,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    logger,
    usageSink,
    ownerType,
  } = config;

  const usageLogger = createUsageLogger({ logger, sink: usageSink });

  function trackUsage(
    callType: CallType,
    usage: NormalizedUsage,
    success: boolean,
    durationMs: number,
    errorMessage?: string,
    providerReportedUsd?: number | null,
    promptType?: string,
    correlation?: GenerateOptions['correlation']
  ): void {
    void usageLogger.log({
      userId,
      provider: LlmProviders.OpenRouter,
      model,
      callType,
      usage,
      success,
      durationMs,
      ...(errorMessage !== undefined && { errorMessage }),
      ...(providerReportedUsd !== undefined &&
        providerReportedUsd !== null && { providerReportedUsd }),
      ...(ownerType !== undefined && { ownerType }),
      ...(promptType !== undefined && { promptType }),
      ...(correlation !== undefined && { correlation }),
    });
  }

  function extractUsage(usage?: OpenRouterUsage): {
    normalized: NormalizedUsage;
    providerReportedUsd: number | null;
    cachedTokens?: number;
    cacheWriteTokens?: number;
  } {
    if (usage === undefined) {
      return {
        normalized: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
        providerReportedUsd: null,
      };
    }
    const providerReportedUsd = typeof usage.cost === 'number' ? usage.cost : null;
    const cachedTokens =
      typeof usage.prompt_tokens_details?.cached_tokens === 'number'
        ? usage.prompt_tokens_details.cached_tokens
        : undefined;
    const cacheWriteTokens =
      typeof usage.prompt_tokens_details?.cache_write_tokens === 'number'
        ? usage.prompt_tokens_details.cache_write_tokens
        : undefined;
    const normalized = normalizeUsage(
      usage.prompt_tokens,
      usage.completion_tokens,
      providerReportedUsd ?? undefined
    );
    if (cachedTokens !== undefined) {
      normalized.cacheTokens = cachedTokens;
    }
    return {
      normalized,
      providerReportedUsd,
      ...(cachedTokens !== undefined && { cachedTokens }),
      ...(cacheWriteTokens !== undefined && { cacheWriteTokens }),
    };
  }

  function toGenerateChatUsage(input: {
    normalized: NormalizedUsage;
    providerReportedUsd?: number | null;
    cachedTokens?: number;
    cacheWriteTokens?: number;
  }): GenerateChatResult['usage'] {
    return {
      inputTokens: input.normalized.inputTokens,
      outputTokens: input.normalized.outputTokens,
      totalTokens: input.normalized.totalTokens,
      costUsd: input.normalized.costUsd,
      ...(input.providerReportedUsd !== undefined &&
        input.providerReportedUsd !== null && {
          providerReportedUsd: input.providerReportedUsd,
        }),
      ...(input.cachedTokens !== undefined && { cachedTokens: input.cachedTokens }),
      ...(input.cacheWriteTokens !== undefined && { cacheWriteTokens: input.cacheWriteTokens }),
    };
  }

  return {
    async research(
      prompt: string,
      options?: ResearchOptions
    ): Promise<Result<ResearchResult, OpenRouterError>> {
      const start = Date.now();
      try {
        // Build the model ID - research uses :online suffix for web search
        const searchModel = model.endsWith(':online') ? model : `${model}:online`;

        const requestBody = {
          model: searchModel,
          messages: [
            {
              role: 'system',
              content:
                'You are a senior research analyst. Search the web for current, authoritative information. Cross-reference sources and cite all findings with URLs.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.2,
        };

        const response = await fetchWithTimeout(
          `${API_BASE_URL}/chat/completions`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://intexuraos.cloud',
              'X-Title': APP_TITLE,
            },
            body: JSON.stringify(requestBody),
          },
          timeoutMs
        );

        if (!response.ok) {
          const durationMs = Date.now() - start;
          const errorText = await response.text();
          const apiError = new OpenRouterApiError(response.status, errorText);
          const errorMsg = getErrorMessage(apiError);
          const emptyUsage: NormalizedUsage = {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUsd: 0,
          };
          trackUsage(
            'research',
            emptyUsage,
            false,
            durationMs,
            errorMsg,
            undefined,
            options?.promptType ?? RESEARCH_PROMPT_TYPE,
            options?.correlation
          );
          return err(mapOpenRouterError(apiError));
        }

        const data = (await response.json()) as OpenRouterResponse;
        const rawContent = data.choices[0]?.message.content;
        const content = typeof rawContent === 'string' ? rawContent : '';
        const { normalized, providerReportedUsd } = extractUsage(data.usage);

        // Extract sources from annotations (OpenRouter returns web search citations as annotations)
        const sources: string[] = [];
        if (data.annotations !== undefined && Array.isArray(data.annotations)) {
          for (const annotation of data.annotations) {
            if (typeof annotation === 'string') {
              sources.push(annotation);
            }
            // Check for object annotations (non-string annotations)
            if (typeof annotation === 'object') {
              // Annotation is an object - could have url field, but structure varies by API response
              /* v8 ignore start -- upstream: cannot verify annotation URL structure in all responses @preserve */
              const ann = annotation as { url?: string };
              if (ann.url !== undefined) {
                sources.push(ann.url);
              }
              /* v8 ignore stop @preserve */
            }
          }
        }

        trackUsage(
          'research',
          normalized,
          true,
          Date.now() - start,
          undefined,
          providerReportedUsd,
          options?.promptType ?? RESEARCH_PROMPT_TYPE,
          options?.correlation
        );

        return ok({ content, sources, usage: normalized });
      } catch (error) {
        const durationMs = Date.now() - start;
        const errorMsg = getErrorMessage(error);
        const emptyUsage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        trackUsage(
          'research',
          emptyUsage,
          false,
          durationMs,
          errorMsg,
          undefined,
          options?.promptType ?? RESEARCH_PROMPT_TYPE,
          options?.correlation
        );
        return err(mapOpenRouterError(error));
      }
    },

    async generate(
      prompt: string,
      options: GenerateOptions
    ): Promise<Result<GenerateResult, OpenRouterError>> {
      return await withRetry(() => generateOnce(prompt, options), {
        maxAttempts: 3,
        baseDelayMs: 500,
      });
    },

    async generateChat(
      messages: LlmChatMessage[],
      options: GenerateChatOptions
    ): Promise<Result<GenerateChatResult, OpenRouterError>> {
      return await withRetry(() => generateChatOnce(messages, options), {
        maxAttempts: 3,
        baseDelayMs: 500,
      });
    },

    async generateChatStream(
      messages: LlmChatMessage[],
      options: GenerateChatOptions,
      onEvent: (event: GenerateChatStreamEvent) => void
    ): Promise<Result<GenerateChatResult, OpenRouterError>> {
      return await generateChatStreamOnce(messages, options, onEvent);
    },

    async validateKey(key: string): Promise<Result<OpenRouterKeyInfo, OpenRouterError>> {
      try {
        const response = await fetchWithTimeout(
          `${API_BASE_URL}/key`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${key}`,
              'HTTP-Referer': 'https://intexuraos.cloud',
              'X-Title': APP_TITLE,
            },
          },
          10_000 // 10 second timeout for lightweight key check
        );

        if (!response.ok) {
          const errorText = await response.text();
          const apiError = new OpenRouterApiError(response.status, errorText);
          return err(mapOpenRouterError(apiError));
        }

        const data = (await response.json()) as OpenRouterKeyInfo;
        return ok(data);
      } catch (error) {
        return err(mapOpenRouterError(error));
      }
    },
  };

  async function generateOnce(
    prompt: string,
    options: GenerateOptions
  ): Promise<Result<GenerateResult, OpenRouterError>> {
    const messages: LlmChatMessage[] = [{ role: 'user', content: prompt }];
    const chatResult = await generateChatOnce(messages, {
      promptType: options.promptType,
      ...(options.responseFormat !== undefined && {
        responseFormat: options.responseFormat,
      }),
      ...(options.correlation !== undefined && { correlation: options.correlation }),
      temperature: 0.2,
    });
    if (!chatResult.ok) {
      return chatResult;
    }

    return ok({
      content: chatResult.value.content,
      usage: {
        inputTokens: chatResult.value.usage.inputTokens,
        outputTokens: chatResult.value.usage.outputTokens,
        totalTokens: chatResult.value.usage.totalTokens,
        costUsd: chatResult.value.usage.costUsd,
        ...(chatResult.value.usage.cachedTokens !== undefined && {
          cacheTokens: chatResult.value.usage.cachedTokens,
        }),
      },
    });
  }

  async function generateChatOnce(
    messages: LlmChatMessage[],
    options: GenerateChatOptions
  ): Promise<Result<GenerateChatResult, OpenRouterError>> {
    const start = Date.now();
    try {
      const { result, durationMs } = await measureLlmCall(
        async (): Promise<{
          content: string;
          normalized: NormalizedUsage;
          providerReportedUsd: number | null;
          cachedTokens?: number;
          cacheWriteTokens?: number;
        }> => {
          const requestBody = {
            model, // No :online suffix for synthesis
            messages,
            temperature: options.temperature ?? 0.2,
            ...(options.sessionId !== undefined && { session_id: options.sessionId }),
            ...(options.responseFormat !== undefined && {
              response_format: options.responseFormat,
            }),
            ...(toOpenRouterReasoning(options.reasoning) !== undefined && {
              reasoning: toOpenRouterReasoning(options.reasoning),
            }),
          };

          const response = await fetchWithTimeout(
            `${API_BASE_URL}/chat/completions`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://intexuraos.cloud',
                'X-Title': APP_TITLE,
              },
              body: JSON.stringify(requestBody),
            },
            timeoutMs
          );

          // Throw on HTTP error so measureLlmCall rethrows errors. The outer
          // catch below maps the error and logs usage with measured duration.
          if (!response.ok) {
            const errorText = await response.text();
            throw new OpenRouterApiError(response.status, errorText);
          }

          const data = (await response.json()) as OpenRouterResponse;
          const firstChoice = data.choices[0];
          if (
            firstChoice === undefined ||
            firstChoice.finish_reason === 'error' ||
            firstChoice.error !== undefined ||
            typeof firstChoice.message.content !== 'string'
          ) {
            throw new OpenRouterApiError(500, INVALID_COMPLETION_RESPONSE_MESSAGE);
          }
          const content = firstChoice.message.content;
          const { normalized, providerReportedUsd, cachedTokens, cacheWriteTokens } = extractUsage(
            data.usage
          );
          return {
            content,
            normalized,
            providerReportedUsd,
            ...(cachedTokens !== undefined && { cachedTokens }),
            ...(cacheWriteTokens !== undefined && { cacheWriteTokens }),
          };
        }
      );

      trackUsage(
        'generate',
        result.normalized,
        true,
        durationMs,
        undefined,
        result.providerReportedUsd,
        options.promptType,
        options.correlation
      );

      const usage = toGenerateChatUsage(result);

      return ok({ content: result.content, usage });
    } catch (error) {
      const durationMs = Date.now() - start;
      const errorMsg = getErrorMessage(error);
      const emptyUsage: NormalizedUsage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      };
      trackUsage(
        'generate',
        emptyUsage,
        false,
        durationMs,
        errorMsg,
        undefined,
        options.promptType,
        options.correlation
      );
      return err(mapOpenRouterError(error));
    }
  }

  async function generateChatStreamOnce(
    messages: LlmChatMessage[],
    options: GenerateChatOptions,
    onEvent: (event: GenerateChatStreamEvent) => void
  ): Promise<Result<GenerateChatResult, OpenRouterError>> {
    const start = Date.now();
    try {
      const requestBody = {
        model,
        messages,
        stream: true,
        temperature: options.temperature ?? 0.2,
        ...(options.sessionId !== undefined && { session_id: options.sessionId }),
        ...(options.responseFormat !== undefined && {
          response_format: options.responseFormat,
        }),
        ...(toOpenRouterReasoning(options.reasoning) !== undefined && {
          reasoning: toOpenRouterReasoning(options.reasoning),
        }),
      };

      const response = await fetchWithTimeout(
        `${API_BASE_URL}/chat/completions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://intexuraos.cloud',
            'X-Title': APP_TITLE,
          },
          body: JSON.stringify(requestBody),
        },
        timeoutMs
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new OpenRouterApiError(response.status, errorText);
      }

      const streamResult = await processChatStream(response, onEvent);
      const durationMs = Date.now() - start;
      trackUsage(
        'generate',
        streamResult.normalized,
        true,
        durationMs,
        undefined,
        streamResult.providerReportedUsd,
        options.promptType,
        options.correlation
      );

      return ok({
        content: streamResult.content,
        usage: toGenerateChatUsage(streamResult),
      });
    } catch (error) {
      const durationMs = Date.now() - start;
      const errorMsg = getErrorMessage(error);
      const emptyUsage: NormalizedUsage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      };
      trackUsage(
        'generate',
        emptyUsage,
        false,
        durationMs,
        errorMsg,
        undefined,
        options.promptType,
        options.correlation
      );
      return err(mapOpenRouterError(error));
    }
  }

  async function processChatStream(
    response: Response,
    onEvent: (event: GenerateChatStreamEvent) => void
  ): Promise<{
    content: string;
    normalized: NormalizedUsage;
    providerReportedUsd: number | null;
    cachedTokens?: number;
    cacheWriteTokens?: number;
  }> {
    if (response.body === null) {
      throw new Error('Response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let content = '';
    let buffer = '';
    let usageResult: ReturnType<typeof extractUsage> | undefined;

    for (;;) {
      const readResult = await reader.read();
      if (readResult.done) {
        break;
      }
      const value = readResult.value as Uint8Array | undefined; // @allow-result-access -- ReadableStreamReadResult is not a Result type
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer =
        /* v8 ignore start -- ts-type: split always returns at least one item @preserve */
        lines.pop() ?? '';
      /* v8 ignore stop @preserve */

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith(':')) {
          continue;
        }
        if (!trimmed.startsWith('data:')) {
          continue;
        }

        const data = trimmed.slice(5).trimStart();
        if (data === '[DONE]') {
          continue;
        }

        const chunk = JSON.parse(data) as OpenRouterStreamChunk;
        const errorMessage = chunk.error?.message ?? chunk.choices?.[0]?.error?.message;
        if (errorMessage !== undefined) {
          throw new OpenRouterApiError(500, errorMessage);
        }

        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          content += delta;
          onEvent({ type: 'delta', text: delta });
        }

        if (chunk.usage !== undefined) {
          usageResult = extractUsage(chunk.usage);
          onEvent({ type: 'usage', usage: toGenerateChatUsage(usageResult) });
        }
      }
    }

    return {
      content,
      ...(usageResult ?? {
        normalized: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
        providerReportedUsd: null,
      }),
    };
  }
}

function mapOpenRouterError(error: unknown): OpenRouterError {
  if (error instanceof OpenRouterApiError) {
    const message = error.message;
    if (error.status === 401) return { code: 'INVALID_KEY', message };
    if (error.status === 429) return { code: 'RATE_LIMITED', message };
    if (error.status === 503) return { code: 'OVERLOADED', message };
    return { code: 'API_ERROR', message };
  }
  const message = getErrorMessage(error);
  // Check for timeout indicators in the error message
  if (
    message.includes('timeout') ||
    message.includes('fetch failed') ||
    message.includes('aborted') ||
    message.includes('Request timeout')
  ) {
    return { code: 'TIMEOUT', message };
  }
  return { code: 'API_ERROR', message };
}

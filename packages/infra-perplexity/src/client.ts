/**
 * Perplexity AI client implementation.
 *
 * Implements the {@link LLMClient} interface for Perplexity Sonar models with:
 * - Online search with source citations
 * - Streaming support for long-running reasoning models
 * - Automatic usage logging to Firestore
 * - Audit trail for all requests
 *
 * @packageDocumentation
 *
 * @remarks
 * The `research()` method uses SSE streaming to prevent 5-minute idle timeouts
 * on long-running reasoning models like sonar-deep-research. The `generate()` method
 * uses standard buffered requests.
 *
 * @example
 * ```ts
 * import { createPerplexityClient } from '@intexuraos/infra-perplexity';
 *
 * const client = createPerplexityClient({
 *   apiKey: process.env.PERPLEXITY_API_KEY,
 *   model: 'sonar-pro',
 *   userId: 'user-123',
 *   timeoutMs: 840000, // 14 minutes for deep research
 *   logger: pinoLogger,
 *   usageSink: myUsageSink,
 * });
 *
 * const result = await client.research('Latest AI developments');
 * if (result.ok) {
 *   console.log(result.data.content);
 *   console.log('Sources:', result.data.sources);
 *   console.log('Tokens:', result.data.usage.totalTokens);
 * }
 * ```
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import {
  LlmModels,
  LlmProviders,
  type LLMClient,
  type NormalizedUsage,
  type GenerateResult,
} from '@intexuraos/llm-contract';
import { createUsageLogger, type CallType } from '@intexuraos/llm-pricing';
import { withLlmSpan } from '@intexuraos/llm-utils';
import type {
  PerplexityConfig,
  PerplexityError,
  PerplexityRequestBody,
  PerplexityResponse,
  PerplexityUsage,
  ResearchResult,
  SearchContextSize,
} from './types.js';
import { normalizeUsage } from './costCalculator.js';

export interface GenerateOptions {
  promptType: string;
}

export type PerplexityClient = Pick<LLMClient, 'research'> & {
  generate(
    prompt: string,
    options: GenerateOptions
  ): Promise<Result<GenerateResult, PerplexityError>>;
};

const API_BASE_URL = 'https://api.perplexity.ai';

/** Default fetch timeout: 14 minutes (840s) - below Cloud Run's 15min limit */
const DEFAULT_TIMEOUT_MS = 840_000;

/** Maximum output tokens for Perplexity responses */
const MAX_TOKENS = 8192;

const SEARCH_CONTEXT_MAP: Record<string, SearchContextSize> = {
  [LlmModels.Sonar]: 'low',
  [LlmModels.SonarPro]: 'medium',
  [LlmModels.SonarDeepResearch]: 'high',
};

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

class PerplexityApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'PerplexityApiError';
  }
}

/**
 * Shape of a single SSE chunk from Perplexity streaming API.
 */
interface PerplexityStreamChunk {
  choices?: { delta?: { content?: string } }[];
  usage?: PerplexityUsage;
  citations?: string[];
}

/**
 * Helper to parse SSE (Server-Sent Events) streams from Perplexity.
 * Handles buffering incomplete lines and extracting content/usage/citations.
 */
async function processStreamResponse(
  response: Response,
  onUsageFound: (usage: PerplexityUsage) => void
): Promise<{ content: string; citations: string[] }> {
  if (!response.body) {
    throw new Error('Response body is empty');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = '';
  let citations: string[] = [];
  let buffer = '';

  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      const value = result.value as Uint8Array | undefined; // @allow-result-access -- ReadableStreamReadResult, not a Result type

      // Decode current chunk and append to buffer
      buffer += decoder.decode(value, { stream: true });

      // Split by newlines to process full SSE messages
      const lines = buffer.split('\n');
      // Keep the last line in the buffer as it might be incomplete
      buffer =
        /* v8 ignore start -- ts-type: split always returns at least one element @preserve */
        lines.pop() ?? '';
      /* v8 ignore stop @preserve */

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '' || !trimmed.startsWith('data: ')) continue;

        const dataStr = trimmed.slice(6); // Remove 'data: '
        if (dataStr === '[DONE]') {
          continue;
        }

        try {
          const data = JSON.parse(dataStr) as PerplexityStreamChunk;

          // 1. Accumulate Content (Delta)
          const delta = data.choices?.[0]?.delta?.content;
          if (typeof delta === 'string') {
            content += delta;
          }

          // 2. Capture Usage (usually in the final chunk)
          if (data.usage !== undefined) {
            onUsageFound(data.usage);
          }

          // 3. Capture Citations (continuously updated, we overwrite to get the latest set)
          if (data.citations !== undefined) {
            citations = data.citations;
          }
        } catch {
          // Swallow parse errors for malformed intermediate chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { content, citations };
}

export function createPerplexityClient(config: PerplexityConfig): PerplexityClient {
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
    promptType?: string
  ): void {
    void usageLogger.log({
      userId,
      provider: LlmProviders.Perplexity,
      model,
      callType,
      usage,
      success,
      durationMs,
      ...(errorMessage !== undefined && { errorMessage }),
      ...(ownerType !== undefined && { ownerType }),
      ...(promptType !== undefined && { promptType }),
    });
  }

  function extractUsage(usage: PerplexityUsage | undefined): NormalizedUsage {
    if (usage === undefined) {
      return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
    }
    return normalizeUsage(usage.prompt_tokens, usage.completion_tokens, usage.cost?.total_cost);
  }

  return {
    async research(prompt: string): Promise<Result<ResearchResult, PerplexityError>> {
      const start = Date.now();
      try {
        const searchContext = SEARCH_CONTEXT_MAP[model] ?? 'medium';

        const requestBody: PerplexityRequestBody = {
          model,
          messages: [
            {
              role: 'system',
              content: `You are a senior research analyst. Search the web for current, authoritative information. Cross-reference sources and cite all findings with URLs. Search context: ${searchContext}.`,
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.2,
          max_tokens: MAX_TOKENS,
          stream: true, // ENABLED STREAMING
        };

        const response = await fetchWithTimeout(
          `${API_BASE_URL}/chat/completions`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          },
          timeoutMs
        );

        if (!response.ok) {
          const durationMs = Date.now() - start;
          const errorText = await response.text();
          const apiError = new PerplexityApiError(response.status, errorText);
          const errorMsg = getErrorMessage(apiError);
          const emptyUsage: NormalizedUsage = {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUsd: 0,
          };
          trackUsage('research', emptyUsage, false, durationMs, errorMsg);
          return err(mapPerplexityError(apiError));
        }

        // --- STREAM PROCESSING ---
        let rawUsage: PerplexityUsage | undefined; // @allow-undefined-type -- local variable for stream capture, not an optional property
        const { content, citations } = await processStreamResponse(response, (u) => {
          rawUsage = u;
        });

        const usage = extractUsage(rawUsage);

        trackUsage('research', usage, true, Date.now() - start);

        return ok({ content, sources: citations, usage });
      } catch (error) {
        const durationMs = Date.now() - start;
        const errorMsg = getErrorMessage(error);
        const emptyUsage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        trackUsage('research', emptyUsage, false, durationMs, errorMsg);
        return err(mapPerplexityError(error));
      }
    },

    async generate(
      prompt: string,
      options: GenerateOptions
    ): Promise<Result<GenerateResult, PerplexityError>> {
      const start = Date.now();
      try {
        const { result, durationMs } = await withLlmSpan(
          LlmProviders.Perplexity,
          async (): Promise<{
            content: string;
            usage: NormalizedUsage;
            apiError?: PerplexityApiError;
          }> => {
            const requestBody: PerplexityRequestBody = {
              model,
              messages: [
                {
                  role: 'user',
                  content: prompt,
                },
              ],
              temperature: 0.2,
              max_tokens: MAX_TOKENS,
            };

            const response = await fetchWithTimeout(
              `${API_BASE_URL}/chat/completions`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
              },
              timeoutMs
            );

            if (!response.ok) {
              const errorText = await response.text();
              const apiError = new PerplexityApiError(response.status, errorText);
              return {
                content: '',
                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
                apiError,
              };
            }

            const data = (await response.json()) as PerplexityResponse;
            const content = data.choices[0]?.message.content ?? '';
            const usage = extractUsage(data.usage);
            return { content, usage };
          },
          ({ usage }) => ({
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd: usage.costUsd,
          })
        );

        if (result.apiError !== undefined) {
          const errorMsg = getErrorMessage(result.apiError);
          trackUsage('generate', result.usage, false, durationMs, errorMsg, options.promptType);
          return err(mapPerplexityError(result.apiError));
        }

        trackUsage('generate', result.usage, true, durationMs, undefined, options.promptType);

        return ok({ content: result.content, usage: result.usage });
      } catch (error) {
        const durationMs = Date.now() - start;
        const errorMsg = getErrorMessage(error);
        const emptyUsage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        trackUsage('generate', emptyUsage, false, durationMs, errorMsg, options.promptType);
        return err(mapPerplexityError(error));
      }
    },
  };
}

function mapPerplexityError(error: unknown): PerplexityError {
  if (error instanceof PerplexityApiError) {
    const message = error.message;
    if (error.status === 401) return { code: 'INVALID_KEY', message };
    if (error.status === 429) return { code: 'RATE_LIMITED', message };
    if (error.status === 503) return { code: 'OVERLOADED', message };
    return { code: 'API_ERROR', message };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { code: 'TIMEOUT', message: 'Request timed out' };
  }
  const message = getErrorMessage(error);
  if (
    message.includes('timeout') ||
    message.includes('fetch failed') ||
    message.includes('stream')
  ) {
    return { code: 'TIMEOUT', message };
  }
  return { code: 'API_ERROR', message };
}

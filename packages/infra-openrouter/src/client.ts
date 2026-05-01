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
import { LlmProviders, type NormalizedUsage, type GenerateResult } from '@intexuraos/llm-contract';
import { createUsageLogger, type CallType } from '@intexuraos/llm-pricing';
import { withLlmSpan, withRetry } from '@intexuraos/llm-utils';
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
  } {
    /* v8 ignore start -- upstream: cannot verify usage is present in all API responses @preserve */
    if (usage === undefined) {
      return {
        normalized: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
        providerReportedUsd: null,
      };
    }
    /* v8 ignore stop @preserve */
    const providerReportedUsd = typeof usage.cost === 'number' ? usage.cost : null;
    const normalized = normalizeUsage(
      usage.prompt_tokens,
      usage.completion_tokens,
      providerReportedUsd ?? undefined
    );
    return { normalized, providerReportedUsd };
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
            undefined,
            options?.correlation
          );
          return err(mapOpenRouterError(apiError));
        }

        const data = (await response.json()) as OpenRouterResponse;
        const content = data.choices[0]?.message.content ?? '';
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
          undefined,
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
          undefined,
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
    const start = Date.now();
    try {
      const { result, durationMs } = await withLlmSpan(
        LlmProviders.OpenRouter,
        async (): Promise<{
          content: string;
          normalized: NormalizedUsage;
          providerReportedUsd: number | null;
        }> => {
          const requestBody = {
            model, // No :online suffix for synthesis
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.2,
            ...(options.responseFormat !== undefined && {
              response_format: options.responseFormat,
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

          // Throw on HTTP error so withLlmSpan records ERROR status. The outer
          // catch below maps the error and logs usage with measured duration.
          if (!response.ok) {
            const errorText = await response.text();
            throw new OpenRouterApiError(response.status, errorText);
          }

          const data = (await response.json()) as OpenRouterResponse;
          const firstChoice = data.choices[0];
          // Handle case where choices array is empty (upstream API may return this)
          if (firstChoice === undefined) {
            /* v8 ignore start -- upstream: cannot verify firstChoice message structure when choices is empty @preserve */
            return {
              content: '',
              normalized: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
              providerReportedUsd: null,
            };
            /* v8 ignore stop @preserve */
          }
          const content = firstChoice.message.content;
          const { normalized, providerReportedUsd } = extractUsage(data.usage);
          return { content, normalized, providerReportedUsd };
        },
        ({ normalized }) => ({
          model,
          inputTokens: normalized.inputTokens,
          outputTokens: normalized.outputTokens,
          costUsd: normalized.costUsd,
        })
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

      return ok({ content: result.content, usage: result.normalized });
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

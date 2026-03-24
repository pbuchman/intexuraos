/**
 * OpenRouter client implementation using OpenAI SDK.
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
 *   pricing: {
 *     inputPricePerMillion: 3.0,
 *     outputPricePerMillion: 15.0,
 *     useProviderCost: true,
 *   },
 *   timeoutMs: 840000,
 *   logger: pinoLogger,
 * });
 *
 * // Research with web search (append :online to model ID)
 * const research = await client.research('Latest AI developments');
 * if (research.ok) {
 *   console.log(research.data.content);
 *   console.log('Sources:', research.data.sources);
 * }
 *
 * // Synthesis without web search
 * const synthesis = await client.generate('Summarize this research');
 * ```
 */

import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { type AuditContext, createAuditContext } from '@intexuraos/llm-audit';
import {
  LlmProviders,
  type LLMClient,
  type NormalizedUsage,
  type GenerateResult,
} from '@intexuraos/llm-contract';
import { createUsageLogger, type CallType } from '@intexuraos/llm-pricing';
import type {
  OpenRouterConfig,
  OpenRouterError,
  OpenRouterResponse,
  OpenRouterUsage,
  ResearchResult,
} from './types.js';
import { normalizeUsage } from './costCalculator.js';

export type OpenRouterClient = Pick<LLMClient, 'research' | 'generate'>;

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

function createRequestContext(
  method: string,
  model: string,
  prompt: string
): { requestId: string; startTime: Date; auditContext: AuditContext } {
  const requestId = randomUUID();
  const startTime = new Date();
  const auditContext = createAuditContext({
    provider: LlmProviders.OpenRouter,
    model,
    method,
    prompt,
    startedAt: startTime,
  });
  return { requestId, startTime, auditContext };
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
 * The client wraps the OpenAI SDK with OpenRouter-specific configuration:
 * - Custom base URL pointing to openrouter.ai
 * - HTTP-Referer and X-Title headers for API identification
 * - Error mapping to our LLMError codes
 */
export function createOpenRouterClient(config: OpenRouterConfig): OpenRouterClient {
  const { apiKey, model, userId, pricing, timeoutMs = DEFAULT_TIMEOUT_MS, logger } = config;

  // Create OpenAI SDK client with OpenRouter base URL and custom headers
  const openai = new OpenAI({
    apiKey,
    baseURL: API_BASE_URL,
    defaultHeaders: {
      'HTTP-Referer': 'https://intexuraos.cloud',
      'X-Title': APP_TITLE,
    },
  });

  const usageLogger = createUsageLogger({ logger });

  function trackUsage(
    callType: CallType,
    usage: NormalizedUsage,
    success: boolean,
    errorMessage?: string
  ): void {
    void usageLogger.log({
      userId,
      provider: LlmProviders.OpenRouter,
      model,
      callType,
      usage,
      success,
      ...(errorMessage !== undefined && { errorMessage }),
    });
  }

  function extractUsage(usage: OpenRouterUsage | undefined): NormalizedUsage {
    if (usage === undefined) {
      return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
    }
    // OpenRouter doesn't provide per-request cost in the response like Perplexity does
    return normalizeUsage(
      usage.prompt_tokens,
      usage.completion_tokens,
      undefined, // No provider cost in response
      pricing
    );
  }

  return {
    async research(prompt: string): Promise<Result<ResearchResult, OpenRouterError>> {
      const { auditContext } = createRequestContext('research', model, prompt);

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
          const errorText = await response.text();
          const apiError = new OpenRouterApiError(response.status, errorText);
          const errorMsg = getErrorMessage(apiError);
          await auditContext.error({ error: errorMsg });
          const emptyUsage: NormalizedUsage = {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUsd: 0,
          };
          trackUsage('research', emptyUsage, false, errorMsg);
          return err(mapOpenRouterError(apiError));
        }

        const data = (await response.json()) as OpenRouterResponse;
        const content = data.choices[0]?.message.content ?? '';
        const usage = extractUsage(data.usage);

        // Extract sources from annotations (OpenRouter returns web search citations as annotations)
        const sources: string[] = [];
        if (data.annotations !== undefined && Array.isArray(data.annotations)) {
          for (const annotation of data.annotations) {
            if (typeof annotation === 'string') {
              sources.push(annotation);
            } else if (typeof annotation === 'object' && annotation !== null) {
              // Annotation could be an object with url field
              const ann = annotation as { url?: string };
              if (ann.url !== undefined) {
                sources.push(ann.url);
              }
            }
          }
        }

        await auditContext.success({
          response: content,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          providerCost: usage.costUsd,
        });
        trackUsage('research', usage, true);

        return ok({ content, sources, usage });
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        await auditContext.error({ error: errorMsg });
        const emptyUsage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        trackUsage('research', emptyUsage, false, errorMsg);
        return err(mapOpenRouterError(error));
      }
    },

    async generate(prompt: string): Promise<Result<GenerateResult, OpenRouterError>> {
      const { auditContext } = createRequestContext('generate', model, prompt);

      try {
        const requestBody = {
          model, // No :online suffix for synthesis
          messages: [
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
          const errorText = await response.text();
          const apiError = new OpenRouterApiError(response.status, errorText);
          const errorMsg = getErrorMessage(apiError);
          await auditContext.error({ error: errorMsg });
          const emptyUsage: NormalizedUsage = {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUsd: 0,
          };
          trackUsage('generate', emptyUsage, false, errorMsg);
          return err(mapOpenRouterError(apiError));
        }

        const data = (await response.json()) as OpenRouterResponse;
        const content = data.choices[0]?.message.content ?? '';
        const usage = extractUsage(data.usage);

        await auditContext.success({
          response: content,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          providerCost: usage.costUsd,
        });
        trackUsage('generate', usage, true);

        return ok({ content, usage });
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        await auditContext.error({ error: errorMsg });
        const emptyUsage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        trackUsage('generate', emptyUsage, false, errorMsg);
        return err(mapOpenRouterError(error));
      }
    },
  };
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

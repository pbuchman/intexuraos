/**
 * Perplexity Client - with parameterized pricing.
 *
 * No hardcoded pricing - all costs calculated from passed ModelPricing config.
 * Original createPerplexityClient() remains for backwards compatibility.
 *
 * STREAMING: The research() method uses SSE streaming to prevent 5-minute idle
 * timeouts on long-running reasoning models (like sonar-deep-research).
 * The generate() method uses standard buffered requests.
 */

import { randomUUID } from 'node:crypto';
import { buildResearchPrompt } from '@intexuraos/llm-common';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { type AuditContext, createAuditContext } from '@intexuraos/llm-audit';
import {
  LlmModels,
  LlmProviders,
  type LLMClient,
  type NormalizedUsage,
  type GenerateResult,
} from '@intexuraos/llm-contract';
import { logUsage, type CallType } from '@intexuraos/llm-pricing';
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

export type PerplexityClient = Pick<LLMClient, 'research' | 'generate'>;

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

function createRequestContext(
  method: string,
  model: string,
  prompt: string
): { requestId: string; startTime: Date; auditContext: AuditContext } {
  const requestId = randomUUID();
  const startTime = new Date();
  const auditContext = createAuditContext({
    provider: LlmProviders.Perplexity,
    model,
    method,
    prompt,
    startedAt: startTime,
  });
  return { requestId, startTime, auditContext };
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
      const value = result.value as Uint8Array | undefined;

      // Decode current chunk and append to buffer
      buffer += decoder.decode(value, { stream: true });

      // Split by newlines to process full SSE messages
      const lines = buffer.split('\n');
      // Keep the last line in the buffer as it might be incomplete
      buffer = lines.pop() ?? '';

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
  const { apiKey, model, userId, pricing, timeoutMs = DEFAULT_TIMEOUT_MS } = config;

  function trackUsage(
    callType: CallType,
    usage: NormalizedUsage,
    success: boolean,
    errorMessage?: string
  ): void {
    void logUsage({
      userId,
      provider: LlmProviders.Perplexity,
      model,
      callType,
      usage,
      success,
      ...(errorMessage !== undefined && { errorMessage }),
    });
  }

  function extractUsage(usage: PerplexityUsage | undefined): NormalizedUsage {
    if (usage === undefined) {
      return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
    }
    return normalizeUsage(
      usage.prompt_tokens,
      usage.completion_tokens,
      usage.cost?.total_cost,
      pricing
    );
  }

  return {
    async research(prompt: string): Promise<Result<ResearchResult, PerplexityError>> {
      const researchPrompt = buildResearchPrompt(prompt);
      const { auditContext } = createRequestContext('research', model, researchPrompt);

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
              content: researchPrompt,
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
          const errorText = await response.text();
          const apiError = new PerplexityApiError(response.status, errorText);
          const errorMsg = getErrorMessage(apiError);
          await auditContext.error({ error: errorMsg });
          const emptyUsage: NormalizedUsage = {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUsd: 0,
          };
          trackUsage('research', emptyUsage, false, errorMsg);
          return err(mapPerplexityError(apiError));
        }

        // --- STREAM PROCESSING ---
        let rawUsage: PerplexityUsage | undefined;
        const { content, citations } = await processStreamResponse(response, (u) => {
          rawUsage = u;
        });

        const usage = extractUsage(rawUsage);

        await auditContext.success({
          response: content,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          providerCost: usage.costUsd,
        });
        trackUsage('research', usage, true);

        return ok({ content, sources: citations, usage });
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
        return err(mapPerplexityError(error));
      }
    },

    async generate(prompt: string): Promise<Result<GenerateResult, PerplexityError>> {
      const { auditContext } = createRequestContext('generate', model, prompt);

      try {
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
          const errorMsg = getErrorMessage(apiError);
          await auditContext.error({ error: errorMsg });
          const emptyUsage: NormalizedUsage = {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUsd: 0,
          };
          trackUsage('generate', emptyUsage, false, errorMsg);
          return err(mapPerplexityError(apiError));
        }

        // --- BUFFERED JSON RESPONSE ---
        const data = (await response.json()) as PerplexityResponse;
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

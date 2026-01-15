/**
 * Zai GLM client implementation.
 *
 * Implements the {@link LLMClient} interface for GLM models with:
 * - Web search research using GLM's web search tool
 * - Prompt caching with cost tracking
 * - Automatic usage logging to Firestore
 * - Audit trail for all requests
 *
 * @packageDocumentation
 *
 * @example
 * ```ts
 * import { createGlmClient } from '@intexuraos/infra-glm';
 *
 * const client = createGlmClient({
 *   apiKey: process.env.GLM_API_KEY,
 *   model: 'glm-4.7',
 *   userId: 'user-123',
 *   pricing: {
 *     inputPricePerMillion: 0.60,
 *     outputPricePerMillion: 2.20,
 *     webSearchCostPerCall: 0.005,
 *   }
 * });
 *
 * const research = await client.research('Latest AI developments');
 * if (research.ok) {
 *   console.log(research.data.content);
 *   console.log('Sources:', research.data.sources);
 *   console.log('Cost:', research.data.usage.costUsd);
 * }
 * ```
 */

import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { buildResearchPrompt } from '@intexuraos/llm-common';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { type AuditContext, createAuditContext } from '@intexuraos/llm-audit';
import {
  LlmProviders,
  type LLMClient,
  type NormalizedUsage,
  type GenerateResult,
} from '@intexuraos/llm-contract';
import { logUsage, type CallType } from '@intexuraos/llm-pricing';
import type { GlmConfig, GlmError, ResearchResult } from './types.js';
import { normalizeUsage } from './costCalculator.js';

export type GlmClient = LLMClient;

const MAX_TOKENS = 8192;
const GLM_API_BASE = 'https://api.z.ai/api/paas/v4/';

interface WebSearchToolCall {
  type: string;
  web_search?: {
    search_result?: { link?: string }[];
  };
}

/**
 * Creates a configured Zai GLM client.
 *
 * The client implements {@link LLMClient} with automatic cost calculation,
 * usage logging, and audit tracking. Supports text generation and research.
 *
 * @param config - Client configuration including API key, model, user ID, and pricing
 * @returns A configured {@link GlmClient} instance
 */
export function createGlmClient(config: GlmConfig): GlmClient {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: GLM_API_BASE,
  });
  const { model, userId, pricing, logger } = config;

  function createRequestContext(
    method: string,
    model: string,
    prompt: string
  ): { requestId: string; startTime: Date; auditContext: AuditContext } {
    const requestId = randomUUID();
    const startTime = new Date();
    const auditContext = createAuditContext({
      provider: LlmProviders.Zai,
      model,
      method,
      prompt,
      startedAt: startTime,
    });
    return { requestId, startTime, auditContext };
  }

  function trackUsage(
    callType: CallType,
    usage: NormalizedUsage,
    success: boolean,
    errorMessage?: string
  ): void {
    void logUsage({
      userId,
      provider: LlmProviders.Zai,
      model,
      callType,
      usage,
      success,
      ...(errorMessage !== undefined && { errorMessage }),
      logger,
    });
  }

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GlmError>> {
      const researchPrompt = buildResearchPrompt(prompt);
      const { auditContext } = createRequestContext('research', model, researchPrompt);

      try {
        const response = await client.chat.completions.create({
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are a senior research analyst. Search the web for current, authoritative information. Cross-reference sources and cite all findings with URLs.',
            },
            { role: 'user', content: researchPrompt },
          ],
          tools: [
            {
              type: 'web_search',
              web_search: { search_query: prompt },
            } as unknown as OpenAI.Chat.Completions.ChatCompletionTool,
          ],
          max_tokens: MAX_TOKENS,
        });

        const content = response.choices[0]?.message.content ?? '';
        const sources = extractSourcesFromResponse(response);
        const webSearchCalls = countWebSearchCalls(response);
        const usageDetails = extractUsageDetails(response.usage);
        const usage = normalizeUsage(
          usageDetails.inputTokens,
          usageDetails.outputTokens,
          usageDetails.cachedTokens,
          webSearchCalls,
          undefined,
          pricing
        );

        const successParams: Parameters<typeof auditContext.success>[0] = {
          response: content,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        };
        if (usage.webSearchCalls !== undefined) {
          successParams.webSearchCalls = usage.webSearchCalls;
        }
        await auditContext.success(successParams);
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
        return err(mapGlmError(error));
      }
    },

    async generate(prompt: string): Promise<Result<GenerateResult, GlmError>> {
      const { auditContext } = createRequestContext('generate', model, prompt);

      try {
        const response = await client.chat.completions.create({
          model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.choices[0]?.message.content ?? '';
        const usageDetails = extractUsageDetails(response.usage);
        const usage = normalizeUsage(
          usageDetails.inputTokens,
          usageDetails.outputTokens,
          usageDetails.cachedTokens,
          0,
          undefined,
          pricing
        );

        await auditContext.success({
          response: text,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
        trackUsage('generate', usage, true);

        return ok({ content: text, usage });
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
        return err(mapGlmError(error));
      }
    },
  };
}

function mapGlmError(error: unknown): GlmError {
  if (error instanceof OpenAI.APIError) {
    const message = error.message;
    if (error.status === 401) return { code: 'INVALID_KEY', message };
    if (error.status === 429) return { code: 'RATE_LIMITED', message };
    if (error.status >= 500) return { code: 'OVERLOADED', message };
    if (error.code === 'context_length_exceeded') return { code: 'CONTEXT_LENGTH', message };
    if (message.includes('timeout')) return { code: 'TIMEOUT', message };
    if (message.includes('sensitive') || message.includes('filtered'))
      return { code: 'CONTENT_FILTERED', message };
    return { code: 'API_ERROR', message };
  }
  const message = getErrorMessage(error);
  return { code: 'API_ERROR', message };
}

interface GlmUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}

function extractUsageDetails(usage: GlmUsage | undefined): {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
} {
  if (usage === undefined) {
    return { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  }

  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;

  return { inputTokens, outputTokens, cachedTokens };
}

function extractSourcesFromResponse(response: OpenAI.Chat.Completions.ChatCompletion): string[] {
  const sources: string[] = [];
  const message = response.choices[0]?.message;

  if (message?.tool_calls) {
    for (const toolCall of message.tool_calls) {
      if ((toolCall.type as string) === 'web_search') {
        const webSearchData = toolCall as unknown as WebSearchToolCall;
        const searchResults = webSearchData.web_search?.search_result;
        if (Array.isArray(searchResults)) {
          for (const result of searchResults) {
            if (result.link !== undefined) {
              sources.push(result.link);
            }
          }
        }
      }
    }
  }

  return [...new Set(sources)];
}

function countWebSearchCalls(response: OpenAI.Chat.Completions.ChatCompletion): number {
  const message = response.choices[0]?.message;
  if (!message?.tool_calls) return 0;

  let count = 0;
  for (const toolCall of message.tool_calls) {
    if ((toolCall.type as string) === 'web_search') {
      count++;
    }
  }
  return count;
}

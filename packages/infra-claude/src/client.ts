/**
 * Anthropic Claude AI client implementation.
 *
 * Implements the {@link LLMClient} interface for Claude models with:
 * - Web search research using Claude's built-in web_search_20250305 tool
 * - Prompt caching with cost tracking
 * - Automatic usage logging to Firestore
 * - Audit trail for all requests
 *
 * @packageDocumentation
 *
 * @example
 * ```ts
 * import { createClaudeClient } from '@intexuraos/infra-claude';
 *
 * const client = createClaudeClient({
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   model: 'claude-sonnet-4-5',
 *   userId: 'user-123',
 *   pricing: {
 *     inputPricePerMillion: 3.00,
 *     outputPricePerMillion: 15.00,
 *     cacheReadMultiplier: 0.1,
 *     cacheWriteMultiplier: 1.25,
 *     webSearchCostPerCall: 0.0035,
 *   }
 * });
 *
 * // Research with web search
 * const research = await client.research('Latest TypeScript features');
 * if (research.ok) {
 *   console.log(research.data.content);
 *   console.log('Sources:', research.data.sources);
 *   console.log('Cost:', research.data.usage.costUsd);
 * }
 *
 * // Simple generation
 * const result = await client.generate('Explain TypeScript');
 * if (result.ok) {
 *   console.log(result.data.content);
 * } else {
 *   console.error(result.error.code, result.error.message);
 * }
 * ```
 */

import Anthropic from '@anthropic-ai/sdk';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import {
  LlmProviders,
  type LLMClient,
  type ModelPricing,
  type NormalizedUsage,
  type GenerateResult,
} from '@intexuraos/llm-contract';
import { createUsageLogger, type CallType } from '@intexuraos/llm-pricing';
import type { ClaudeConfig, ClaudeError, ResearchResult } from './types.js';
import { normalizeUsage } from './costCalculator.js';

export type ClaudeClient = LLMClient;

const ZERO_PRICING: ModelPricing = { inputPricePerMillion: 0, outputPricePerMillion: 0 };

const MAX_TOKENS = 8192;

/**
 * Creates a configured Anthropic Claude client.
 *
 * The client implements {@link LLMClient} with automatic cost calculation,
 * usage logging, and audit tracking. All costs are calculated from the
 * provided `pricing` configuration.
 *
 * @param config - Client configuration including API key, model, user ID, and pricing
 * @returns A configured {@link ClaudeClient} instance
 *
 * @example
 * ```ts
 * const client = createClaudeClient({
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   model: 'claude-sonnet-4-5',
 *   userId: 'user-123',
 *   pricing: {
 *     inputPricePerMillion: 3.00,
 *     outputPricePerMillion: 15.00,
 *     cacheReadMultiplier: 0.1,
 *     cacheWriteMultiplier: 1.25,
 *     webSearchCostPerCall: 0.0035,
 *   }
 * });
 * ```
 */
export function createClaudeClient(config: ClaudeConfig): ClaudeClient {
  const client = new Anthropic({ apiKey: config.apiKey });
  const { model, userId, pricing = ZERO_PRICING, logger, usageSink, ownerType } = config;
  const usageLogger = createUsageLogger({ logger, sink: usageSink });

  function trackUsage(
    callType: CallType,
    usage: NormalizedUsage,
    success: boolean,
    errorMessage?: string
  ): void {
    void usageLogger.log({
      userId,
      provider: LlmProviders.Anthropic,
      model,
      callType,
      usage,
      success,
      ...(errorMessage !== undefined && { errorMessage }),
      ...(ownerType !== undefined && { ownerType }),
    });
  }

  function extractUsageDetails(usage: Anthropic.Usage): {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  } {
    const inputTokens = usage.input_tokens;
    const outputTokens = usage.output_tokens;
    const cacheReadTokens =
      (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
    const cacheCreationTokens =
      (usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0;

    return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens };
  }

  return {
    async research(prompt: string): Promise<Result<ResearchResult, ClaudeError>> {
      try {
        const response = await client.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
          tools: [{ type: 'web_search_20250305' as const, name: 'web_search' as const }],
        });

        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === 'text'
        );
        const content = textBlocks.map((b) => b.text).join('\n\n');
        const sources = extractSourcesFromClaudeResponse(response);
        const webSearchCalls = countWebSearchCalls(response);
        const usageDetails = extractUsageDetails(response.usage);
        const usage = normalizeUsage(
          usageDetails.inputTokens,
          usageDetails.outputTokens,
          usageDetails.cacheReadTokens,
          usageDetails.cacheCreationTokens,
          webSearchCalls,
          pricing
        );

        trackUsage('research', usage, true);

        return ok({ content, sources, usage });
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        const emptyUsage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        trackUsage('research', emptyUsage, false, errorMsg);
        return err(mapClaudeError(error));
      }
    },

    async generate(prompt: string): Promise<Result<GenerateResult, ClaudeError>> {
      try {
        const response = await client.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        });

        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === 'text'
        );
        const text = textBlocks.map((b) => b.text).join('\n\n');
        const usageDetails = extractUsageDetails(response.usage);
        const usage = normalizeUsage(
          usageDetails.inputTokens,
          usageDetails.outputTokens,
          usageDetails.cacheReadTokens,
          usageDetails.cacheCreationTokens,
          0,
          pricing
        );

        trackUsage('generate', usage, true);

        return ok({ content: text, usage });
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        const emptyUsage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        trackUsage('generate', emptyUsage, false, errorMsg);
        return err(mapClaudeError(error));
      }
    },
  };
}

function mapClaudeError(error: unknown): ClaudeError {
  if (error instanceof Anthropic.APIError) {
    const message = error.message;
    if (error.status === 401) return { code: 'INVALID_KEY', message };
    if (error.status === 429) return { code: 'RATE_LIMITED', message };
    if (error.status === 529) return { code: 'OVERLOADED', message };
    if (message.includes('timeout')) return { code: 'TIMEOUT', message };
    return { code: 'API_ERROR', message };
  }
  const message = getErrorMessage(error);
  return { code: 'API_ERROR', message };
}

function extractSourcesFromClaudeResponse(response: Anthropic.Message): string[] {
  const sources: string[] = [];
  const urlPattern = /https?:\/\/[^\s"'<>)\]]+/g;

  for (const block of response.content) {
    if (block.type === 'text') {
      const matches = block.text.match(urlPattern);
      if (matches !== null) {
        sources.push(...matches);
      }
    }
    if (block.type === 'web_search_tool_result') {
      if (Array.isArray(block.content)) {
        for (const result of block.content) {
          sources.push(result.url);
        }
      }
    }
  }

  return [...new Set(sources)];
}

function countWebSearchCalls(response: Anthropic.Message): number {
  let count = 0;
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'web_search') {
      count++;
    }
  }
  return count;
}

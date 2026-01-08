/**
 * Claude Client - with parameterized pricing.
 *
 * All costs calculated from passed ModelPricing config.
 */

import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { buildResearchPrompt } from '@intexuraos/llm-common';
import {
  err,
  getErrorMessage,
  ok,
  type Result,
} from '@intexuraos/common-core';
import { type AuditContext, createAuditContext } from '@intexuraos/llm-audit';
import {
  LlmProviders,
  type LLMClient,
  type NormalizedUsage,
  type GenerateResult,
} from '@intexuraos/llm-contract';
import { logUsage, type CallType } from '@intexuraos/llm-pricing';
import type { ClaudeConfig, ClaudeError, ResearchResult } from './types.js';
import { normalizeUsage } from './costCalculator.js';

export type ClaudeClient = LLMClient;

const MAX_TOKENS = 8192;

function createRequestContext(
  method: string,
  model: string,
  prompt: string
): { requestId: string; startTime: Date; auditContext: AuditContext } {
  const requestId = randomUUID();
  const startTime = new Date();
  const auditContext = createAuditContext({
    provider: LlmProviders.Anthropic,
    model,
    method,
    prompt,
    startedAt: startTime,
  });
  return { requestId, startTime, auditContext };
}

export function createClaudeClient(config: ClaudeConfig): ClaudeClient {
  const client = new Anthropic({ apiKey: config.apiKey });
  const { model, userId, pricing } = config;

  function trackUsage(
    callType: CallType,
    usage: NormalizedUsage,
    success: boolean,
    errorMessage?: string
  ): void {
    void logUsage({
      userId,
      provider: LlmProviders.Anthropic,
      model,
      callType,
      usage,
      success,
      ...(errorMessage !== undefined && { errorMessage }),
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
      const researchPrompt = buildResearchPrompt(prompt);
      const { auditContext } = createRequestContext('research', model, researchPrompt);

      try {
        const response = await client.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: researchPrompt }],
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
        return err(mapClaudeError(error));
      }
    },

    async generate(prompt: string): Promise<Result<GenerateResult, ClaudeError>> {
      const { auditContext } = createRequestContext('generate', model, prompt);

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

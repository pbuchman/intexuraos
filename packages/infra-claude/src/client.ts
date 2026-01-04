import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildResearchPrompt,
  err,
  getErrorMessage,
  ok,
  type Result,
} from '@intexuraos/common-core';
import { type AuditContext, createAuditContext } from '@intexuraos/llm-audit';
import type { LLMClient, NormalizedUsage, GenerateResult } from '@intexuraos/llm-contract';
import type { ClaudeConfig, ClaudeError, ResearchResult } from './types.js';

export type ClaudeClient = LLMClient;

const MAX_TOKENS = 8192;
const WEB_SEARCH_COST_PER_CALL = 0.03;

const CLAUDE_PRICING: Record<string, { input: number; output: number }> = {
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'claude-3-sonnet-20240229': { input: 3.0, output: 15.0 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-opus-4-20250514': { input: 15.0, output: 75.0 },
};

function createRequestContext(
  method: string,
  model: string,
  prompt: string
): { requestId: string; startTime: Date; auditContext: AuditContext } {
  const requestId = randomUUID();
  const startTime = new Date();
  const auditContext = createAuditContext({
    provider: 'anthropic',
    model,
    method,
    prompt,
    startedAt: startTime,
  });
  return { requestId, startTime, auditContext };
}

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
  webSearchCalls: number
): number {
  const pricing = CLAUDE_PRICING[model] ?? { input: 3.0, output: 15.0 };
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.input * 0.1;
  const cacheCreationCost = (cacheCreationTokens / 1_000_000) * pricing.input * 1.25;
  const regularInputCost =
    ((inputTokens - cacheReadTokens - cacheCreationTokens) / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const webSearchCost = webSearchCalls * WEB_SEARCH_COST_PER_CALL;
  return (
    Math.round(
      (regularInputCost + cacheReadCost + cacheCreationCost + outputCost + webSearchCost) *
        1_000_000
    ) / 1_000_000
  );
}

function normalizeUsage(
  model: string,
  usage: Anthropic.Usage,
  webSearchCalls: number
): NormalizedUsage {
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const cacheReadTokens =
    (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cacheCreationTokens =
    (usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: calculateCost(
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      webSearchCalls
    ),
    ...(cacheReadTokens + cacheCreationTokens > 0 && {
      cacheTokens: cacheReadTokens + cacheCreationTokens,
    }),
    ...(webSearchCalls > 0 && { webSearchCalls }),
  };
}

export function createClaudeClient(config: ClaudeConfig): ClaudeClient {
  const client = new Anthropic({ apiKey: config.apiKey });
  const { model, usageLogger, userId } = config;

  function logUsage(
    method: string,
    usage: NormalizedUsage,
    success: boolean,
    errorMessage?: string
  ): void {
    if (usageLogger === undefined) return;
    const params = {
      userId: userId ?? 'unknown',
      provider: 'anthropic',
      model,
      method,
      usage,
      success,
    };
    void usageLogger.log(errorMessage !== undefined ? { ...params, errorMessage } : params);
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
        const usage = normalizeUsage(model, response.usage, webSearchCalls);

        const successParams: Parameters<typeof auditContext.success>[0] = {
          response: content,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        };
        if (usage.webSearchCalls !== undefined) {
          successParams.webSearchCalls = usage.webSearchCalls;
        }
        await auditContext.success(successParams);
        logUsage('research', usage, true);

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
        logUsage('research', emptyUsage, false, errorMsg);
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
        const usage = normalizeUsage(model, response.usage, 0);

        await auditContext.success({
          response: text,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
        logUsage('generate', usage, true);

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
        logUsage('generate', emptyUsage, false, errorMsg);
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

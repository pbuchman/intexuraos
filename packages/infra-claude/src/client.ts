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
 *   logger: pinoLogger,
 *   usageSink: myUsageSink,
 * });
 *
 * // Research with web search
 * const research = await client.research('Latest TypeScript features');
 * if (research.ok) {
 *   console.log(research.data.content);
 *   console.log('Sources:', research.data.sources);
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
  type NormalizedUsage,
  type GenerateResult,
} from '@intexuraos/llm-contract';
import { createUsageLogger, type CallType } from '@intexuraos/llm-pricing';
import { measureLlmCall, withRetry } from '@intexuraos/llm-utils';
import type { ClaudeConfig, ClaudeError, ResearchResult } from './types.js';
import { normalizeUsage } from './costCalculator.js';

export interface GenerateOptions {
  promptType: string;
  /**
   * Optional per-call correlation overrides. Forwarded to the usage sink
   * so the emitted event carries researchId / sessionId / taskId /
   * requestId for the originating request.
   */
  correlation?: {
    researchId?: string | null;
    sessionId?: string | null;
    taskId?: string | null;
    requestId?: string | null;
  };
}

/**
 * Per-call options for {@link ClaudeClient.research}. Currently only carries
 * correlation overrides so the emitted usage event can be attributed to the
 * originating researchId / sessionId / taskId / requestId.
 */
export interface ResearchOptions {
  /** Semantic identifier for what the research prompt was used for. */
  promptType?: string;
  correlation?: {
    researchId?: string | null;
    sessionId?: string | null;
    taskId?: string | null;
    requestId?: string | null;
  };
}

export type ClaudeClient = Omit<LLMClient, 'generate' | 'research'> & {
  research(prompt: string, options?: ResearchOptions): Promise<Result<ResearchResult, ClaudeError>>;
  generate(prompt: string, options: GenerateOptions): Promise<Result<GenerateResult, ClaudeError>>;
};

const MAX_TOKENS = 8192;
const RESEARCH_PROMPT_TYPE = 'research-web-search';

/**
 * Creates a configured Anthropic Claude client.
 *
 * The client implements {@link LLMClient} with usage logging and audit
 * tracking. Cost calculation is handled server-side by llm-usage-service.
 *
 * @param config - Client configuration including API key, model, user ID
 * @returns A configured {@link ClaudeClient} instance
 *
 * @example
 * ```ts
 * const client = createClaudeClient({
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   model: 'claude-sonnet-4-5',
 *   userId: 'user-123',
 *   logger: pinoLogger,
 *   usageSink: myUsageSink,
 * });
 * ```
 */
export function createClaudeClient(config: ClaudeConfig): ClaudeClient {
  const client = new Anthropic({ apiKey: config.apiKey });
  const { model, userId, logger, usageSink, ownerType } = config;
  const usageLogger = createUsageLogger({ logger, sink: usageSink });

  function trackUsage(
    callType: CallType,
    usage: NormalizedUsage,
    success: boolean,
    durationMs: number,
    errorMessage?: string,
    promptType?: string,
    correlation?: GenerateOptions['correlation']
  ): void {
    void usageLogger.log({
      userId,
      provider: LlmProviders.Anthropic,
      model,
      callType,
      usage,
      success,
      durationMs,
      ...(errorMessage !== undefined && { errorMessage }),
      ...(ownerType !== undefined && { ownerType }),
      ...(promptType !== undefined && { promptType }),
      ...(correlation !== undefined && { correlation }),
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
    async research(
      prompt: string,
      options?: ResearchOptions
    ): Promise<Result<ResearchResult, ClaudeError>> {
      const start = Date.now();
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
          webSearchCalls
        );

        trackUsage(
          'research',
          usage,
          true,
          Date.now() - start,
          undefined,
          options?.promptType ?? RESEARCH_PROMPT_TYPE,
          options?.correlation
        );

        return ok({ content, sources, usage });
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
          options?.promptType ?? RESEARCH_PROMPT_TYPE,
          options?.correlation
        );
        return err(mapClaudeError(error));
      }
    },

    async generate(
      prompt: string,
      options: GenerateOptions
    ): Promise<Result<GenerateResult, ClaudeError>> {
      return await withRetry(() => generateOnce(prompt, options), {
        maxAttempts: 3,
        baseDelayMs: 500,
      });
    },
  };

  async function generateOnce(
    prompt: string,
    options: GenerateOptions
  ): Promise<Result<GenerateResult, ClaudeError>> {
    const start = Date.now();
    try {
      const { result, durationMs } = await measureLlmCall(async () => {
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
          0
        );
        return { content: text, usage, cacheReadTokens: usageDetails.cacheReadTokens };
      });

      trackUsage(
        'generate',
        result.usage,
        true,
        durationMs,
        undefined,
        options.promptType,
        options.correlation
      );

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
      trackUsage(
        'generate',
        emptyUsage,
        false,
        durationMs,
        errorMsg,
        options.promptType,
        options.correlation
      );
      return err(mapClaudeError(error));
    }
  }
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

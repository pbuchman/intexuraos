import { randomUUID } from 'node:crypto';
import {
  buildResearchPrompt,
  err,
  getErrorMessage,
  ok,
  type Result,
} from '@intexuraos/common-core';
import { type AuditContext, createAuditContext } from '@intexuraos/llm-audit';
import type { LLMClient, NormalizedUsage, GenerateResult } from '@intexuraos/llm-contract';
import type {
  PerplexityConfig,
  PerplexityError,
  PerplexityRequestBody,
  PerplexityResponse,
  PerplexityUsage,
  ResearchResult,
  SearchContextSize,
} from './types.js';

export type PerplexityClient = Pick<LLMClient, 'research' | 'generate'>;

const API_BASE_URL = 'https://api.perplexity.ai';

const SEARCH_CONTEXT_MAP: Record<string, SearchContextSize> = {
  sonar: 'low',
  'sonar-pro': 'medium',
  'sonar-deep-research': 'high',
};

const PERPLEXITY_PRICING: Record<string, { input: number; output: number }> = {
  sonar: { input: 1.0, output: 1.0 },
  'sonar-pro': { input: 3.0, output: 15.0 },
  'sonar-deep-research': { input: 2.0, output: 8.0 },
};

function createRequestContext(
  method: string,
  model: string,
  prompt: string
): { requestId: string; startTime: Date; auditContext: AuditContext } {
  const requestId = randomUUID();
  const startTime = new Date();
  const auditContext = createAuditContext({
    provider: 'perplexity',
    model,
    method,
    prompt,
    startedAt: startTime,
  });
  return { requestId, startTime, auditContext };
}

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PERPLEXITY_PRICING[model] ?? { input: 1.0, output: 1.0 };
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

function normalizeUsage(model: string, usage: PerplexityUsage | undefined): NormalizedUsage {
  if (usage === undefined) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    };
  }

  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
  const providerCost = usage.cost?.total_cost;
  const costUsd = providerCost ?? calculateCost(model, inputTokens, outputTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd,
  };
}

export function createPerplexityClient(config: PerplexityConfig): PerplexityClient {
  const { apiKey, model, usageLogger, userId } = config;

  function logUsage(
    method: string,
    usage: NormalizedUsage,
    success: boolean,
    errorMessage?: string
  ): void {
    if (usageLogger === undefined) return;
    const params = {
      userId: userId ?? 'unknown',
      provider: 'perplexity',
      model,
      method,
      usage,
      success,
    };
    void usageLogger.log(errorMessage !== undefined ? { ...params, errorMessage } : params);
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
        };

        const response = await fetch(`${API_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

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
          logUsage('research', emptyUsage, false, errorMsg);
          return err(mapPerplexityError(apiError));
        }

        const data = (await response.json()) as PerplexityResponse;
        const content = data.choices[0]?.message.content ?? '';
        const sources = extractSourcesFromResponse(data);
        const usage = normalizeUsage(model, data.usage);

        await auditContext.success({
          response: content,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          providerCost: usage.costUsd,
        });
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
        };

        const response = await fetch(`${API_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

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
          logUsage('generate', emptyUsage, false, errorMsg);
          return err(mapPerplexityError(apiError));
        }

        const data = (await response.json()) as PerplexityResponse;
        const content = data.choices[0]?.message.content ?? '';
        const usage = normalizeUsage(model, data.usage);

        await auditContext.success({
          response: content,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
        logUsage('generate', usage, true);

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
        logUsage('generate', emptyUsage, false, errorMsg);
        return err(mapPerplexityError(error));
      }
    },
  };
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

function mapPerplexityError(error: unknown): PerplexityError {
  if (error instanceof PerplexityApiError) {
    const message = error.message;
    if (error.status === 401) return { code: 'INVALID_KEY', message };
    if (error.status === 429) return { code: 'RATE_LIMITED', message };
    if (message.includes('context') && message.includes('length')) {
      return { code: 'CONTEXT_LENGTH', message };
    }
    if (message.includes('timeout')) return { code: 'TIMEOUT', message };
    return { code: 'API_ERROR', message };
  }
  const message = getErrorMessage(error);
  return { code: 'API_ERROR', message };
}

function extractSourcesFromResponse(response: PerplexityResponse): string[] {
  const sources: string[] = [];
  if (response.search_results !== undefined) {
    for (const result of response.search_results) {
      if (result.url !== undefined) {
        sources.push(result.url);
      }
    }
  }
  return [...new Set(sources)];
}

/**
 * Perplexity Client V2 - with parameterized pricing.
 *
 * No hardcoded pricing - all costs calculated from passed ModelPricing config.
 * Original createPerplexityClient() remains for backwards compatibility.
 */

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
import { logUsage, type CallType } from '@intexuraos/llm-pricing';
import type {
  PerplexityConfigV2,
  PerplexityError,
  PerplexityRequestBody,
  PerplexityResponse,
  PerplexityUsage,
  ResearchResult,
  SearchContextSize,
} from './types.js';
import { normalizeUsageV2 } from './costCalculator.js';

export type PerplexityClientV2 = Pick<LLMClient, 'research' | 'generate'>;

const API_BASE_URL = 'https://api.perplexity.ai';

const SEARCH_CONTEXT_MAP: Record<string, SearchContextSize> = {
  sonar: 'low',
  'sonar-pro': 'medium',
  'sonar-deep-research': 'high',
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

class PerplexityApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'PerplexityApiError';
  }
}

export function createPerplexityClientV2(config: PerplexityConfigV2): PerplexityClientV2 {
  const { apiKey, model, userId, pricing } = config;

  function trackUsage(
    callType: CallType,
    usage: NormalizedUsage,
    success: boolean,
    errorMessage?: string
  ): void {
    void logUsage({
      userId,
      provider: 'perplexity',
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
    return normalizeUsageV2(
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
          trackUsage('research', emptyUsage, false, errorMsg);
          return err(mapPerplexityError(apiError));
        }

        const data = (await response.json()) as PerplexityResponse;
        const content = data.choices[0]?.message.content ?? '';
        const sources = extractSourcesFromResponse(data);
        const usage = extractUsage(data.usage);

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
          trackUsage('generate', emptyUsage, false, errorMsg);
          return err(mapPerplexityError(apiError));
        }

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
  const message = getErrorMessage(error);
  if (message.includes('timeout')) return { code: 'TIMEOUT', message };
  return { code: 'API_ERROR', message };
}

function extractSourcesFromResponse(response: PerplexityResponse): string[] {
  const sources: string[] = [];
  if (response.search_results !== undefined && Array.isArray(response.search_results)) {
    for (const result of response.search_results) {
      if (result.url !== undefined) {
        sources.push(result.url);
      }
    }
  }
  return [...new Set(sources)];
}

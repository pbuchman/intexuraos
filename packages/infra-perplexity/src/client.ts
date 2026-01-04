import {
  buildResearchPrompt,
  err,
  getErrorMessage,
  ok,
  type Result,
} from '@intexuraos/common-core';
import { type AuditContext, createAuditContext } from '@intexuraos/llm-audit';
import type { LLMClient } from '@intexuraos/llm-contract';
import type {
  PerplexityConfig,
  PerplexityError,
  PerplexityRequestBody,
  PerplexityResponse,
  ResearchResult,
  SearchContextSize,
} from './types.js';

export type PerplexityClient = Pick<LLMClient, 'research' | 'generate'>;

interface LoggerLike {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

const API_BASE_URL = 'https://api.perplexity.ai';

const SEARCH_CONTEXT_MAP: Record<string, SearchContextSize> = {
  'sonar-pro': 'medium',
  'sonar-deep-research': 'high',
};

function createRequestContext(
  method: string,
  model: string,
  prompt: string,
  logger?: LoggerLike
): { requestId: string; startTime: Date; auditContext: AuditContext } {
  const requestId = crypto.randomUUID();
  const startTime = new Date();

  logger?.info(
    {
      requestId,
      model,
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 200),
    },
    `[Perplexity:${method}] Request`
  );

  const auditContext = createAuditContext({
    provider: 'perplexity',
    model,
    method,
    prompt,
    startedAt: startTime,
  });

  return { requestId, startTime, auditContext };
}

async function logSuccess(
  method: string,
  requestId: string,
  startTime: Date,
  response: string,
  auditContext: AuditContext,
  logger?: LoggerLike,
  usage?: {
    inputTokens: number;
    outputTokens: number;
    providerCost?: number;
  }
): Promise<void> {
  logger?.info(
    {
      requestId,
      durationMs: Date.now() - startTime.getTime(),
      responseLength: response.length,
      responsePreview: response.slice(0, 200),
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      providerCost: usage?.providerCost,
    },
    `[Perplexity:${method}] Response`
  );

  const auditParams: Parameters<typeof auditContext.success>[0] = { response };
  if (usage !== undefined) {
    auditParams.inputTokens = usage.inputTokens;
    auditParams.outputTokens = usage.outputTokens;
    if (usage.providerCost !== undefined) {
      auditParams.providerCost = usage.providerCost;
    }
  }
  await auditContext.success(auditParams);
}

async function logError(
  method: string,
  requestId: string,
  startTime: Date,
  error: unknown,
  auditContext: AuditContext,
  logger?: LoggerLike
): Promise<void> {
  const errorMessage = getErrorMessage(error, String(error));

  logger?.error(
    {
      requestId,
      durationMs: Date.now() - startTime.getTime(),
      error: errorMessage,
    },
    `[Perplexity:${method}] Error`
  );

  await auditContext.error({ error: errorMessage });
}

export function createPerplexityClient(config: PerplexityConfig): PerplexityClient {
  const { apiKey, model, logger } = config;

  return {
    async research(prompt: string): Promise<Result<ResearchResult, PerplexityError>> {
      const researchPrompt = buildResearchPrompt(prompt);
      const { requestId, startTime, auditContext } = createRequestContext(
        'research',
        model,
        researchPrompt,
        logger
      );

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
          throw new PerplexityApiError(response.status, errorText);
        }

        const data = (await response.json()) as PerplexityResponse;
        const content = data.choices[0]?.message.content ?? '';
        const sources = extractSourcesFromResponse(data);

        const result: ResearchResult = { content, sources };
        if (data.usage !== undefined) {
          result.usage = {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
          };
          if (data.usage.cost?.total_cost !== undefined) {
            result.usage.providerCost = data.usage.cost.total_cost;
          }
        }

        await logSuccess(
          'research',
          requestId,
          startTime,
          content,
          auditContext,
          logger,
          result.usage
        );
        return ok(result);
      } catch (error) {
        await logError('research', requestId, startTime, error, auditContext, logger);
        return err(mapPerplexityError(error));
      }
    },

    async generate(prompt: string): Promise<Result<string, PerplexityError>> {
      const { requestId, startTime, auditContext } = createRequestContext(
        'generate',
        model,
        prompt,
        logger
      );

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
          throw new PerplexityApiError(response.status, errorText);
        }

        const data = (await response.json()) as PerplexityResponse;
        const content = data.choices[0]?.message.content ?? '';

        await logSuccess('generate', requestId, startTime, content, auditContext, logger);
        return ok(content);
      } catch (error) {
        await logError('generate', requestId, startTime, error, auditContext, logger);
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

    if (error.status === 401) {
      return { code: 'INVALID_KEY', message };
    }
    if (error.status === 429) {
      return { code: 'RATE_LIMITED', message };
    }
    if (message.includes('context') && message.includes('length')) {
      return { code: 'CONTEXT_LENGTH', message };
    }
    if (message.includes('timeout')) {
      return { code: 'TIMEOUT', message };
    }

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

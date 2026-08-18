import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import {
  LlmProviders,
  type LLMError,
  type NormalizedUsage,
  type OwnerType,
} from '@intexuraos/llm-contract';
import { createUsageLogger, type UsageSink } from '@intexuraos/llm-pricing';
import { withRetry } from '@intexuraos/llm-utils';
import {
  mapOpenRouterModalityError,
  nonNegativeProviderCost,
  normalizeModalityUsage,
  postOpenRouterModalityJson,
  toOpenRouterModalityErrorCategory,
} from './modalityClientUtils.js';
import { OPENROUTER_TEXT_EMBEDDING_3_SMALL } from './modelIds.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_PROMPT_TYPE = 'embedding';
const INVALID_RESPONSE_MESSAGE = 'OpenRouter returned an invalid embedding response';

export interface OpenRouterEmbeddingOptions {
  promptType?: string;
  correlation?: {
    researchId?: string | null;
    sessionId?: string | null;
    taskId?: string | null;
    requestId?: string | null;
  };
}

export interface OpenRouterEmbeddingsConfig {
  apiKey: string;
  userId: string;
  logger: Logger;
  usageSink: UsageSink;
  ownerType?: OwnerType;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
}

export interface OpenRouterEmbeddingsClient {
  embed(text: string, options?: OpenRouterEmbeddingOptions): Promise<Result<number[], LLMError>>;
  embedMany(
    texts: string[],
    options?: OpenRouterEmbeddingOptions
  ): Promise<Result<number[][], LLMError>>;
}

interface EmbeddingApiResponse {
  data?: { embedding?: unknown; index?: unknown }[];
  usage?: { prompt_tokens?: unknown; total_tokens?: unknown; cost?: unknown };
}

export function createOpenRouterEmbeddingsClient(
  config: OpenRouterEmbeddingsConfig
): OpenRouterEmbeddingsClient {
  const {
    apiKey,
    userId,
    logger,
    usageSink,
    ownerType,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  } = config;
  const usageLogger = createUsageLogger({ logger, sink: usageSink });

  async function execute(
    texts: string[],
    options?: OpenRouterEmbeddingOptions
  ): Promise<Result<number[][], LLMError>> {
    const startedAt = Date.now();
    const trimmed = texts.map((text) => text.trim());
    let lastRawError: unknown;
    let finalUsage: NormalizedUsage = emptyUsage();
    let providerReportedUsd: number | null = null;

    if (trimmed.length === 0 || trimmed.some((text) => text.length === 0)) {
      const validationError: LLMError = {
        code: 'API_ERROR',
        message: 'Embedding input cannot be empty',
      };
      trackUsage(
        false,
        startedAt,
        finalUsage,
        validationError,
        'OPENROUTER_CLIENT_ERROR',
        null,
        options
      );
      return err(validationError);
    }

    const requestInput: string | string[] = trimmed.length === 1 ? (trimmed[0] as string) : trimmed;
    const result = await withRetry(
      async () => {
        try {
          const data = (await postOpenRouterModalityJson(
            '/embeddings',
            apiKey,
            {
              model: OPENROUTER_TEXT_EMBEDDING_3_SMALL.apiModelId,
              input: requestInput,
              dimensions: OPENROUTER_TEXT_EMBEDDING_3_SMALL.dimensions,
              encoding_format: 'float',
            },
            timeoutMs
          )) as EmbeddingApiResponse;
          const vectors = readVectors(data, trimmed.length);
          providerReportedUsd = nonNegativeProviderCost(data.usage?.cost);
          finalUsage = normalizeModalityUsage({
            promptTokens: data.usage?.prompt_tokens,
            totalTokens: data.usage?.total_tokens,
            providerReportedUsd,
          });
          return ok(vectors);
        } catch (error) {
          lastRawError = error;
          return err(mapOpenRouterModalityError(error));
        }
      },
      { maxAttempts, baseDelayMs: retryBaseDelayMs }
    );

    if (result.ok) {
      trackUsage(true, startedAt, finalUsage, undefined, undefined, providerReportedUsd, options);
      return result;
    }
    trackUsage(
      false,
      startedAt,
      finalUsage,
      result.error,
      toOpenRouterModalityErrorCategory(lastRawError),
      providerReportedUsd,
      options
    );
    return result;
  }

  function trackUsage(
    success: boolean,
    startedAt: number,
    usage: NormalizedUsage,
    _error: LLMError | undefined,
    errorCategory: string | undefined,
    providerCost: number | null,
    options?: OpenRouterEmbeddingOptions
  ): void {
    void usageLogger.log({
      userId,
      provider: LlmProviders.OpenRouter,
      model: OPENROUTER_TEXT_EMBEDDING_3_SMALL.evidenceModelId,
      callType: 'embedding',
      usage,
      success,
      durationMs: Date.now() - startedAt,
      ...(errorCategory === undefined ? {} : { errorMessage: errorCategory }),
      ...(providerCost === null ? {} : { providerReportedUsd: providerCost }),
      ...(ownerType === undefined ? {} : { ownerType }),
      ...(options?.promptType === undefined
        ? { promptType: DEFAULT_PROMPT_TYPE }
        : { promptType: options.promptType }),
      ...(options?.correlation === undefined ? {} : { correlation: options.correlation }),
    });
  }

  return {
    async embed(
      text: string,
      options?: OpenRouterEmbeddingOptions
    ): Promise<Result<number[], LLMError>> {
      const result = await execute([text], options);
      if (!result.ok) return result;
      const first = result.value[0];
      return first === undefined
        ? err({ code: 'API_ERROR', message: INVALID_RESPONSE_MESSAGE })
        : ok(first);
    },
    embedMany: execute,
  };
}

function readVectors(data: EmbeddingApiResponse, expectedCount: number): number[][] {
  if (!Array.isArray(data.data) || data.data.length !== expectedCount) {
    throw new Error(INVALID_RESPONSE_MESSAGE);
  }
  const sorted = [...data.data].sort((left, right) =>
    typeof left.index === 'number' && typeof right.index === 'number' ? left.index - right.index : 0
  );
  const vectors: number[][] = [];
  for (let expectedIndex = 0; expectedIndex < sorted.length; expectedIndex++) {
    const item = sorted[expectedIndex];
    if (
      item?.index !== expectedIndex ||
      !Array.isArray(item.embedding) ||
      item.embedding.length !== OPENROUTER_TEXT_EMBEDDING_3_SMALL.dimensions ||
      !item.embedding.every((value) => typeof value === 'number' && Number.isFinite(value))
    ) {
      throw new Error(INVALID_RESPONSE_MESSAGE);
    }
    vectors.push(item.embedding as number[]);
  }
  return vectors;
}

function emptyUsage(): NormalizedUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
}

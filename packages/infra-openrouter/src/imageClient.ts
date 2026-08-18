import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import {
  LlmProviders,
  type ImageGenerationResult,
  type ImageSize,
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
import { OPENROUTER_GPT_IMAGE_1 } from './modelIds.js';

const DEFAULT_TIMEOUT_MS = 840_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_IMAGE_SIZE: ImageSize = '1024x1024';
const DEFAULT_PROMPT_TYPE = 'image-generation';
const NO_IMAGE_DATA_MESSAGE = 'OpenRouter returned no image data';

export interface OpenRouterImageOptions {
  size?: ImageSize;
  promptType?: string;
  correlation?: {
    researchId?: string | null;
    sessionId?: string | null;
    taskId?: string | null;
    requestId?: string | null;
  };
}

export interface OpenRouterImageConfig {
  apiKey: string;
  userId: string;
  logger: Logger;
  usageSink: UsageSink;
  ownerType?: OwnerType;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
}

export interface OpenRouterImageClient {
  generateImage(
    prompt: string,
    options?: OpenRouterImageOptions
  ): Promise<Result<ImageGenerationResult, LLMError>>;
}

interface ImageApiResponse {
  data?: { b64_json?: unknown }[];
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
    cost?: unknown;
  };
}

export function createOpenRouterImageClient(config: OpenRouterImageConfig): OpenRouterImageClient {
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

  return {
    async generateImage(
      prompt: string,
      options?: OpenRouterImageOptions
    ): Promise<Result<ImageGenerationResult, LLMError>> {
      const startedAt = Date.now();
      const size = options?.size ?? DEFAULT_IMAGE_SIZE;
      let lastRawError: unknown;
      let finalUsage: NormalizedUsage = imageUsage(emptyUsage(), size, 0);
      let providerReportedUsd: number | null = null;

      const result = await withRetry(
        async () => {
          try {
            const data = (await postOpenRouterModalityJson(
              '/images',
              apiKey,
              {
                model: OPENROUTER_GPT_IMAGE_1.apiModelId,
                prompt,
                n: 1,
                size,
              },
              timeoutMs
            )) as ImageApiResponse;
            const base64 = data.data?.[0]?.b64_json;
            if (typeof base64 !== 'string' || base64.length === 0) {
              throw new Error(NO_IMAGE_DATA_MESSAGE);
            }
            providerReportedUsd = nonNegativeProviderCost(data.usage?.cost);
            const tokenUsage = normalizeModalityUsage({
              promptTokens: data.usage?.prompt_tokens,
              completionTokens: data.usage?.completion_tokens,
              totalTokens: data.usage?.total_tokens,
              providerReportedUsd,
            });
            finalUsage = imageUsage(tokenUsage, size, 1);
            return ok({
              imageData: Buffer.from(base64, 'base64'),
              model: OPENROUTER_GPT_IMAGE_1.publicModelId,
              usage: finalUsage,
            });
          } catch (error) {
            lastRawError = error;
            return err(mapOpenRouterModalityError(error));
          }
        },
        { maxAttempts, baseDelayMs: retryBaseDelayMs }
      );

      if (result.ok) {
        trackUsage(true, startedAt, finalUsage, undefined, providerReportedUsd, options);
        return result;
      }
      trackUsage(
        false,
        startedAt,
        finalUsage,
        toOpenRouterModalityErrorCategory(lastRawError),
        providerReportedUsd,
        options
      );
      return result;
    },
  };

  function trackUsage(
    success: boolean,
    startedAt: number,
    usage: NormalizedUsage,
    errorCategory: string | undefined,
    providerCost: number | null,
    options?: OpenRouterImageOptions
  ): void {
    void usageLogger.log({
      userId,
      provider: LlmProviders.OpenRouter,
      model: OPENROUTER_GPT_IMAGE_1.evidenceModelId,
      callType: 'image_generation',
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
}

function emptyUsage(): NormalizedUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
}

function imageUsage(
  usage: NormalizedUsage,
  imageSize: ImageSize,
  imageCount: number
): NormalizedUsage {
  return { ...usage, imageCount, imageSize };
}

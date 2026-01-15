/**
 * OpenAI GPT client implementation.
 *
 * Implements the {@link LLMClient} interface for GPT models with:
 * - Web search research using OpenAI's web search tools
 * - Image generation via DALL-E (gpt-image-1)
 * - Prompt caching with cost tracking
 * - Automatic usage logging to Firestore
 * - Audit trail for all requests
 *
 * @packageDocumentation
 *
 * @example
 * ```ts
 * import { createGptClient } from '@intexuraos/infra-gpt';
 *
 * const client = createGptClient({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'gpt-4.1',
 *   userId: 'user-123',
 *   pricing: {
 *     inputPricePerMillion: 2.50,
 *     outputPricePerMillion: 10.00,
 *   }
 * });
 *
 * // Research with web search
 * const research = await client.research('Latest TypeScript features');
 * if (research.ok) {
 *   console.log(research.data.content);
 *   console.log('Cost:', research.data.usage.costUsd);
 * }
 *
 * // Image generation
 * const image = await client.generateImage('A sunset over mountains', { size: '1024x1024' });
 * if (image.ok) {
 *   console.log('Image generated:', image.data.imageData);
 * }
 * ```
 */

import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { buildResearchPrompt } from '@intexuraos/llm-common';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { type AuditContext, createAuditContext } from '@intexuraos/llm-audit';
import {
  LlmModels,
  LlmProviders,
  type LLMClient,
  type NormalizedUsage,
  type ImageGenerateOptions,
  type ImageGenerationResult,
  type GenerateResult,
  type ImageSize,
} from '@intexuraos/llm-contract';
import { logUsage, type CallType } from '@intexuraos/llm-pricing';
import type { GptConfig, GptError, ResearchResult } from './types.js';
import { normalizeUsage, calculateImageCost } from './costCalculator.js';

export type GptClient = LLMClient;

const MAX_TOKENS = 8192;
const IMAGE_MODEL = LlmModels.GPTImage1;
const DEFAULT_IMAGE_SIZE: ImageSize = '1024x1024';

/**
 * Creates a configured OpenAI GPT client.
 *
 * The client implements {@link LLMClient} with automatic cost calculation,
 * usage logging, and audit tracking. Supports text generation, research,
 * and image generation.
 *
 * @param config - Client configuration including API key, model, user ID, and pricing
 * @returns A configured {@link GptClient} instance
 *
 * @example
 * ```ts
 * const client = createGptClient({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'gpt-4.1',
 *   userId: 'user-123',
 *   pricing: {
 *     inputPricePerMillion: 2.50,
 *     outputPricePerMillion: 10.00,
 *   },
 *   imagePricing: {
 *     inputPricePerMillion: 0,
 *     outputPricePerMillion: 0,
 *     imagePricing: { '1024x1024': 0.040 }
 *   }
 * });
 * ```
 */
export function createGptClient(config: GptConfig): GptClient {
  const client = new OpenAI({ apiKey: config.apiKey });
  const { model, userId, pricing, imagePricing } = config;

  function createRequestContext(
    method: string,
    model: string,
    prompt: string
  ): { requestId: string; startTime: Date; auditContext: AuditContext } {
    const requestId = randomUUID();
    const startTime = new Date();
    const auditContext = createAuditContext({
      provider: LlmProviders.OpenAI,
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
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- TODO: Migrate to UsageLogger class with injected logger
    void logUsage({
      userId,
      provider: LlmProviders.OpenAI,
      model,
      callType,
      usage,
      success,
      ...(errorMessage !== undefined && { errorMessage }),
    });
  }

  function extractUsageDetails(
    usage: OpenAI.Responses.ResponseUsage | OpenAI.CompletionUsage | undefined
  ): {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    reasoningTokens: number | undefined;
  } {
    if (usage === undefined) {
      return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: undefined };
    }

    const inputTokens = 'input_tokens' in usage ? usage.input_tokens : usage.prompt_tokens;
    const outputTokens = 'output_tokens' in usage ? usage.output_tokens : usage.completion_tokens;

    const cachedTokens =
      'input_tokens_details' in usage
        ? ((usage as { input_tokens_details?: { cached_tokens?: number } }).input_tokens_details
            ?.cached_tokens ?? 0)
        : 0;

    const reasoningTokens =
      'output_tokens_details' in usage
        ? (usage as { output_tokens_details?: { reasoning_tokens?: number } }).output_tokens_details
            ?.reasoning_tokens
        : undefined;

    return { inputTokens, outputTokens, cachedTokens, reasoningTokens };
  }

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GptError>> {
      const researchPrompt = buildResearchPrompt(prompt);
      const { auditContext } = createRequestContext('research', model, researchPrompt);

      try {
        const response = await client.responses.create({
          model,
          instructions:
            'You are a senior research analyst. Search the web for current, authoritative information. Cross-reference sources and cite all findings with URLs.',
          input: researchPrompt,
          tools: [{ type: 'web_search_preview', search_context_size: 'medium' }],
        });

        const content = response.output_text;
        const sources = extractSourcesFromResponse(response);
        const webSearchCalls = countWebSearchCalls(response);
        const usageDetails = extractUsageDetails(response.usage);
        const usage = normalizeUsage(
          usageDetails.inputTokens,
          usageDetails.outputTokens,
          usageDetails.cachedTokens,
          webSearchCalls,
          usageDetails.reasoningTokens,
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
        return err(mapGptError(error));
      }
    },

    async generate(prompt: string): Promise<Result<GenerateResult, GptError>> {
      const { auditContext } = createRequestContext('generate', model, prompt);

      try {
        const response = await client.chat.completions.create({
          model,
          max_completion_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.choices[0]?.message.content ?? '';
        const usageDetails = extractUsageDetails(response.usage);
        const usage = normalizeUsage(
          usageDetails.inputTokens,
          usageDetails.outputTokens,
          usageDetails.cachedTokens,
          0,
          usageDetails.reasoningTokens,
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
        return err(mapGptError(error));
      }
    },

    async generateImage(
      prompt: string,
      options?: ImageGenerateOptions
    ): Promise<Result<ImageGenerationResult, GptError>> {
      const { auditContext } = createRequestContext('generateImage', IMAGE_MODEL, prompt);

      try {
        const size: ImageSize = options?.size ?? DEFAULT_IMAGE_SIZE;
        // gpt-image-1 returns base64 data in response.data[0].b64_json by default
        const response = await client.images.generate({
          model: IMAGE_MODEL,
          prompt,
          n: 1,
          size,
        });

        // gpt-image-1 returns b64_json in the response
        const imageData = response.data?.[0];
        const b64Data = imageData?.b64_json ?? imageData?.url;

        if (b64Data === undefined) {
          const errorMsg = 'No image data in response';
          await auditContext.error({ error: errorMsg });
          return err({ code: 'API_ERROR', message: errorMsg });
        }

        // If we got a URL, fetch the image data
        let imageBuffer: Buffer;
        if (imageData?.b64_json !== undefined) {
          imageBuffer = Buffer.from(imageData.b64_json, 'base64');
        } else {
          // Must be URL since we passed the b64Data check above (b64Data = b64_json ?? url)
          const imageUrl = imageData?.url as string;
          const imageResponse = await fetch(imageUrl);
          const arrayBuffer = await imageResponse.arrayBuffer();
          imageBuffer = Buffer.from(arrayBuffer);
        }

        const pricingConfig = imagePricing ?? pricing;
        const imageCost = calculateImageCost(size, pricingConfig);

        const usage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: imageCost,
        };

        await auditContext.success({
          response: '[image-generated]',
          imageCostUsd: imageCost,
        });
        trackUsage('image_generation', usage, true);

        return ok({ imageData: imageBuffer, model: IMAGE_MODEL, usage });
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        await auditContext.error({ error: errorMsg });
        const emptyUsage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        trackUsage('image_generation', emptyUsage, false, errorMsg);
        return err(mapGptError(error));
      }
    },
  };
}

function mapGptError(error: unknown): GptError {
  if (error instanceof OpenAI.APIError) {
    const message = error.message;
    if (error.status === 401) return { code: 'INVALID_KEY', message };
    if (error.status === 429) return { code: 'RATE_LIMITED', message };
    if (error.code === 'context_length_exceeded') return { code: 'CONTEXT_LENGTH', message };
    if (message.includes('timeout')) return { code: 'TIMEOUT', message };
    return { code: 'API_ERROR', message };
  }
  const message = getErrorMessage(error);
  return { code: 'API_ERROR', message };
}

function extractSourcesFromResponse(response: OpenAI.Responses.Response): string[] {
  const sources: string[] = [];
  for (const item of response.output) {
    if (item.type === 'web_search_call' && 'results' in item) {
      const results = item.results as { url?: string }[] | undefined;
      if (Array.isArray(results)) {
        for (const result of results) {
          if (result.url !== undefined) {
            sources.push(result.url);
          }
        }
      }
    }
  }
  return [...new Set(sources)];
}

function countWebSearchCalls(response: OpenAI.Responses.Response): number {
  let count = 0;
  for (const item of response.output) {
    if (item.type === 'web_search_call') {
      count++;
    }
  }
  return count;
}

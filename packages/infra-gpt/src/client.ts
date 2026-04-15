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
 *   logger: pinoLogger,
 *   usageSink: myUsageSink,
 * });
 *
 * // Research with web search
 * const research = await client.research('Latest TypeScript features');
 * if (research.ok) {
 *   console.log(research.data.content);
 * }
 *
 * // Image generation
 * const image = await client.generateImage('A sunset over mountains', { size: '1024x1024' });
 * if (image.ok) {
 *   console.log('Image generated:', image.data.imageData);
 * }
 * ```
 */

import OpenAI from 'openai';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
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
import { createUsageLogger, type CallType } from '@intexuraos/llm-pricing';
import type { GptConfig, GptError, ResearchResult } from './types.js';
import { normalizeUsage } from './costCalculator.js';

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
 *   logger: pinoLogger,
 *   usageSink: myUsageSink,
 * });
 * ```
 */
export function createGptClient(config: GptConfig): GptClient {
  const client = new OpenAI({ apiKey: config.apiKey });
  const { model, userId, logger, usageSink, ownerType } = config;
  const usageLogger = createUsageLogger({ logger, sink: usageSink });

  function trackUsage(
    callType: CallType,
    usage: NormalizedUsage,
    success: boolean,
    errorMessage?: string
  ): void {
    void usageLogger.log({
      userId,
      provider: LlmProviders.OpenAI,
      model,
      callType,
      usage,
      success,
      ...(errorMessage !== undefined && { errorMessage }),
      ...(ownerType !== undefined && { ownerType }),
    });
  }

  function extractUsageDetails(
    usage: OpenAI.Responses.ResponseUsage | OpenAI.CompletionUsage | undefined
  ): {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    reasoningTokens: number | undefined; // @allow-undefined-type -- function return type, not object property
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
      try {
        const response = await client.responses.create({
          model,
          instructions:
            'You are a senior research analyst. Search the web for current, authoritative information. Cross-reference sources and cite all findings with URLs.',
          input: prompt,
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
          usageDetails.reasoningTokens
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
        return err(mapGptError(error));
      }
    },

    async generate(prompt: string): Promise<Result<GenerateResult, GptError>> {
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
          usageDetails.reasoningTokens
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
        return err(mapGptError(error));
      }
    },

    async generateImage(
      prompt: string,
      options?: ImageGenerateOptions
    ): Promise<Result<ImageGenerationResult, GptError>> {
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

        const usage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };

        trackUsage('image_generation', usage, true);

        return ok({ imageData: imageBuffer, model: IMAGE_MODEL, usage });
      } catch (error) {
        const errorMsg = getErrorMessage(error);
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

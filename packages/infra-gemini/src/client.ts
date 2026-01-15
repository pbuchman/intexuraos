/**
 * Google Gemini client implementation.
 *
 * Implements the {@link LLMClient} interface for Gemini models with:
 * - Grounding with Google Search integration
 * - Image generation via Gemini 2.5 Flash
 * - Automatic usage logging to Firestore
 * - Audit trail for all requests
 *
 * @packageDocumentation
 *
 * @example
 * ```ts
 * import { createGeminiClient } from '@intexuraos/infra-gemini';
 *
 * const client = createGeminiClient({
 *   apiKey: process.env.GOOGLE_API_KEY,
 *   model: 'gemini-2.5-flash',
 *   userId: 'user-123',
 *   pricing: {
 *     inputPricePerMillion: 0.075,
 *     outputPricePerMillion: 0.30,
 *     groundingCostPerRequest: 0.002,
 *   }
 * });
 *
 * const result = await client.generate('Explain quantum computing');
 * if (result.ok) {
 *   console.log(result.data.content);
 *   console.log('Cost:', result.data.usage.costUsd);
 * }
 * ```
 */

import { randomUUID } from 'node:crypto';
import { type GenerateContentResponse, GoogleGenAI } from '@google/genai';
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
import type { GeminiConfig, GeminiError, ResearchResult } from './types.js';
import { normalizeUsage, calculateImageCost } from './costCalculator.js';

export type GeminiClient = LLMClient;

const IMAGE_MODEL = LlmModels.Gemini25FlashImage;
const DEFAULT_IMAGE_SIZE: ImageSize = '1024x1024';

function createRequestContext(
  method: string,
  model: string,
  prompt: string
): { requestId: string; startTime: Date; auditContext: AuditContext } {
  const requestId = randomUUID();
  const startTime = new Date();
  const auditContext = createAuditContext({
    provider: LlmProviders.Google,
    model,
    method,
    prompt,
    startedAt: startTime,
  });
  return { requestId, startTime, auditContext };
}

export function createGeminiClient(config: GeminiConfig): GeminiClient {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const { model, userId, pricing, imagePricing, logger } = config;

  function trackUsage(
    callType: CallType,
    usage: NormalizedUsage,
    success: boolean,
    errorMessage?: string
  ): void {
    void logUsage({
      userId,
      provider: LlmProviders.Google,
      model,
      callType,
      usage,
      success,
      ...(errorMessage !== undefined && { errorMessage }),
      ...(logger !== undefined && { logger }),
    });
  }

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GeminiError>> {
      const researchPrompt = buildResearchPrompt(prompt);
      const { auditContext } = createRequestContext('research', model, researchPrompt);

      try {
        const response = await ai.models.generateContent({
          model,
          contents: researchPrompt,
          config: { tools: [{ googleSearch: {} }] },
        });

        const text = response.text ?? '';
        const sources = extractSourcesFromResponse(response);
        const groundingEnabled = hasGroundingMetadata(response);
        const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
        const usage = normalizeUsage(inputTokens, outputTokens, groundingEnabled, pricing);

        await auditContext.success({
          response: text,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          groundingEnabled,
        });
        trackUsage('research', usage, true);

        return ok({ content: text, sources, usage });
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
        return err(mapGeminiError(error));
      }
    },

    async generate(prompt: string): Promise<Result<GenerateResult, GeminiError>> {
      const { auditContext } = createRequestContext('generate', model, prompt);

      try {
        const response = await ai.models.generateContent({ model, contents: prompt });
        const text = response.text ?? '';
        const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
        const usage = normalizeUsage(inputTokens, outputTokens, false, pricing);

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
        return err(mapGeminiError(error));
      }
    },

    async generateImage(
      prompt: string,
      options?: ImageGenerateOptions
    ): Promise<Result<ImageGenerationResult, GeminiError>> {
      const { auditContext } = createRequestContext('generateImage', IMAGE_MODEL, prompt);

      try {
        const response = await ai.models.generateContent({
          model: IMAGE_MODEL,
          contents: prompt,
        });

        const parts = response.candidates?.[0]?.content?.parts;
        const imagePart = parts?.find((part) => part.inlineData !== undefined);

        if (imagePart?.inlineData?.data === undefined) {
          const errorMsg = 'No image data in response';
          await auditContext.error({ error: errorMsg });
          return err({ code: 'API_ERROR', message: errorMsg });
        }

        const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
        const size: ImageSize = options?.size ?? DEFAULT_IMAGE_SIZE;
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
        return err(mapGeminiError(error));
      }
    },
  };
}

function mapGeminiError(error: unknown): GeminiError {
  const message = getErrorMessage(error);
  if (message.includes('API_KEY')) return { code: 'INVALID_KEY', message };
  if (message.includes('429') || message.includes('quota'))
    return { code: 'RATE_LIMITED', message };
  if (message.includes('timeout')) return { code: 'TIMEOUT', message };
  if (message.includes('SAFETY') || message.includes('blocked')) {
    return { code: 'CONTENT_FILTERED', message };
  }
  return { code: 'API_ERROR', message };
}

function extractSourcesFromResponse(response: GenerateContentResponse): string[] {
  const sources: string[] = [];
  const candidate = response.candidates?.[0];
  if (candidate?.groundingMetadata !== undefined) {
    const groundingChunks = candidate.groundingMetadata.groundingChunks;
    if (Array.isArray(groundingChunks)) {
      for (const chunk of groundingChunks) {
        if (chunk.web?.uri !== undefined) {
          sources.push(chunk.web.uri);
        }
      }
    }
  }
  return [...new Set(sources)];
}

function hasGroundingMetadata(response: GenerateContentResponse): boolean {
  return response.candidates?.[0]?.groundingMetadata !== undefined;
}

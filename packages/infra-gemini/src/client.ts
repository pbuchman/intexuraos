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
 *   logger: pinoLogger,
 *   usageSink: myUsageSink,
 * });
 *
 * const result = await client.generate('Explain quantum computing');
 * if (result.ok) {
 *   console.log(result.data.content);
 * }
 * ```
 */

import { type GenerateContentResponse, GoogleGenAI } from '@google/genai';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import {
  LlmModels,
  LlmProviders,
  type LLMClient,
  type NormalizedUsage,
  type ImageGenerateOptions,
  type ImageGenerationResult,
  type GenerateResult,
} from '@intexuraos/llm-contract';
import { createUsageLogger, type CallType } from '@intexuraos/llm-pricing';
import { withLlmSpan, withRetry } from '@intexuraos/llm-utils';
import type { GeminiConfig, GeminiError, ResearchResult } from './types.js';
import { normalizeUsage } from './costCalculator.js';
import { resolveVertexRedirectUrls } from './vertexUrlResolver.js';

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

export interface GeminiClient extends Omit<LLMClient, 'generate'> {
  /**
   * Generates text completion without web search.
   *
   * Uses only the model's training data. Faster and cheaper than research.
   *
   * @param prompt - The input prompt for generation
   * @param options - Generation options including promptType for usage tracking
   * @returns Promise resolving to {@link GenerateResult} or {@link GeminiError}
   */
  generate(
    prompt: string,
    options: GenerateOptions
  ): Promise<Result<GenerateResult, GeminiError>>;
}

const IMAGE_MODEL = LlmModels.Gemini25FlashImage;

export function createGeminiClient(config: GeminiConfig): GeminiClient {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
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
      provider: LlmProviders.Google,
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

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GeminiError>> {
      const start = Date.now();
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: { tools: [{ googleSearch: {} }] },
        });

        const text = response.text ?? '';
        const rawSources = extractSourcesFromResponse(response);
        const sources = await resolveVertexRedirectUrls(rawSources);
        const groundingEnabled = hasGroundingMetadata(response);
        const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
        const thinkingTokens = response.usageMetadata?.thoughtsTokenCount ?? 0;
        const usage = normalizeUsage(inputTokens, outputTokens, groundingEnabled, thinkingTokens);

        trackUsage('research', usage, true, Date.now() - start);

        return ok({ content: text, sources, usage });
      } catch (error) {
        const durationMs = Date.now() - start;
        const errorMsg = getErrorMessage(error);
        const emptyUsage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        trackUsage('research', emptyUsage, false, durationMs, errorMsg);
        return err(mapGeminiError(error));
      }
    },

    async generate(
      prompt: string,
      options: GenerateOptions
    ): Promise<Result<GenerateResult, GeminiError>> {
      return await withRetry(() => generateOnce(prompt, options), {
        maxAttempts: 3,
        baseDelayMs: 500,
      });
    },

    async generateImage(
      prompt: string,
      _options?: ImageGenerateOptions
    ): Promise<Result<ImageGenerationResult, GeminiError>> {
      const start = Date.now();
      try {
        const response = await ai.models.generateContent({
          model: IMAGE_MODEL,
          contents: prompt,
        });

        const parts = response.candidates?.[0]?.content?.parts;
        const imagePart = parts?.find((part) => part.inlineData !== undefined);

        if (imagePart?.inlineData?.data === undefined) {
          const errorMsg = 'No image data in response';
          return err({ code: 'API_ERROR', message: errorMsg });
        }

        const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');

        const usage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };

        trackUsage('image_generation', usage, true, Date.now() - start);

        return ok({ imageData: imageBuffer, model: IMAGE_MODEL, usage });
      } catch (error) {
        const durationMs = Date.now() - start;
        const errorMsg = getErrorMessage(error);
        const emptyUsage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        trackUsage('image_generation', emptyUsage, false, durationMs, errorMsg);
        return err(mapGeminiError(error));
      }
    },
  };

  async function generateOnce(
    prompt: string,
    options: GenerateOptions
  ): Promise<Result<GenerateResult, GeminiError>> {
    const start = Date.now();
    try {
      const { result, durationMs } = await withLlmSpan(
        LlmProviders.Google,
        async () => {
          const response = await ai.models.generateContent({ model, contents: prompt });
          const text = response.text ?? '';
          const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
          const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
          const thinkingTokens = response.usageMetadata?.thoughtsTokenCount ?? 0;
          const usage = normalizeUsage(inputTokens, outputTokens, false, thinkingTokens);
          return { content: text, usage };
        },
        ({ usage }) => ({
          model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: usage.costUsd,
        })
      );

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
      return err(mapGeminiError(error));
    }
  }
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

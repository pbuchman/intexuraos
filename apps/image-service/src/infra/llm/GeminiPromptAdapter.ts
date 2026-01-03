// eslint-disable-next-line no-restricted-imports -- Direct API needed for thumbnail prompt generation
import { GoogleGenAI } from '@google/genai';
import { err, getErrorMessage, type Result } from '@intexuraos/common-core';
import { createAuditContext } from '@intexuraos/llm-audit';
import type { ThumbnailPrompt } from '../../domain/index.js';
import type { PromptGenerationError, PromptGenerator } from '../../domain/ports/promptGenerator.js';
import { THUMBNAIL_PROMPT_SYSTEM } from './systemPrompt.js';
import { parseThumbnailPromptResponse } from './parseResponse.js';

interface LoggerLike {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface GeminiPromptAdapterConfig {
  apiKey: string;
  model?: string;
  logger?: LoggerLike | undefined;
}

const DEFAULT_MODEL = 'gemini-2.5-pro';

export class GeminiPromptAdapter implements PromptGenerator {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly logger: LoggerLike | undefined;

  constructor(config: GeminiPromptAdapterConfig) {
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    this.model = config.model ?? DEFAULT_MODEL;
    this.logger = config.logger;
  }

  async generateThumbnailPrompt(
    text: string
  ): Promise<Result<ThumbnailPrompt, PromptGenerationError>> {
    const fullPrompt = `${THUMBNAIL_PROMPT_SYSTEM}\n\nTEXT:\n${text}`;
    const requestId = crypto.randomUUID();
    const startTime = new Date();

    const auditContext = createAuditContext({
      provider: 'google',
      model: this.model,
      method: 'generateThumbnailPrompt',
      prompt: fullPrompt,
      startedAt: startTime,
    });

    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: fullPrompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const responseText = response.text ?? '';

      this.logger?.info(
        {
          requestId,
          durationMs: Date.now() - startTime.getTime(),
          responseLength: responseText.length,
        },
        'Gemini prompt response received'
      );

      const parseResult = parseThumbnailPromptResponse(responseText);

      if (!parseResult.ok) {
        await auditContext.error({ error: parseResult.error.message });
        return parseResult;
      }

      const usage = response.usageMetadata;
      const inputTokens = usage?.promptTokenCount;
      const outputTokens = usage?.candidatesTokenCount;

      if (inputTokens !== undefined && outputTokens !== undefined) {
        await auditContext.success({
          response: responseText,
          inputTokens,
          outputTokens,
        });
      } else {
        await auditContext.success({ response: responseText });
      }

      return parseResult;
    } catch (error) {
      const message = getErrorMessage(error);

      this.logger?.error(
        { requestId, durationMs: Date.now() - startTime.getTime(), err: message },
        'Gemini prompt generation failed'
      );

      await auditContext.error({ error: message });
      return err(mapGeminiError(message));
    }
  }
}

function mapGeminiError(message: string): PromptGenerationError {
  if (message.includes('API_KEY')) {
    return { code: 'INVALID_KEY', message };
  }
  if (message.includes('429') || message.includes('quota')) {
    return { code: 'RATE_LIMITED', message };
  }
  if (message.includes('timeout')) {
    return { code: 'TIMEOUT', message };
  }
  return { code: 'API_ERROR', message };
}

export function createGeminiPromptAdapter(config: GeminiPromptAdapterConfig): PromptGenerator {
  return new GeminiPromptAdapter(config);
}

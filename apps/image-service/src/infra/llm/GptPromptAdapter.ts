// eslint-disable-next-line no-restricted-imports -- Direct API needed for thumbnail prompt generation
import OpenAI from 'openai';
import { err, getErrorMessage, type Result } from '@intexuraos/common-core';
import { createAuditContext } from '@intexuraos/llm-audit';
import type { ThumbnailPrompt } from '../../domain/index.js';
import type { PromptGenerationError, PromptGenerator } from '../../domain/ports/promptGenerator.js';
import { THUMBNAIL_PROMPT_SYSTEM } from './systemPrompt.js';
import { parseThumbnailPromptResponse } from './parseResponse.js';

export interface GptPromptAdapterConfig {
  apiKey: string;
  model?: string;
}

const DEFAULT_MODEL = 'gpt-4.1';

export class GptPromptAdapter implements PromptGenerator {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: GptPromptAdapterConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async generateThumbnailPrompt(
    text: string
  ): Promise<Result<ThumbnailPrompt, PromptGenerationError>> {
    const requestId = crypto.randomUUID();
    const startTime = new Date();

    const auditContext = createAuditContext({
      provider: 'openai',
      model: this.model,
      method: 'generateThumbnailPrompt',
      prompt: text,
      startedAt: startTime,
    });

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: THUMBNAIL_PROMPT_SYSTEM },
          { role: 'user', content: `TEXT:\n${text}` },
        ],
        response_format: { type: 'json_object' },
      });

      const responseText = response.choices[0]?.message.content ?? '';

      // eslint-disable-next-line no-console
      console.info('[GptPromptAdapter] Response received', {
        requestId,
        durationMs: Date.now() - startTime.getTime(),
        responseLength: responseText.length,
      });

      const parseResult = parseThumbnailPromptResponse(responseText);

      if (!parseResult.ok) {
        await auditContext.error({ error: parseResult.error.message });
        return parseResult;
      }

      const usage = response.usage;
      const inputTokens = usage?.prompt_tokens;
      const outputTokens = usage?.completion_tokens;

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

      // eslint-disable-next-line no-console
      console.error('[GptPromptAdapter] Error', {
        requestId,
        durationMs: Date.now() - startTime.getTime(),
        error: message,
      });

      await auditContext.error({ error: message });
      return err(mapGptError(message));
    }
  }
}

function mapGptError(message: string): PromptGenerationError {
  const messageLower = message.toLowerCase();
  if (messageLower.includes('api key') || messageLower.includes('incorrect api key')) {
    return { code: 'INVALID_KEY', message };
  }
  if (
    message.includes('429') ||
    messageLower.includes('rate limit') ||
    messageLower.includes('rate_limit')
  ) {
    return { code: 'RATE_LIMITED', message };
  }
  if (
    messageLower.includes('timeout') ||
    messageLower.includes('etimedout') ||
    messageLower.includes('timed out')
  ) {
    return { code: 'TIMEOUT', message };
  }
  return { code: 'API_ERROR', message };
}

export function createGptPromptAdapter(config: GptPromptAdapterConfig): PromptGenerator {
  return new GptPromptAdapter(config);
}

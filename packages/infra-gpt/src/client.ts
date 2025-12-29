import OpenAI from 'openai';
import { ok, err, type Result } from '@intexuraos/common-core';
import type { GptConfig, ResearchResult, GptError } from './types.js';

const DEFAULT_MODEL = 'gpt-4o';
const MAX_TOKENS = 8192;

export interface GptClient {
  research(prompt: string): Promise<Result<ResearchResult, GptError>>;
}

function logRequest(
  method: string,
  model: string,
  promptLength: number,
  promptPreview: string
): { requestId: string; startTime: number } {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  // eslint-disable-next-line no-console
  console.info(
    `[GPT:${method}] Request`,
    JSON.stringify({ requestId, model, promptLength, promptPreview })
  );
  return { requestId, startTime };
}

function logResponse(
  method: string,
  requestId: string,
  startTime: number,
  responseLength: number,
  responsePreview: string
): void {
  // eslint-disable-next-line no-console
  console.info(
    `[GPT:${method}] Response`,
    JSON.stringify({
      requestId,
      durationMs: Date.now() - startTime,
      responseLength,
      responsePreview,
    })
  );
}

function logError(method: string, requestId: string, startTime: number, error: unknown): void {
  // eslint-disable-next-line no-console
  console.error(
    `[GPT:${method}] Error`,
    JSON.stringify({
      requestId,
      durationMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    })
  );
}

export function createGptClient(config: GptConfig): GptClient {
  const client = new OpenAI({ apiKey: config.apiKey });
  const modelName = config.model ?? DEFAULT_MODEL;

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GptError>> {
      const { requestId, startTime } = logRequest(
        'research',
        modelName,
        prompt.length,
        prompt.slice(0, 200)
      );

      try {
        const response = await client.chat.completions.create({
          model: modelName,
          max_tokens: MAX_TOKENS,
          messages: [
            {
              role: 'system',
              content:
                'You are a research analyst. Provide comprehensive, well-organized research on the given topic. Include relevant facts, analysis, and conclusions.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
        });

        const firstChoice = response.choices[0];
        const content = firstChoice?.message.content ?? '';

        logResponse('research', requestId, startTime, content.length, content.slice(0, 200));
        return ok({ content });
      } catch (error) {
        logError('research', requestId, startTime, error);
        return err(mapGptError(error));
      }
    },
  };
}

function mapGptError(error: unknown): GptError {
  if (error instanceof OpenAI.APIError) {
    const message = error.message;

    if (error.status === 401) {
      return { code: 'INVALID_KEY', message };
    }
    if (error.status === 429) {
      return { code: 'RATE_LIMITED', message };
    }
    if (error.code === 'context_length_exceeded') {
      return { code: 'CONTEXT_LENGTH', message };
    }
    if (message.includes('timeout')) {
      return { code: 'TIMEOUT', message };
    }

    return { code: 'API_ERROR', message };
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  return { code: 'API_ERROR', message };
}

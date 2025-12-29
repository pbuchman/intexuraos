import OpenAI from 'openai';
import { ok, err, type Result } from '@intexuraos/common-core';
import type { GptConfig, ResearchResult, GptError } from './types.js';

const DEFAULT_MODEL = 'gpt-4o';
const MAX_TOKENS = 8192;

export interface GptClient {
  research(prompt: string): Promise<Result<ResearchResult, GptError>>;
}

export function createGptClient(config: GptConfig): GptClient {
  const client = new OpenAI({ apiKey: config.apiKey });

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GptError>> {
      try {
        const response = await client.chat.completions.create({
          model: config.model ?? DEFAULT_MODEL,
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

        return ok({ content });
      } catch (error) {
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

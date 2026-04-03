import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { CreateEmbeddingResponse } from 'openai/resources';

export type EmbeddingFn = (text: string, model: string) => Promise<CreateEmbeddingResponse>;

export interface EmbeddingClientDeps {
  readonly embedFn: EmbeddingFn;
  readonly model?: string;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
}

type EmbeddingErrorCode = 'INVALID_INPUT' | 'API_ERROR' | 'RATE_LIMITED';

export class EmbeddingError extends Error {
  readonly code: EmbeddingErrorCode;

  constructor(code: EmbeddingErrorCode, message: string) {
    super(message);
    this.name = 'EmbeddingError';
    this.code = code;
  }
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

export class EmbeddingClient {
  private readonly embedFn: EmbeddingFn;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(deps: EmbeddingClientDeps) {
    this.embedFn = deps.embedFn;
    this.model = deps.model ?? 'text-embedding-3-small';
    this.maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  async embed(text: string): Promise<Result<number[], EmbeddingError>> {
    const trimmedText = text.trim();

    if (trimmedText.length === 0) {
      return err(new EmbeddingError('INVALID_INPUT', 'Text cannot be empty'));
    }

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.embedFn(trimmedText, this.model);
        const embedding = response.data[0]?.embedding;

        if (embedding === undefined) {
          return err(new EmbeddingError('API_ERROR', 'No embedding returned from API'));
        }

        return ok(embedding);
      } catch (error) {
        const message = getErrorMessage(error);
        const isRateLimit = message.includes('429') || message.toLowerCase().includes('rate');

        if (isRateLimit && attempt < this.maxRetries - 1) {
          await this.sleep(this.retryDelayMs * 2 ** attempt);
          continue;
        }

        if (isRateLimit) {
          return err(
            new EmbeddingError(
              'RATE_LIMITED',
              `Rate limit exceeded after ${String(this.maxRetries)} retries`
            )
          );
        }

        return err(new EmbeddingError('API_ERROR', `OpenAI API error: ${message}`));
      }
    }

    return err(
      new EmbeddingError('RATE_LIMITED', `Max retries (${String(this.maxRetries)}) exceeded`)
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

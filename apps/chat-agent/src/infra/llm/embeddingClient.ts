/**
 * OpenAI embedding client.
 * Generates text embeddings using OpenAI's text-embedding-3-small model.
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import OpenAI from 'openai';

/** Configuration for embedding client. */
export interface EmbeddingClientConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
}

/** Marker interface for dependency injection of OpenAI instance (for testing). */
export interface EmbeddingClientDeps {
  readonly openai: OpenAI;
  readonly model?: string;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
}

/** Error types for embedding operations. */
type EmbeddingErrorCode = 'INVALID_INPUT' | 'API_ERROR' | 'RATE_LIMITED';

/** Embedding error with code. */
class EmbeddingError extends Error {
  readonly code: EmbeddingErrorCode;

  constructor(code: EmbeddingErrorCode, message: string) {
    super(message);
    this.name = 'EmbeddingError';
    this.code = code;
  }
}

/** Default max retry attempts for rate limiting. */
const DEFAULT_MAX_RETRIES = 3;

/** Default retry delay in milliseconds. */
const DEFAULT_RETRY_DELAY_MS = 1000;

/**
 * OpenAI embedding client with retry logic for rate limiting.
 */
export class EmbeddingClient {
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(configOrDeps: EmbeddingClientConfig | EmbeddingClientDeps) {
    // Discriminated union: 'openai' key indicates deps object (config has 'apiKey')
    if ('openai' in configOrDeps) {
      // Dependency injection mode (for testing)
      this.openai = configOrDeps.openai;
      this.model = configOrDeps.model ?? 'text-embedding-3-small';
      this.maxRetries = configOrDeps.maxRetries ?? DEFAULT_MAX_RETRIES;
      this.retryDelayMs = configOrDeps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    } else {
      // Config mode (production)
      this.openai = new OpenAI({ apiKey: configOrDeps.apiKey });
      this.model = configOrDeps.model ?? 'text-embedding-3-small';
      this.maxRetries = configOrDeps.maxRetries ?? DEFAULT_MAX_RETRIES;
      this.retryDelayMs = configOrDeps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    }
  }

  /**
   * Generate embedding for the given text.
   * Retries with exponential backoff on rate limit errors.
   */
  async embed(text: string): Promise<Result<number[], EmbeddingError>> {
    const trimmedText = text.trim();

    if (trimmedText.length === 0) {
      return err(new EmbeddingError('INVALID_INPUT', 'Text cannot be empty'));
    }

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.openai.embeddings.create({
          model: this.model,
          input: trimmedText,
        });

        const embedding = response.data[0]?.embedding;

        if (!embedding) {
          return err(new EmbeddingError('API_ERROR', 'No embedding returned from API'));
        }

        return ok(embedding);
      } catch (error) {
        const message = getErrorMessage(error);

        // Check if this is a rate limit error that we should retry
        const isRateLimit = message.includes('429') || message.toLowerCase().includes('rate');

        if (isRateLimit && attempt < this.maxRetries - 1) {
          // Exponential backoff: 1000ms, 2000ms, 4000ms...
          const delay = this.retryDelayMs * Math.pow(2, attempt);
          await this.sleep(delay);
          continue;
        }

        // Return error for non-retryable errors or after max retries
        if (isRateLimit) {
          return err(new EmbeddingError('RATE_LIMITED', `Rate limit exceeded after ${String(this.maxRetries)} retries`));
        }

        return err(new EmbeddingError('API_ERROR', `OpenAI API error: ${message}`));
      }
    }

    return err(new EmbeddingError('RATE_LIMITED', `Max retries (${String(this.maxRetries)}) exceeded`));
  }

  /**
   * Sleep for the specified milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

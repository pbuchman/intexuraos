import { getErrorCauseChain, type Logger } from '@intexuraos/common-core';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const REQUEST_TIMEOUT_MS = 10_000;

export interface ApiKeyValidationResult {
  valid: boolean;
  errorMessage?: string;
}

interface CacheEntry {
  result: ApiKeyValidationResult;
  expiresAt: number;
}

export class ApiKeyValidator {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<ApiKeyValidationResult>>();

  constructor(
    private readonly secrets: { ANTHROPIC_API_KEY: string },
    private readonly logger: Logger
  ) {}

  async validate(keyType: 'anthropic'): Promise<ApiKeyValidationResult> {
    const cached = this.cache.get(keyType);
    if (cached !== undefined && Date.now() < cached.expiresAt) {
      return cached.result;
    }

    const existing = this.inFlight.get(keyType);
    if (existing !== undefined) {
      return await existing;
    }

    const promise = this.doValidate(keyType);
    this.inFlight.set(keyType, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(keyType);
    }
  }

  private async doValidate(keyType: 'anthropic'): Promise<ApiKeyValidationResult> {
    const key = this.secrets.ANTHROPIC_API_KEY;

    if (key === '') {
      const result: ApiKeyValidationResult = {
        valid: false,
        errorMessage: `${keyType} API key is empty`,
      };
      this.setCache(keyType, result);
      return result;
    }

    try {
      const resp = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (resp.ok) {
        const result: ApiKeyValidationResult = { valid: true };
        this.setCache(keyType, result);
        return result;
      }

      if (resp.status === 429) {
        this.logger.warn({ status: 429 }, 'API key validation got rate-limited, treating as valid');
        const result: ApiKeyValidationResult = { valid: true };
        this.setCache(keyType, result);
        return result;
      }

      const statusText = resp.statusText !== '' ? resp.statusText : 'Unauthorized';
      const result: ApiKeyValidationResult = {
        valid: false,
        errorMessage: `HTTP ${String(resp.status)} ${statusText}`,
      };
      this.setCache(keyType, result);
      return result;
    } catch (error) {
      const cause = error instanceof Error ? getErrorCauseChain(error) : undefined;
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          ...(cause !== undefined && { cause }),
        },
        'API key validation request failed (network issue), treating as valid'
      );
      return { valid: true };
    }
  }

  private setCache(keyType: string, result: ApiKeyValidationResult): void {
    this.cache.set(keyType, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  }
}

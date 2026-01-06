/**
 * HTTP client for fetching pricing from app-settings-service.
 * Implements caching with 5-minute TTL.
 */

import type { LlmProvider, ModelPricing, ProviderPricing } from '@intexuraos/llm-contract';

interface CacheEntry {
  data: ProviderPricing;
  expiresAt: number;
}

export interface PricingClientConfig {
  baseUrl: string;
  internalAuthToken: string;
}

export class PricingClient {
  private readonly baseUrl: string;
  private readonly internalAuthToken: string;
  private readonly cache = new Map<LlmProvider, CacheEntry>();
  private readonly ttlMs = 5 * 60 * 1000; // 5 minutes

  constructor(config: PricingClientConfig) {
    this.baseUrl = config.baseUrl;
    this.internalAuthToken = config.internalAuthToken;
  }

  /**
   * Get pricing for a provider with caching.
   */
  async getForProvider(provider: LlmProvider): Promise<ProviderPricing | null> {
    const cached = this.cache.get(provider);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    try {
      const response = await fetch(`${this.baseUrl}/internal/settings/pricing/${provider}`, {
        method: 'GET',
        headers: {
          'X-Internal-Auth': this.internalAuthToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        // Non-404 error: return cached data if available (even if expired), otherwise null
        return cached?.data ?? null;
      }

      const data = (await response.json()) as ProviderPricing;
      this.cache.set(provider, {
        data,
        expiresAt: Date.now() + this.ttlMs,
      });

      return data;
    } catch {
      // Network error: return cached data if available (even if expired), otherwise null
      return cached?.data ?? null;
    }
  }

  /**
   * Get pricing for a specific model.
   */
  async getModelPricing(provider: LlmProvider, model: string): Promise<ModelPricing | null> {
    const providerPricing = await this.getForProvider(provider);
    if (providerPricing === null) {
      return null;
    }
    return providerPricing.models[model] ?? null;
  }

  /**
   * Clear the cache (for testing).
   */
  clearCache(): void {
    this.cache.clear();
  }
}

export function createPricingClient(config: PricingClientConfig): PricingClient {
  return new PricingClient(config);
}

import { getFirestore } from '@intexuraos/infra-firestore';
import { LlmProviders, type LlmProvider, type ProviderPricing } from '@intexuraos/llm-contract';
import type { PricingRepository } from '../../domain/repositories/pricingRepository.js';

const COLLECTION = 'llm_pricing';

interface ProviderPricingDoc {
  provider: LlmProvider;
  models: ProviderPricing['models'];
  updatedAt: string;
}

export class FirestorePricingRepository implements PricingRepository {
  async getByProvider(provider: LlmProvider): Promise<ProviderPricing | null> {
    const db = getFirestore();
    const snap = await db.collection(COLLECTION).doc(provider).get();
    if (!snap.exists) return null;
    const data = snap.data() as ProviderPricingDoc;
    return { provider: data.provider, models: data.models, updatedAt: data.updatedAt };
  }

  async getAll(): Promise<Record<LlmProvider, ProviderPricing>> {
    const providers = [
      LlmProviders.Google,
      LlmProviders.OpenAI,
      LlmProviders.Anthropic,
      LlmProviders.Perplexity,
      LlmProviders.OpenRouter,
    ] as const;
    const results = await Promise.all(providers.map((p) => this.getByProvider(p)));
    const out: Partial<Record<LlmProvider, ProviderPricing>> = {};
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      const pricing = results[i];
      if (provider === undefined || pricing === null || pricing === undefined) {
        throw new Error(`Missing pricing for provider: ${String(provider)}`);
      }
      out[provider] = pricing;
    }
    return out as Record<LlmProvider, ProviderPricing>;
  }

  async setByProvider(provider: LlmProvider, pricing: ProviderPricing): Promise<void> {
    const db = getFirestore();
    await db.collection(COLLECTION).doc(provider).set({
      provider: pricing.provider,
      models: pricing.models,
      updatedAt: pricing.updatedAt,
    });
  }
}

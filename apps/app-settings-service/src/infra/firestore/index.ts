/**
 * Firestore implementation of PricingRepository.
 * Reads from settings/llm_pricing/providers/{provider} collection.
 */
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  LlmProvider,
  ModelPricing,
  ProviderPricing,
  PricingRepository,
} from '../../domain/ports/index.js';

interface ProviderPricingDoc {
  provider: LlmProvider;
  models: Record<string, ModelPricing>;
  updatedAt: string;
}

export class FirestorePricingRepository implements PricingRepository {
  // Path structure: settings/llm_pricing/providers/{provider}
  // (collection/document/collection/document - must have even number of components)
  private readonly collectionPath = 'settings/llm_pricing/providers';

  async getByProvider(provider: LlmProvider): Promise<ProviderPricing | null> {
    const db = getFirestore();
    const docRef = db.doc(`${this.collectionPath}/${provider}`);
    const doc = await docRef.get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data() as ProviderPricingDoc;
    return {
      provider: data.provider,
      models: data.models,
      updatedAt: data.updatedAt,
    };
  }
}

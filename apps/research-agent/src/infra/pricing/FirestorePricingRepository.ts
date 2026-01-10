import { getFirestore } from '@intexuraos/infra-firestore';
import type { LlmPricing, LlmProvider, PricingRepository } from '../../domain/research/index.js';

interface LlmPricingDoc {
  models: Record<
    string,
    {
      provider: LlmProvider;
      model: string;
      inputPricePerMillion: number;
      outputPricePerMillion: number;
    }
  >;
  updatedAt: string;
}

export class FirestorePricingRepository implements PricingRepository {
  private readonly collectionName = 'app_settings';
  private readonly docId = 'llm_pricing';

  async findByProviderAndModel(provider: LlmProvider, model: string): Promise<LlmPricing | null> {
    const db = getFirestore();
    const doc = await db.collection(this.collectionName).doc(this.docId).get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data() as LlmPricingDoc;
    const key = `${provider}_${model}`;
    const modelPricing = data.models[key];

    if (modelPricing === undefined) {
      return null;
    }

    return {
      provider: modelPricing.provider,
      model: modelPricing.model,
      inputPricePerMillion: modelPricing.inputPricePerMillion,
      outputPricePerMillion: modelPricing.outputPricePerMillion,
      updatedAt: data.updatedAt,
    };
  }
}

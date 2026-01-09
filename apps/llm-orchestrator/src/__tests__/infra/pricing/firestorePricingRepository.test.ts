/**
 * Tests for FirestorePricingRepository.
 */

import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDocGet = vi.fn();

const mockDoc = vi.fn().mockReturnValue({
  get: mockDocGet,
});

const mockCollection = vi.fn().mockReturnValue({
  doc: mockDoc,
});

const mockGetFirestore = vi.fn().mockReturnValue({
  collection: mockCollection,
});

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: mockGetFirestore,
}));

const { FirestorePricingRepository } =
  await import('../../../infra/pricing/FirestorePricingRepository.js');

describe('FirestorePricingRepository', () => {
  let repository: InstanceType<typeof FirestorePricingRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new FirestorePricingRepository();
  });

  describe('findByProviderAndModel', () => {
    it('returns null when document does not exist', async () => {
      mockDocGet.mockResolvedValueOnce({ exists: false });

      const result = await repository.findByProviderAndModel(
        LlmProviders.Google,
        LlmModels.Gemini20Flash
      );

      expect(result).toBeNull();
      expect(mockCollection).toHaveBeenCalledWith('app_settings');
      expect(mockDoc).toHaveBeenCalledWith('llm_pricing');
    });

    it('returns null when model pricing not found', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          models: {
            openai_gpt4: {
              provider: LlmProviders.OpenAI,
              model: 'gpt4',
              inputPricePerMillion: 30,
              outputPricePerMillion: 60,
            },
          },
          updatedAt: '2024-01-01T00:00:00Z',
        }),
      });

      const result = await repository.findByProviderAndModel(
        LlmProviders.Google,
        LlmModels.Gemini20Flash
      );

      expect(result).toBeNull();
    });

    it('returns pricing when model is found', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          models: {
            google_gemini: {
              provider: LlmProviders.Google,
              model: 'gemini',
              inputPricePerMillion: 0.075,
              outputPricePerMillion: 0.3,
            },
          },
          updatedAt: '2024-01-01T00:00:00Z',
        }),
      });

      const result = await repository.findByProviderAndModel(LlmProviders.Google, 'gemini');

      expect(result).toEqual({
        provider: LlmProviders.Google,
        model: 'gemini',
        inputPricePerMillion: 0.075,
        outputPricePerMillion: 0.3,
        updatedAt: '2024-01-01T00:00:00Z',
      });
    });
  });
});

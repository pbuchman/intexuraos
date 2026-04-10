import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmProviders } from '@intexuraos/llm-contract';
import type { LlmProvider, ProviderPricing } from '@intexuraos/llm-contract';
import { FirestorePricingRepository } from '../../../infra/firestore/firestorePricingRepository.js';

// Mock getFirestore
const mockSet = vi.fn();
const mockGet = vi.fn();
const mockDoc = vi.fn().mockReturnValue({ get: mockGet, set: mockSet });
const mockCollection = vi.fn().mockReturnValue({ doc: mockDoc });

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: (): { collection: typeof mockCollection } => ({ collection: mockCollection }),
}));

function createTestPricing(provider: LlmProvider): ProviderPricing {
  return {
    provider,
    models: {
      'test-model': {
        inputPricePerMillion: 1.0,
        outputPricePerMillion: 2.0,
      },
    },
    updatedAt: '2026-04-10T00:00:00Z',
  };
}

describe('FirestorePricingRepository', () => {
  let repo: FirestorePricingRepository;

  beforeEach(() => {
    repo = new FirestorePricingRepository();
    vi.clearAllMocks();
    mockDoc.mockReturnValue({ get: mockGet, set: mockSet });
    mockCollection.mockReturnValue({ doc: mockDoc });
  });

  describe('getByProvider', () => {
    it('returns null when document does not exist', async () => {
      mockGet.mockResolvedValue({ exists: false });

      const result = await repo.getByProvider(LlmProviders.Anthropic);

      expect(result).toBeNull();
      expect(mockCollection).toHaveBeenCalledWith('llm_pricing');
      expect(mockDoc).toHaveBeenCalledWith(LlmProviders.Anthropic);
    });

    it('returns ProviderPricing when document exists', async () => {
      const pricing = createTestPricing(LlmProviders.Anthropic);
      mockGet.mockResolvedValue({
        exists: true,
        data: (): ProviderPricing => pricing,
      });

      const result = await repo.getByProvider(LlmProviders.Anthropic);

      expect(result).toEqual({
        provider: LlmProviders.Anthropic,
        models: pricing.models,
        updatedAt: '2026-04-10T00:00:00Z',
      });
    });
  });

  describe('getAll', () => {
    it('returns record of all 5 providers when all exist', async () => {
      const providers = [
        LlmProviders.Google,
        LlmProviders.OpenAI,
        LlmProviders.Anthropic,
        LlmProviders.Perplexity,
        LlmProviders.OpenRouter,
      ] as const;

      // Each call to getByProvider calls doc().get(), so we need to mock
      // get() for each call in sequence
      for (const provider of providers) {
        const pricing = createTestPricing(provider);
        mockGet.mockResolvedValueOnce({
          exists: true,
          data: (): ProviderPricing => pricing,
        });
      }

      const result = await repo.getAll();

      expect(Object.keys(result)).toHaveLength(5);
      expect(result[LlmProviders.Google]?.provider).toBe(LlmProviders.Google);
      expect(result[LlmProviders.OpenAI]?.provider).toBe(LlmProviders.OpenAI);
      expect(result[LlmProviders.Anthropic]?.provider).toBe(LlmProviders.Anthropic);
      expect(result[LlmProviders.Perplexity]?.provider).toBe(LlmProviders.Perplexity);
      expect(result[LlmProviders.OpenRouter]?.provider).toBe(LlmProviders.OpenRouter);
    });

    it('throws when a provider is missing', async () => {
      // First 4 exist, the 5th does not
      const firstFourProviders = [
        LlmProviders.Google,
        LlmProviders.OpenAI,
        LlmProviders.Anthropic,
        LlmProviders.Perplexity,
      ] as const;
      for (const provider of firstFourProviders) {
        const pricing = createTestPricing(provider);
        mockGet.mockResolvedValueOnce({
          exists: true,
          data: (): ProviderPricing => pricing,
        });
      }
      // OpenRouter returns not found
      mockGet.mockResolvedValueOnce({ exists: false });

      await expect(repo.getAll()).rejects.toThrow(`Missing pricing for provider: ${LlmProviders.OpenRouter}`);
    });
  });

  describe('setByProvider', () => {
    it('writes pricing document with correct data', async () => {
      mockSet.mockResolvedValue(undefined);
      const pricing = createTestPricing(LlmProviders.Anthropic);

      await repo.setByProvider(LlmProviders.Anthropic, pricing);

      expect(mockCollection).toHaveBeenCalledWith('llm_pricing');
      expect(mockDoc).toHaveBeenCalledWith(LlmProviders.Anthropic);
      expect(mockSet).toHaveBeenCalledWith({
        provider: LlmProviders.Anthropic,
        models: pricing.models,
        updatedAt: '2026-04-10T00:00:00Z',
      });
    });
  });
});

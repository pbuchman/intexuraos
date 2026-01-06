import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock getFirestore
const mockGet = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockGet }));
vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: (): { doc: typeof mockDoc } => ({ doc: mockDoc }),
}));

describe('FirestorePricingRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns pricing for existing provider', async () => {
    const mockData = {
      provider: 'google',
      models: {
        'gemini-2.5-pro': {
          inputPricePerMillion: 1.25,
          outputPricePerMillion: 10.0,
        },
      },
      updatedAt: '2026-01-05T12:00:00Z',
    };

    mockGet.mockResolvedValue({
      exists: true,
      data: () => mockData,
    });

    const { FirestorePricingRepository } = await import('../../infra/firestore/index.js');
    const repo = new FirestorePricingRepository();
    const result = await repo.getByProvider('google');

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('google');
    const geminiPricing = result?.models['gemini-2.5-pro'];
    expect(geminiPricing?.inputPricePerMillion).toBe(1.25);
    expect(mockDoc).toHaveBeenCalledWith('settings/llm_pricing/google');
  });

  it('returns null for non-existing provider', async () => {
    mockGet.mockResolvedValue({
      exists: false,
    });

    const { FirestorePricingRepository } = await import('../../infra/firestore/index.js');
    const repo = new FirestorePricingRepository();
    const result = await repo.getByProvider('perplexity');

    expect(result).toBeNull();
  });
});

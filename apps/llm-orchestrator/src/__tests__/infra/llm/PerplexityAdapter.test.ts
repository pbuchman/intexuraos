import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelPricing } from '@intexuraos/llm-contract';

const mockResearch = vi.fn();

const mockCreatePerplexityClient = vi.fn().mockReturnValue({
  research: mockResearch,
});

vi.mock('@intexuraos/infra-perplexity', () => ({
  createPerplexityClient: mockCreatePerplexityClient,
}));

const { PerplexityAdapter } = await import('../../../infra/llm/PerplexityAdapter.js');

const testPricing: ModelPricing = {
  inputPricePerMillion: 3.0,
  outputPricePerMillion: 15.0,
  useProviderCost: true,
};

describe('PerplexityAdapter', () => {
  let adapter: InstanceType<typeof PerplexityAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new PerplexityAdapter('test-key', LlmModels.SonarPro, 'test-user-id', testPricing);
  });

  describe('constructor', () => {
    it('passes apiKey and model to client', () => {
      mockCreatePerplexityClient.mockClear();
      new PerplexityAdapter('test-key', LlmModels.SonarPro, 'test-user-id', testPricing);

      expect(mockCreatePerplexityClient).toHaveBeenCalledWith({
        apiKey: 'test-key',
        model: LlmModels.SonarPro,
        userId: 'test-user-id',
        pricing: testPricing,
      });
    });
  });

  describe('research', () => {
    it('delegates to Perplexity client', async () => {
      mockResearch.mockResolvedValue({
        ok: true,
        value: { content: 'Research result', sources: ['https://source.com'] },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Research result');
        expect(result.value.sources).toContain('https://source.com');
      }
      expect(mockResearch).toHaveBeenCalledWith('Test prompt');
    });

    it('maps RATE_LIMITED error code correctly', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
        expect(result.error.message).toBe('Too many requests');
      }
    });

    it('maps INVALID_KEY error code correctly', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'INVALID_KEY', message: 'Invalid API key' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('maps TIMEOUT error code correctly', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'TIMEOUT', message: 'Request timed out' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('maps API_ERROR error code correctly', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'API_ERROR', message: 'API error' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('maps unknown error codes to API_ERROR', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'UNKNOWN_CODE', message: 'Unknown error' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('Unknown error');
      }
    });
  });
});

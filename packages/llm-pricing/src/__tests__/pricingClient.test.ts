import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { type ProviderPricing, type Gemini25Pro } from '@intexuraos/llm-contract';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import {
  PricingContext,
  createPricingContext,
  fetchAllPricing,
  fetchAllPricingWithRetry,
  type AllPricingResponse,
} from '../pricingClient.js';

describe('pricingClient', () => {
  const mockGooglePricing: ProviderPricing = {
    provider: LlmProviders.Google,
    models: {
      [LlmModels.Gemini25Pro]: {
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 10.0,
        groundingCostPerRequest: 0.035,
      },
      [LlmModels.Gemini25Flash]: {
        inputPricePerMillion: 0.3,
        outputPricePerMillion: 2.5,
        groundingCostPerRequest: 0.035,
      },
      [LlmModels.Gemini20Flash]: {
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.4,
        groundingCostPerRequest: 0.035,
      },
      [LlmModels.Gemini25FlashImage]: {
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        imagePricing: { '1024x1024': 0.03 },
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const mockOpenaiPricing: ProviderPricing = {
    provider: LlmProviders.OpenAI,
    models: {
      [LlmModels.O4MiniDeepResearch]: {
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 8.0,
        cacheReadMultiplier: 0.25,
        webSearchCostPerCall: 0.01,
      },
      [LlmModels.GPT52]: {
        inputPricePerMillion: 1.75,
        outputPricePerMillion: 14.0,
        cacheReadMultiplier: 0.1,
      },
      [LlmModels.GPT54]: {
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 15.0,
        cacheReadMultiplier: 0.1,
        webSearchCostPerCall: 0.01,
      },
      [LlmModels.GPT4oMini]: {
        inputPricePerMillion: 0.15,
        outputPricePerMillion: 0.6,
        cacheReadMultiplier: 0.5,
      },
      [LlmModels.GPTImage1]: {
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        imagePricing: { '1024x1024': 0.04 },
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const mockAnthropicPricing: ProviderPricing = {
    provider: LlmProviders.Anthropic,
    models: {
      [LlmModels.ClaudeOpus45]: {
        inputPricePerMillion: 5.0,
        outputPricePerMillion: 25.0,
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
        webSearchCostPerCall: 0.01,
      },
      [LlmModels.ClaudeOpus46]: {
        inputPricePerMillion: 5.0,
        outputPricePerMillion: 25.0,
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
        webSearchCostPerCall: 0.01,
      },
      [LlmModels.ClaudeSonnet45]: {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
        webSearchCostPerCall: 0.01,
      },
      [LlmModels.ClaudeSonnet46]: {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
        webSearchCostPerCall: 0.01,
      },
      [LlmModels.ClaudeHaiku35]: {
        inputPricePerMillion: 0.8,
        outputPricePerMillion: 4.0,
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const mockPerplexityPricing: ProviderPricing = {
    provider: LlmProviders.Perplexity,
    models: {
      [LlmModels.Sonar]: {
        inputPricePerMillion: 1.0,
        outputPricePerMillion: 1.0,
        useProviderCost: true,
      },
      [LlmModels.SonarPro]: {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
        useProviderCost: true,
      },
      [LlmModels.SonarDeepResearch]: {
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 8.0,
        useProviderCost: true,
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const mockOpenrouterPricing: ProviderPricing = {
    provider: LlmProviders.OpenRouter,
    models: {},
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const completeAllPricing: AllPricingResponse = {
    google: mockGooglePricing,
    openai: mockOpenaiPricing,
    anthropic: mockAnthropicPricing,
    perplexity: mockPerplexityPricing,
    openrouter: mockOpenrouterPricing,
  };

  describe('fetchAllPricing', () => {
    const mockBaseUrl = 'http://localhost:3000';
    const mockAuthToken = 'test-auth-token';

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns pricing data on successful response', async () => {
      const mockResponse = {
        success: true,
        data: completeAllPricing,
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchAllPricing(mockBaseUrl, mockAuthToken);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.google).toEqual(completeAllPricing.google);
        expect(result.value.openai).toEqual(completeAllPricing.openai);
      }

      expect(fetch).toHaveBeenCalledWith(`${mockBaseUrl}/internal/pricing`, {
        headers: { 'X-Internal-Auth': mockAuthToken },
      });
    });

    it('returns API_ERROR when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response);

      const result = await fetchAllPricing(mockBaseUrl, mockAuthToken);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('HTTP 500');
        expect(result.error.message).toContain('Internal Server Error');
        expect(result.error.statusCode).toBe(500);
      }
    });

    it('returns API_ERROR when response body read fails', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => {
          throw new Error('Body read failed');
        },
      } as unknown as Response);

      const result = await fetchAllPricing(mockBaseUrl, mockAuthToken);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 404');
        expect(result.error.statusCode).toBe(404);
      }
    });

    it('returns API_ERROR when success is false', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ success: false }),
      } as Response);

      const result = await fetchAllPricing(mockBaseUrl, mockAuthToken);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('Response success is false');
        expect(result.error.statusCode).toBeUndefined();
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const result = await fetchAllPricing(mockBaseUrl, mockAuthToken);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toBe('Network error');
      }
    });

    it('returns API_ERROR with empty body when response text is empty', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => '',
      } as Response);

      const result = await fetchAllPricing(mockBaseUrl, mockAuthToken);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 503');
        expect(result.error.statusCode).toBe(503);
      }
    });
  });

  describe('PricingContext', () => {
    it('stores pricing from all providers', () => {
      const context = new PricingContext(completeAllPricing);

      expect(context.hasPricing(LlmModels.Gemini25Pro)).toBe(true);
      expect(context.hasPricing(LlmModels.GPT54)).toBe(true);
      expect(context.hasPricing(LlmModels.ClaudeOpus46)).toBe(true);
      expect(context.hasPricing(LlmModels.SonarPro)).toBe(true);
    });

    it('returns correct pricing for a model', () => {
      const context = new PricingContext(completeAllPricing);

      const pricing = context.getPricing(LlmModels.Gemini25Pro);
      expect(pricing.inputPricePerMillion).toBe(1.25);
      expect(pricing.outputPricePerMillion).toBe(10.0);
      expect(pricing.groundingCostPerRequest).toBe(0.035);
    });

    it('throws when getting pricing for unknown model', () => {
      const context = new PricingContext(completeAllPricing);

      expect(() => context.getPricing('unknown-model' as Gemini25Pro)).toThrow('Pricing not found');
    });

    it('validates that specified models have pricing', () => {
      const context = new PricingContext(completeAllPricing);

      expect(() => context.validateModels([LlmModels.Gemini25Pro, LlmModels.GPT54])).not.toThrow();
    });

    it('throws when validating models with missing pricing', () => {
      const incompletePricing: AllPricingResponse = {
        google: mockGooglePricing,
        openai: { provider: LlmProviders.OpenAI, models: {}, updatedAt: '' },
        anthropic: mockAnthropicPricing,
        perplexity: mockPerplexityPricing,
        openrouter: mockOpenrouterPricing,
      };
      const context = new PricingContext(incompletePricing);

      expect(() => context.validateModels([LlmModels.Gemini25Pro, LlmModels.GPT54])).toThrow(
        'Missing pricing for models: gpt-5.4'
      );
    });

    it('returns all models with pricing', () => {
      const context = new PricingContext(completeAllPricing);

      const models = context.getModelsWithPricing();
      expect(models).toHaveLength(17);
      expect(models).toContain(LlmModels.Gemini25Pro);
      expect(models).toContain(LlmModels.GPT54);
    });

    it('ignores invalid model keys in pricing data', () => {
      const pricingWithInvalidModel: AllPricingResponse = {
        google: {
          provider: LlmProviders.Google,
          models: {
            [LlmModels.Gemini25Flash]: {
              inputPricePerMillion: 0.3,
              outputPricePerMillion: 2.5,
            },
            'invalid-model-name': {
              inputPricePerMillion: 1.0,
              outputPricePerMillion: 2.0,
            },
          } as typeof mockGooglePricing.models,
          updatedAt: '',
        },
        openai: { provider: LlmProviders.OpenAI, models: {}, updatedAt: '' },
        anthropic: { provider: LlmProviders.Anthropic, models: {}, updatedAt: '' },
        perplexity: { provider: LlmProviders.Perplexity, models: {}, updatedAt: '' },
        openrouter: { provider: LlmProviders.OpenRouter, models: {}, updatedAt: '' },
      };

      const context = new PricingContext(pricingWithInvalidModel);
      expect(context.hasPricing(LlmModels.Gemini25Flash)).toBe(true);
      expect(context.getModelsWithPricing()).toEqual([LlmModels.Gemini25Flash]);
    });

    it('validateAllModels passes when all models have pricing', () => {
      const context = new PricingContext(completeAllPricing);

      expect(() => context.validateAllModels()).not.toThrow();
    });

    it('validateAllModels throws when models are missing', () => {
      const incompletePricing: AllPricingResponse = {
        google: mockGooglePricing,
        openai: { provider: LlmProviders.OpenAI, models: {}, updatedAt: '' },
        anthropic: mockAnthropicPricing,
        perplexity: mockPerplexityPricing,
        openrouter: mockOpenrouterPricing,
      };
      const context = new PricingContext(incompletePricing);

      expect(() => context.validateAllModels()).toThrow('Missing pricing for models');
    });
  });

  describe('createPricingContext', () => {
    it('creates context and validates all models by default', () => {
      expect(() => createPricingContext(completeAllPricing)).not.toThrow();
    });

    it('throws if any model is missing pricing', () => {
      const incompletePricing: AllPricingResponse = {
        google: { provider: LlmProviders.Google, models: {}, updatedAt: '' },
        openai: mockOpenaiPricing,
        anthropic: mockAnthropicPricing,
        perplexity: mockPerplexityPricing,
        openrouter: mockOpenrouterPricing,
      };

      expect(() => createPricingContext(incompletePricing)).toThrow('Missing pricing for models');
    });

    it('validates only specified models when provided', () => {
      const geminiFlashPricing = mockGooglePricing.models[LlmModels.Gemini25Flash];
      if (geminiFlashPricing === undefined) {
        throw new Error('Test setup error: gemini-2.5-flash pricing missing');
      }
      const partialPricing: AllPricingResponse = {
        google: {
          provider: LlmProviders.Google,
          models: {
            [LlmModels.Gemini25Flash]: geminiFlashPricing,
          },
          updatedAt: '',
        },
        openai: { provider: LlmProviders.OpenAI, models: {}, updatedAt: '' },
        anthropic: { provider: LlmProviders.Anthropic, models: {}, updatedAt: '' },
        perplexity: { provider: LlmProviders.Perplexity, models: {}, updatedAt: '' },
        openrouter: { provider: LlmProviders.OpenRouter, models: {}, updatedAt: '' },
      };

      // Should not throw when only validating gemini-2.5-flash
      expect(() => createPricingContext(partialPricing, [LlmModels.Gemini25Flash])).not.toThrow();
    });
  });

  describe('fetchAllPricingWithRetry', () => {
    const mockBaseUrl = 'http://localhost:3000';
    const mockAuthToken = 'test-auth-token';
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const noopLog = (): void => {};
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const instantDelay = async (): Promise<void> => {};

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns pricing on first successful attempt without retrying', async () => {
      const mockResponse = { success: true, data: completeAllPricing };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchAllPricingWithRetry(mockBaseUrl, mockAuthToken, {
        maxRetries: 3,
        log: noopLog,
        delayFn: instantDelay,
      });

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('retries on transient HTTP 404 and succeeds', async () => {
      const mockResponse = { success: true, data: completeAllPricing };

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => 'Route not found',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const result = await fetchAllPricingWithRetry(mockBaseUrl, mockAuthToken, {
        maxRetries: 3,
        log: noopLog,
        delayFn: instantDelay,
      });

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('retries on transient HTTP 500 and succeeds', async () => {
      const mockResponse = { success: true, data: completeAllPricing };

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const result = await fetchAllPricingWithRetry(mockBaseUrl, mockAuthToken, {
        maxRetries: 5,
        log: noopLog,
        delayFn: instantDelay,
      });

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('retries on network errors and succeeds', async () => {
      const mockResponse = { success: true, data: completeAllPricing };

      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const result = await fetchAllPricingWithRetry(mockBaseUrl, mockAuthToken, {
        maxRetries: 3,
        log: noopLog,
        delayFn: instantDelay,
      });

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry on HTTP 401 (non-transient)', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      } as Response);

      const result = await fetchAllPricingWithRetry(mockBaseUrl, mockAuthToken, {
        maxRetries: 3,
        log: noopLog,
        delayFn: instantDelay,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('HTTP 401');
      }
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on HTTP 403 (non-transient)', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      } as Response);

      const result = await fetchAllPricingWithRetry(mockBaseUrl, mockAuthToken, {
        maxRetries: 3,
        log: noopLog,
        delayFn: instantDelay,
      });

      expect(result.ok).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('returns last error after exhausting all retries', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => 'Bad Gateway',
      } as Response);

      const result = await fetchAllPricingWithRetry(mockBaseUrl, mockAuthToken, {
        maxRetries: 2,
        log: noopLog,
        delayFn: instantDelay,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('HTTP 502');
      }
      // 1 initial + 2 retries = 3 total
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('uses exponential backoff delays', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Error',
      } as Response);

      const delays: number[] = [];
      const trackingDelay = async (ms: number): Promise<void> => {
        delays.push(ms);
      };

      await fetchAllPricingWithRetry(mockBaseUrl, mockAuthToken, {
        maxRetries: 4,
        initialDelayMs: 100,
        maxDelayMs: 500,
        log: noopLog,
        delayFn: trackingDelay,
      });

      // 100, 200, 400, 500 (capped at maxDelayMs)
      expect(delays).toEqual([100, 200, 400, 500]);
    });

    it('logs retry progress messages', async () => {
      const mockResponse = { success: true, data: completeAllPricing };

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const logMessages: string[] = [];
      const trackingLog = (msg: string): void => {
        logMessages.push(msg);
      };

      await fetchAllPricingWithRetry(mockBaseUrl, mockAuthToken, {
        maxRetries: 3,
        initialDelayMs: 1000,
        log: trackingLog,
        delayFn: instantDelay,
      });

      expect(logMessages).toHaveLength(1);
      expect(logMessages[0]).toContain('attempt 1/4');
      expect(logMessages[0]).toContain('HTTP 503');
      expect(logMessages[0]).toContain('1000ms');
    });

    it('works with default options (no options provided)', async () => {
      const mockResponse = { success: true, data: completeAllPricing };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchAllPricingWithRetry(mockBaseUrl, mockAuthToken);

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('handles maxRetries of 0 (no retries, single attempt)', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Error',
      } as Response);

      const result = await fetchAllPricingWithRetry(mockBaseUrl, mockAuthToken, {
        maxRetries: 0,
        log: noopLog,
        delayFn: instantDelay,
      });

      expect(result.ok).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on API_ERROR with no HTTP status code (non-transient)', async () => {
      // success:false produces API_ERROR without statusCode — not transient
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ success: false }),
      } as Response);

      const result = await fetchAllPricingWithRetry(mockBaseUrl, mockAuthToken, {
        maxRetries: 3,
        log: noopLog,
        delayFn: instantDelay,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('Response success is false');
        expect(result.error.statusCode).toBeUndefined();
      }
      // API_ERROR without statusCode is not transient — no retry
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('uses default log (stderr) when no log option provided', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          text: async () => 'Bad Gateway',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, data: completeAllPricing }),
        } as Response);

      const result = await fetchAllPricingWithRetry(mockBaseUrl, mockAuthToken, {
        maxRetries: 3,
        delayFn: instantDelay,
        // No log option — uses default stderr
      });

      expect(result.ok).toBe(true);
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('attempt 1/4'));
      stderrSpy.mockRestore();
    });
  });
});

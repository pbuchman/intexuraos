import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createUserServiceClient } from '../../../infra/user/userServiceClient.js';
import { FakePricingContext } from '@intexuraos/llm-pricing';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';

// Mock fetch at module level
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('UserServiceClient', () => {
  let mockPricingContext: FakePricingContext;
  const baseUrl = 'http://localhost:8110';
  const internalAuthToken = 'test-token';
  const testUserId = 'user-123';

  beforeEach(() => {
    mockPricingContext = new FakePricingContext();
    mockFetch.mockClear();
  });

  describe('success path', () => {
    it('fetches user settings and API key, creates LLM client', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            llmPreferences: { defaultModel: LlmModels.Gemini25Flash },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            [LlmProviders.Google]: 'test-google-api-key',
            [LlmProviders.OpenAI]: null,
          }),
        });

      const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
      const result = await client.getLlmClient(testUserId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Verify we got a client with generate method
        expect(typeof result.value.generate).toBe('function');
      }
    });

    it('uses X-Internal-Auth header for settings request', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            llmPreferences: { defaultModel: LlmModels.Gemini25Flash },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            [LlmProviders.Google]: 'test-api-key',
          }),
        });

      const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
      await client.getLlmClient(testUserId);

      // Implementation makes 2 calls: settings + keys
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const headers = mockFetch.mock.calls[0]?.[1]?.headers;
      expect(headers).toHaveProperty('X-Internal-Auth', internalAuthToken);
    });

    it('uses X-Internal-Auth header for API keys request', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            llmPreferences: { defaultModel: LlmModels.Gemini25Flash },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            [LlmProviders.Google]: 'test-api-key',
          }),
        });

      const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
      await client.getLlmClient(testUserId);

      const secondCallHeaders = mockFetch.mock.calls[1]?.[1]?.headers;
      expect(secondCallHeaders).toHaveProperty('X-Internal-Auth', internalAuthToken);
    });
  });

  describe('default model fallback', () => {
    it('uses Gemini25Flash when user has no defaultModel preference', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            llmPreferences: {}, // No defaultModel
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            [LlmProviders.Google]: 'test-key',
          }),
        });

      const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
      const result = await client.getLlmClient(testUserId);

      expect(result.ok).toBe(true);
    });

    it('uses user preferred model when present (supported provider)', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            llmPreferences: { defaultModel: LlmModels.Glm47 },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            [LlmProviders.Zai]: 'test-key',
          }),
        });

      const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
      const result = await client.getLlmClient(testUserId);

      expect(result.ok).toBe(true);
    });
  });

  describe('provider-to-keyField mapping', () => {
    describe('supported providers (Google, Zai)', () => {
      it('maps Google provider to Google key field', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              llmPreferences: { defaultModel: LlmModels.Gemini25Flash },
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              [LlmProviders.Google]: 'test-key',
            }),
          });

        const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
        const result = await client.getLlmClient(testUserId);

        expect(result.ok).toBe(true);
      });

      it('maps Zai provider to Zai key field', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              llmPreferences: { defaultModel: LlmModels.Glm47 },
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              [LlmProviders.Zai]: 'test-key',
            }),
          });

        const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
        const result = await client.getLlmClient(testUserId);

        expect(result.ok).toBe(true);
      });
    });

    describe('unsupported providers (throws at createLlmClient)', () => {
      it('throws for OpenAI provider models', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              llmPreferences: { defaultModel: LlmModels.GPT4oMini },
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              [LlmProviders.OpenAI]: 'test-key',
            }),
          });

        const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
        const result = await client.getLlmClient(testUserId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('NETWORK_ERROR');
          expect(result.error.message).toContain('Unsupported LLM provider');
        }
      });

      it('throws for Anthropic provider models', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              llmPreferences: { defaultModel: LlmModels.ClaudeSonnet45 },
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              [LlmProviders.Anthropic]: 'test-key',
            }),
          });

        const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
        const result = await client.getLlmClient(testUserId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('NETWORK_ERROR');
          expect(result.error.message).toContain('Unsupported LLM provider');
        }
      });

      it('throws for Perplexity provider models', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              llmPreferences: { defaultModel: LlmModels.Sonar },
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              [LlmProviders.Perplexity]: 'test-key',
            }),
          });

        const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
        const result = await client.getLlmClient(testUserId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('NETWORK_ERROR');
          expect(result.error.message).toContain('Unsupported LLM provider');
        }
      });
    });
  });

  describe('error handling - API responses', () => {
    it('returns API_ERROR when settings endpoint returns non-200', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
      const result = await client.getLlmClient(testUserId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('HTTP 404');
      }
    });

    it('returns API_ERROR when keys endpoint returns non-200', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            llmPreferences: { defaultModel: LlmModels.Gemini25Flash },
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
        });

      const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
      const result = await client.getLlmClient(testUserId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('HTTP 403');
      }
    });
  });

  describe('error handling - missing API keys', () => {
    it('returns NO_API_KEY when provider key is null', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            llmPreferences: { defaultModel: LlmModels.Gemini25Flash },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            [LlmProviders.Google]: null, // No API key configured
          }),
        });

      const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
      const result = await client.getLlmClient(testUserId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toContain('Google');
        expect(result.error.message).toContain('API key');
      }
    });

    it('returns NO_API_KEY when provider key is undefined', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            llmPreferences: { defaultModel: LlmModels.Gemini25Flash },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            [LlmProviders.Google]: undefined,
          }),
        });

      const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
      const result = await client.getLlmClient(testUserId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
      }
    });
  });

  describe('error handling - invalid model', () => {
    it('returns INVALID_MODEL when user model is not valid', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            llmPreferences: { defaultModel: 'invalid-model-name' },
          }),
        });

      const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
      const result = await client.getLlmClient(testUserId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_MODEL');
        expect(result.error.message).toContain('invalid-model-name');
      }
    });
  });

  describe('error handling - network errors', () => {
    it('returns NETWORK_ERROR on fetch failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network connection failed'));

      const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
      const result = await client.getLlmClient(testUserId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toBe('Network connection failed');
      }
    });
  });

  describe('pricing integration', () => {
    it('passes pricing to LLM client', async () => {
      const getPricingSpy = vi.spyOn(mockPricingContext, 'getPricing');

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            llmPreferences: { defaultModel: LlmModels.Gemini25Flash },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            [LlmProviders.Google]: 'test-key',
          }),
        });

      const client = createUserServiceClient({ baseUrl, internalAuthToken, pricingContext: mockPricingContext });
      const result = await client.getLlmClient(testUserId);

      expect(result.ok).toBe(true);
      expect(getPricingSpy).toHaveBeenCalledWith(LlmModels.Gemini25Flash);
    });
  });
});

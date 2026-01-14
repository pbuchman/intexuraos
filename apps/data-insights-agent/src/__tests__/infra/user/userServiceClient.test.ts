/**
 * Tests for userServiceClient HTTP client.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createUserServiceClient, type UserServiceConfig } from '../../../infra/user/userServiceClient.js';
import { ok } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { LlmModels } from '@intexuraos/llm-contract';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import type { LLMModel } from '@intexuraos/llm-contract';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the llm-factory package - createLlmClient returns LlmGenerateClient directly
vi.mock('@intexuraos/llm-factory', () => ({
  createLlmClient: vi.fn(),
}));

import { createLlmClient } from '@intexuraos/llm-factory';

// Get reference to mocked function
const mockCreateLlmClient = vi.mocked(createLlmClient);

// Mock IPricingContext with all required methods
const createMockPricingContext = (): IPricingContext => ({
  getPricing: vi.fn().mockReturnValue({
    inputPricePerMillion: 0.001,
    outputPricePerMillion: 0.002,
  }),
  hasPricing: vi.fn().mockReturnValue(true),
  validateModels: vi.fn(),
  validateAllModels: vi.fn(),
  getModelsWithPricing: vi.fn().mockReturnValue([] as LLMModel[]),
});

const createMockConfig = (): UserServiceConfig => ({
  baseUrl: 'http://localhost:3000',
  internalAuthToken: 'test-internal-token',
  pricingContext: createMockPricingContext(),
});

// Mock LlmGenerateClient - only requires generate method
const createMockLlmClient = (): LlmGenerateClient => ({
  generate: vi.fn().mockResolvedValue(
    ok({
      content: 'Test response',
      usage: {
        inputTokens: 5,
        outputTokens: 5,
        totalTokens: 10,
        costUsd: 0.0001,
      },
    })
  ),
});

describe('userServiceClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateLlmClient.mockReturnValue(createMockLlmClient());
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  describe('getLlmClient - success path', () => {
    it('fetches user settings and creates LLM client with default model', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          llmPreferences: {
            defaultModel: LlmModels.GPT4oMini,
          },
        }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          openai: 'sk-test-key',
        }),
      } as Response);

      const result = await client.getLlmClient('user-123');

      expect(result.ok).toBe(true);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/internal/users/user-123/settings',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Internal-Auth': 'test-internal-token',
          }),
        })
      );
    });

    it('uses default model when user has no preference', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}), // No llmPreferences
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          google: 'google-test-key',
        }),
      } as Response);

      const result = await client.getLlmClient('user-123');

      expect(result.ok).toBe(true);
      expect(mockCreateLlmClient).toHaveBeenCalledWith(
        expect.objectContaining({
          model: LlmModels.Gemini25Flash,
        })
      );
    });

    it('fetches correct API key for Google provider', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          llmPreferences: { defaultModel: LlmModels.Gemini25Flash },
        }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          google: 'google-api-key-123',
        }),
      } as Response);

      const result = await client.getLlmClient('user-456');

      expect(result.ok).toBe(true);
      expect(mockCreateLlmClient).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'google-api-key-123',
          model: LlmModels.Gemini25Flash,
          userId: 'user-456',
        })
      );
    });

    it('fetches correct API key for OpenAI provider', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          llmPreferences: { defaultModel: LlmModels.GPT4oMini },
        }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          openai: 'sk-openai-key',
        }),
      } as Response);

      const result = await client.getLlmClient('user-789');

      expect(result.ok).toBe(true);
      expect(mockCreateLlmClient).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-openai-key',
        })
      );
    });

    it('fetches correct API key for Anthropic provider', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          llmPreferences: { defaultModel: LlmModels.ClaudeHaiku35 },
        }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          anthropic: 'sk-ant-key',
        }),
      } as Response);

      const result = await client.getLlmClient('user-abc');

      expect(result.ok).toBe(true);
      expect(mockCreateLlmClient).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-ant-key',
        })
      );
    });

    it('fetches correct API key for Perplexity provider', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          llmPreferences: { defaultModel: LlmModels.Sonar },
        }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          perplexity: 'pplx-key',
        }),
      } as Response);

      const result = await client.getLlmClient('user-pplx');

      expect(result.ok).toBe(true);
      expect(mockCreateLlmClient).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'pplx-key',
        })
      );
    });

    it('fetches correct API key for Zai provider', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          llmPreferences: { defaultModel: LlmModels.Glm47 },
        }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          zai: 'zai-api-key',
        }),
      } as Response);

      const result = await client.getLlmClient('user-zai');

      expect(result.ok).toBe(true);
      expect(mockCreateLlmClient).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'zai-api-key',
          model: LlmModels.Glm47,
        })
      );
    });

    it('includes pricing from pricing context in client config', async () => {
      const mockPricing = { inputPricePerMillion: 0.005, outputPricePerMillion: 0.015 };
      const mockPricingContext: IPricingContext = {
        getPricing: vi.fn().mockReturnValue(mockPricing),
        hasPricing: vi.fn().mockReturnValue(true),
        validateModels: vi.fn(),
        validateAllModels: vi.fn(),
        getModelsWithPricing: vi.fn().mockReturnValue([] as LLMModel[]),
      };
      const config: UserServiceConfig = {
        baseUrl: 'http://localhost:3000',
        internalAuthToken: 'test-token',
        pricingContext: mockPricingContext,
      };
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ llmPreferences: { defaultModel: LlmModels.GPT4oMini } }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ openai: 'sk-key' }),
      } as Response);

      const result = await client.getLlmClient('user-123');

      expect(result.ok).toBe(true);
      expect(mockCreateLlmClient).toHaveBeenCalledWith(
        expect.objectContaining({
          pricing: mockPricing,
        })
      );
    });
  });

  describe('getLlmClient - error handling', () => {
    it('returns API_ERROR when settings fetch fails', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const result = await client.getLlmClient('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('Failed to fetch user settings');
        expect(result.error.message).toContain('HTTP 500');
      }
    });

    it('returns API_ERROR when keys fetch fails', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ llmPreferences: { defaultModel: LlmModels.GPT4oMini } }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);

      const result = await client.getLlmClient('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('Failed to fetch API keys');
        expect(result.error.message).toContain('HTTP 503');
      }
    });

    it('returns INVALID_MODEL when model is not valid', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ llmPreferences: { defaultModel: 'invalid-model-name' } }),
      } as Response);

      const result = await client.getLlmClient('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_MODEL');
        expect(result.error.message).toContain('Invalid model: invalid-model-name');
      }
    });

    it('returns NO_API_KEY when API key is null for OpenAI', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ llmPreferences: { defaultModel: LlmModels.GPT4oMini } }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ openai: null }),
      } as Response);

      const result = await client.getLlmClient('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toContain('No API key configured for openai');
      }
    });

    it('returns NO_API_KEY when API key is undefined for Google', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ llmPreferences: { defaultModel: LlmModels.Gemini25Flash } }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}), // No google key
      } as Response);

      const result = await client.getLlmClient('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toContain('No API key configured for google');
      }
    });

    it('returns NETWORK_ERROR when fetch throws', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      mockFetch.mockRejectedValueOnce(new Error('Network connection failed'));

      const result = await client.getLlmClient('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Network connection failed');
      }
    });

    it('returns NETWORK_ERROR when JSON parsing fails', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      // Create a Response-like object that throws on json()
      const errorResponse = {
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
        headers: new Headers(),
        status: 200,
        statusText: 'OK',
        type: 'basic' as Response['type'],
        url: '',
        clone: function (): Response {
          return this as unknown as Response;
        },
        body: null,
        bodyUsed: false,
        arrayBuffer: async () => new ArrayBuffer(0),
        blob: async () => new Blob([], {}),
        formData: async () => new FormData(),
        text: async () => '',
      } as unknown as Response;

      mockFetch.mockResolvedValueOnce(errorResponse);

      const result = await client.getLlmClient('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Invalid JSON');
      }
    });
  });

  describe('getLlmClient - edge cases', () => {
    it('handles empty string API key as valid (implementation treats empty string as present)', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ llmPreferences: { defaultModel: LlmModels.GPT4oMini } }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ openai: '' }),
      } as Response);

      const result = await client.getLlmClient('user-123');

      // Empty string is treated as a valid (though empty) API key by the current implementation
      expect(result.ok).toBe(true);
    });

    it('handles multiple requests with different users', async () => {
      const config = createMockConfig();
      const client = createUserServiceClient(config);

      // First user - OpenAI
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ llmPreferences: { defaultModel: LlmModels.GPT4oMini } }),
      } as Response);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ openai: 'sk-key-1' }),
      } as Response);

      const result1 = await client.getLlmClient('user-1');

      // Second user - Google
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ llmPreferences: { defaultModel: LlmModels.Gemini25Flash } }),
      } as Response);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ google: 'google-key-2' }),
      } as Response);

      const result2 = await client.getLlmClient('user-2');

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/internal/users/user-1/settings',
        expect.anything()
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/internal/users/user-2/settings',
        expect.anything()
      );
    });

    it('uses custom baseUrl from config', async () => {
      const mockPricingContext: IPricingContext = {
        getPricing: vi.fn().mockReturnValue({
          inputPricePerMillion: 0,
          outputPricePerMillion: 0,
        }),
        hasPricing: vi.fn().mockReturnValue(true),
        validateModels: vi.fn(),
        validateAllModels: vi.fn(),
        getModelsWithPricing: vi.fn().mockReturnValue([] as LLMModel[]),
      };
      const config: UserServiceConfig = {
        baseUrl: 'https://custom-api.example.com',
        internalAuthToken: 'custom-token',
        pricingContext: mockPricingContext,
      };
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ llmPreferences: { defaultModel: LlmModels.GPT4oMini } }),
      } as Response);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ openai: 'sk-key' }),
      } as Response);

      await client.getLlmClient('user-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom-api.example.com/internal/users/user-123/settings',
        expect.anything()
      );
    });

    it('passes custom internal auth token in headers', async () => {
      const mockPricingContext: IPricingContext = {
        getPricing: vi.fn().mockReturnValue({
          inputPricePerMillion: 0,
          outputPricePerMillion: 0,
        }),
        hasPricing: vi.fn().mockReturnValue(true),
        validateModels: vi.fn(),
        validateAllModels: vi.fn(),
        getModelsWithPricing: vi.fn().mockReturnValue([] as LLMModel[]),
      };
      const config: UserServiceConfig = {
        baseUrl: 'http://localhost:3000',
        internalAuthToken: 'my-custom-auth-token',
        pricingContext: mockPricingContext,
      };
      const client = createUserServiceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ llmPreferences: { defaultModel: LlmModels.GPT4oMini } }),
      } as Response);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ openai: 'sk-key' }),
      } as Response);

      await client.getLlmClient('user-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Internal-Auth': 'my-custom-auth-token',
          }),
        })
      );
    });
  });
});

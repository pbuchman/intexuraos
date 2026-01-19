/**
 * Tests for LLM User Service Client.
 * Uses nock to mock HTTP calls to user-service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import pino from 'pino';
import { LlmModels } from '@intexuraos/llm-contract';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import {
  createLlmUserServiceClient,
  type LlmUserServiceConfig,
} from '../../../infra/user/llmUserServiceClient.js';

const silentLogger = pino({ level: 'silent' });

const mockPricingContext: IPricingContext = {
  getPricing: vi.fn().mockReturnValue({
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.2,
  }),
  hasPricing: vi.fn().mockReturnValue(true),
  validateModels: vi.fn().mockReturnValue({ valid: true, invalid: [] }),
  validateAllModels: vi.fn().mockReturnValue({ valid: true, invalid: [] }),
  getModelsWithPricing: vi.fn().mockReturnValue([]),
};

const BASE_URL = 'http://user-service:8080';
const AUTH_TOKEN = 'test-internal-auth-token';
const USER_ID = 'user-123';

describe('LlmUserServiceClient', () => {
  let config: LlmUserServiceConfig;

  beforeEach(() => {
    nock.cleanAll();
    config = {
      baseUrl: BASE_URL,
      internalAuthToken: AUTH_TOKEN,
      pricingContext: mockPricingContext,
      logger: silentLogger,
    };
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('getLlmClient', () => {
    it('creates LLM client successfully with Google provider', async () => {
      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/settings`)
        .matchHeader('X-Internal-Auth', AUTH_TOKEN)
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.Gemini25Flash,
          },
        });

      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/llm-keys`)
        .matchHeader('X-Internal-Auth', AUTH_TOKEN)
        .reply(200, {
          google: 'google-api-key-123',
        });

      const client = createLlmUserServiceClient(config);
      const result = await client.getLlmClient(USER_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeDefined();
      }
    });

    it('throws for unsupported provider (OpenAI)', async () => {
      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/settings`)
        .matchHeader('X-Internal-Auth', AUTH_TOKEN)
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.GPT4oMini,
          },
        });

      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/llm-keys`)
        .matchHeader('X-Internal-Auth', AUTH_TOKEN)
        .reply(200, {
          openai: 'openai-api-key-123',
        });

      const client = createLlmUserServiceClient(config);
      const result = await client.getLlmClient(USER_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Unsupported LLM provider');
      }
    });

    it('throws for unsupported provider (Anthropic)', async () => {
      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/settings`)
        .matchHeader('X-Internal-Auth', AUTH_TOKEN)
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.ClaudeSonnet45,
          },
        });

      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/llm-keys`)
        .matchHeader('X-Internal-Auth', AUTH_TOKEN)
        .reply(200, {
          anthropic: 'anthropic-api-key-123',
        });

      const client = createLlmUserServiceClient(config);
      const result = await client.getLlmClient(USER_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Unsupported LLM provider');
      }
    });

    it('throws for unsupported provider (Perplexity)', async () => {
      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/settings`)
        .matchHeader('X-Internal-Auth', AUTH_TOKEN)
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.Sonar,
          },
        });

      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/llm-keys`)
        .matchHeader('X-Internal-Auth', AUTH_TOKEN)
        .reply(200, {
          perplexity: 'perplexity-api-key-123',
        });

      const client = createLlmUserServiceClient(config);
      const result = await client.getLlmClient(USER_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Unsupported LLM provider');
      }
    });

    it('creates LLM client successfully with Zai provider', async () => {
      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/settings`)
        .matchHeader('X-Internal-Auth', AUTH_TOKEN)
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.Glm47,
          },
        });

      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/llm-keys`)
        .matchHeader('X-Internal-Auth', AUTH_TOKEN)
        .reply(200, {
          zai: 'zai-api-key-123',
        });

      const client = createLlmUserServiceClient(config);
      const result = await client.getLlmClient(USER_ID);

      expect(result.ok).toBe(true);
    });

    it('uses default model when no llmPreferences in settings', async () => {
      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/settings`)
        .reply(200, {});

      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/llm-keys`)
        .reply(200, {
          google: 'google-api-key-123',
        });

      const client = createLlmUserServiceClient(config);
      const result = await client.getLlmClient(USER_ID);

      expect(result.ok).toBe(true);
    });

    it('returns API_ERROR when settings fetch fails', async () => {
      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/settings`)
        .reply(500);

      const client = createLlmUserServiceClient(config);
      const result = await client.getLlmClient(USER_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('Failed to fetch user settings');
        expect(result.error.message).toContain('500');
      }
    });

    it('returns API_ERROR when llm-keys fetch fails', async () => {
      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/settings`)
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.Gemini25Flash,
          },
        });

      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/llm-keys`)
        .reply(403);

      const client = createLlmUserServiceClient(config);
      const result = await client.getLlmClient(USER_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('Failed to fetch API keys');
        expect(result.error.message).toContain('403');
      }
    });

    it('returns INVALID_MODEL when user has invalid model preference', async () => {
      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/settings`)
        .reply(200, {
          llmPreferences: {
            defaultModel: 'invalid-model-that-doesnt-exist',
          },
        });

      const client = createLlmUserServiceClient(config);
      const result = await client.getLlmClient(USER_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_MODEL');
        expect(result.error.message).toContain('Invalid model');
      }
    });

    it('returns NO_API_KEY when key is null', async () => {
      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/settings`)
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.Gemini25Flash,
          },
        });

      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/llm-keys`)
        .reply(200, {
          google: null,
        });

      const client = createLlmUserServiceClient(config);
      const result = await client.getLlmClient(USER_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toContain('No API key configured');
      }
    });

    it('returns NO_API_KEY when key is undefined', async () => {
      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/settings`)
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.Gemini25Flash,
          },
        });

      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/llm-keys`)
        .reply(200, {});

      const client = createLlmUserServiceClient(config);
      const result = await client.getLlmClient(USER_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toContain('No API key configured');
      }
    });

    it('returns NETWORK_ERROR when fetch throws', async () => {
      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/settings`)
        .replyWithError('Connection refused');

      const client = createLlmUserServiceClient(config);
      const result = await client.getLlmClient(USER_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });

    it('uses default logger when none provided', async () => {
      const configWithoutLogger: LlmUserServiceConfig = {
        baseUrl: BASE_URL,
        internalAuthToken: AUTH_TOKEN,
        pricingContext: mockPricingContext,
      };

      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/settings`)
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.Gemini25Flash,
          },
        });

      nock(BASE_URL)
        .get(`/internal/users/${USER_ID}/llm-keys`)
        .reply(200, {
          google: 'google-api-key-123',
        });

      const client = createLlmUserServiceClient(configWithoutLogger);
      const result = await client.getLlmClient(USER_ID);

      expect(result.ok).toBe(true);
    });
  });
});

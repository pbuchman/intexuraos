/**
 * Service container tests for chat-agent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetFirestore } from '@intexuraos/infra-firestore';
import { LlmModels } from '@intexuraos/llm-contract';
import {
  getServices,
  initializeServices,
  setServices,
  resetServices,
  type ServiceContainer,
} from '../services.js';
import { ok } from '@intexuraos/common-core';

const {
  mockCreatePricingContext,
  mockFetchAllPricing,
  mockCreateUserServiceClient,
  mockCreateLlmClient,
  mockGuestRateLimiter,
} = vi.hoisted(() => {
  const mockPricingContext = {
    getPricing: vi.fn().mockReturnValue({
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    }),
  };

  return {
    mockCreatePricingContext: vi.fn().mockReturnValue(mockPricingContext),
    mockFetchAllPricing: vi.fn().mockResolvedValue({ ok: true, value: { models: [] } }),
    mockCreateUserServiceClient: vi.fn().mockReturnValue({
      getLlmClient: vi.fn().mockResolvedValue({ ok: true, value: { generate: vi.fn() } }),
      getApiKeys: vi.fn().mockResolvedValue({ ok: true, value: {} }),
      reportLlmSuccess: vi.fn(),
      getOAuthToken: vi.fn(),
      resolveGitHubUsername: vi.fn().mockResolvedValue({ ok: true, value: null }),
      getUserTimezone: async (): Promise<string | undefined> => undefined,
    }),
    mockCreateLlmClient: vi.fn().mockReturnValue({ generate: vi.fn() }),
    mockGuestRateLimiter: {},
  };
});

vi.mock('@intexuraos/llm-pricing', () => ({
  fetchAllPricing: mockFetchAllPricing,
  createPricingContext: mockCreatePricingContext,
}));

vi.mock('@intexuraos/internal-clients', () => ({
  createUserServiceClient: mockCreateUserServiceClient,
}));

vi.mock('@intexuraos/llm-factory', () => ({
  createLlmClient: mockCreateLlmClient,
}));

vi.mock('../infra/firestore/embeddingRepository.js', () => ({
  FirestoreEmbeddingRepository: vi
    .fn()
    .mockImplementation(function FirestoreEmbeddingRepository() {
      return {};
    }),
}));

vi.mock('../infra/rateLimit/index.js', () => ({
  createGuestRateLimiter: vi.fn().mockReturnValue(mockGuestRateLimiter),
}));

vi.mock('openai', () => ({
  default: class OpenAI {
    readonly embeddings = {
      create: vi.fn(),
    };
  },
}));

describe('chat-agent services', () => {
  beforeEach(() => {
    process.env['INTEXURAOS_OPENAI_APP_API_KEY'] = 'test-key';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
    process.env['INTEXURAOS_USER_SERVICE_URL'] = 'http://localhost:8080';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-token';
    process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'] = 'http://localhost:8081';
    process.env['INTEXURAOS_GEMINI_APP_API_KEY'] = 'test-gemini-key';
    process.env['INTEXURAOS_DASHSCOPE_APP_API_KEY'] = 'test-dashscope-key';
    mockCreatePricingContext.mockClear();
    mockFetchAllPricing.mockClear();
    mockCreateUserServiceClient.mockClear();
    mockCreateLlmClient.mockClear();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    delete process.env['INTEXURAOS_OPENAI_APP_API_KEY'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_USER_SERVICE_URL'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'];
    delete process.env['INTEXURAOS_GEMINI_APP_API_KEY'];
    delete process.env['INTEXURAOS_DASHSCOPE_APP_API_KEY'];
  });

  describe('getServices', () => {
    it('should throw when container not initialized', () => {
      resetServices();
      expect(() => getServices()).toThrow('Service container not initialized');
    });
  });

  describe('setServices', () => {
    it('should set custom service container', () => {
      const mockLogger = {
        level: 'info',
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
        fatal: () => undefined,
        trace: () => undefined,
        silent: () => undefined,
        msgPrefix: '',
      } as const;
      const mockUserServiceClient: ServiceContainer['userServiceClient'] = {
        async getLlmClient() {
          return ok({
            async generate() {
              return ok({
                content: 'test response',
                usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.0001 },
              });
            },
          });
        },
        async getApiKeys() {
          return ok({});
        },
        async reportLlmSuccess() {
          // no-op
        },
        async getOAuthToken() {
          return { ok: false as const, error: { code: 'CONNECTION_NOT_FOUND' as const, message: 'Not found' } };
        },
        async resolveGitHubUsername() {
          return ok(null);
        },
        async getUserTimezone() {
          return undefined;
        },
      };

      const customServices: ServiceContainer = {
        generateId: () => 'custom-id',
        embeddingRepository: null as unknown as ServiceContainer['embeddingRepository'],
        embeddingClient: null as unknown as ServiceContainer['embeddingClient'],
        userServiceClient: mockUserServiceClient,
        logger: mockLogger as unknown as ServiceContainer['logger'],
        guestRateLimiter: null as unknown as ServiceContainer['guestRateLimiter'],
        guestLlmClient: null as unknown as ServiceContainer['guestLlmClient'],
      };
      setServices(customServices);
      const services = getServices();
      expect(services.generateId()).toBe('custom-id');
    });
  });

  describe('resetServices', () => {
    it('should reset service container', () => {
      // Manually set up services for this test (since initializeServices is async and mocked)
      const mockLogger = {
        level: 'info',
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
        fatal: () => undefined,
        trace: () => undefined,
        silent: () => undefined,
        msgPrefix: '',
      } as const;

      const customServices: ServiceContainer = {
        generateId: () => 'test-id',
        embeddingRepository: null as unknown as ServiceContainer['embeddingRepository'],
        embeddingClient: null as unknown as ServiceContainer['embeddingClient'],
        userServiceClient: null as unknown as ServiceContainer['userServiceClient'],
        logger: mockLogger as unknown as ServiceContainer['logger'],
        guestRateLimiter: null as unknown as ServiceContainer['guestRateLimiter'],
        guestLlmClient: null as unknown as ServiceContainer['guestLlmClient'],
      };
      setServices(customServices);
      expect(() => getServices()).not.toThrow();
      resetServices();
      expect(() => getServices()).toThrow('Service container not initialized');
    });
  });

  describe('initializeServices', () => {
    it('uses the Gemini platform key for guest access and user-service fallbacks', async () => {
      await initializeServices();

      expect(mockCreateLlmClient).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'test-gemini-key',
          model: LlmModels.Gemini25Flash,
        })
      );
      expect(mockCreateUserServiceClient).toHaveBeenCalledWith(
        expect.objectContaining({
          platformGeminiApiKey: 'test-gemini-key',
        })
      );
    });

    it('fails fast when the Gemini guest key is missing', async () => {
      delete process.env['INTEXURAOS_GEMINI_APP_API_KEY'];

      await expect(initializeServices()).rejects.toThrow(
        'INTEXURAOS_GEMINI_APP_API_KEY environment variable is required for guest access'
      );
    });
  });
});

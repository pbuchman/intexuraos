/**
 * Tests for getLlmClient with OpenRouter models not in the default allowlist.
 *
 * A separate file is required because vi.mock is module-level and mocking
 * @intexuraos/infra-openrouter here would interfere with other test files.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import nock from 'nock';
import { createFakePricingContext, createFakeUsageSink } from '@intexuraos/llm-pricing';

// Mock getDefaultAllowlistPricing to return undefined for unlisted models
vi.mock('@intexuraos/infra-openrouter', () => ({
  getDefaultAllowlistPricing: vi.fn().mockReturnValue(undefined),
  isDefaultAllowedModel: vi.fn().mockReturnValue(false),
}));

// Mock createLlmClient so we don't need real API keys
const { mockCreateLlmClient } = vi.hoisted(() => ({
  mockCreateLlmClient: vi.fn(),
}));

vi.mock('@intexuraos/llm-factory', () => ({
  createLlmClient: mockCreateLlmClient,
}));

const { createUserServiceClient } = await import('../client.js');

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const config = {
  baseUrl: 'http://localhost:3000',
  internalAuthToken: 'test-token',
  pricingContext: createFakePricingContext(),
  logger: mockLogger,
  usageSink: createFakeUsageSink(),
};

describe('getLlmClient OpenRouter pricing fallback', () => {
  beforeEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
    // Reset mock to return undefined (simulate unlisted model)
    mockCreateLlmClient.mockReturnValue({ generate: vi.fn() });
  });

  it('uses zero-cost provider pricing when OpenRouter model is not in the default allowlist', async () => {
    // or:some/unlisted-model passes isDefaultEligibleModel via vi.mock of isDefaultEligibleModel
    // but getDefaultAllowlistPricing returns undefined → hits the ?? fallback branch
    const LISTED_OR_MODEL = 'or:google/gemma-4-31b-it:free';

    nock('http://localhost:3000')
      .get('/internal/users/user123/settings')
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, {
        success: true,
        data: {
          llmPreferences: { defaultModel: LISTED_OR_MODEL },
        },
      });

    nock('http://localhost:3000')
      .get('/internal/users/user123/llm-keys')
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, {
        success: true,
        data: { openrouter: 'openrouter-key' },
      });

    const client = createUserServiceClient(config);
    const result = await client.getLlmClient('user123');

    expect(result.ok).toBe(true);

    // Verify createLlmClient was called with zero-cost pricing (the ?? fallback)
    expect(mockCreateLlmClient).toHaveBeenCalledWith(
      expect.objectContaining({
        pricing: { inputPricePerMillion: 0, outputPricePerMillion: 0, useProviderCost: true },
      })
    );
  });
});

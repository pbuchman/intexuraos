/**
 * Tests for getLlmClient fallback retry behavior.
 *
 * A separate file is required because vi.mock is module-level and would interfere
 * with the existing client.test.ts tests that rely on createLlmClient throwing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import nock from 'nock';
import { LlmModels } from '@intexuraos/llm-contract';
import { createFakePricingContext, createFakeUsageSink } from '@intexuraos/llm-pricing';
import type { LlmClientConfig } from '@intexuraos/llm-factory';
import type { LlmGenerateClient, GenerateResult } from '@intexuraos/llm-factory';
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';

// Mock createLlmClient so we control generate() behavior per test
const { mockCreateLlmClient } = vi.hoisted(() => {
  return {
    mockCreateLlmClient: vi.fn(),
  };
});

vi.mock('@intexuraos/llm-factory', () => ({
  createLlmClient: mockCreateLlmClient,
}));

// Import after vi.mock so the mock is in place
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

const PRIMARY_MODEL = LlmModels.Gemini25Flash;
// An OpenRouter model eligible as fallback
const FALLBACK_MODEL = 'or:google/gemma-4-31b-it:free';

function makeSuccessResult(content: string): Result<GenerateResult, never> {
  return ok({
    content,
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0 },
  });
}

function makeErrorResult(): Result<never, { code: string; message: string }> {
  return err({ code: 'PROVIDER_ERROR', message: 'model failed' });
}

function setupNocks(defaultModel: string, fallbackModel?: string): void {
  const settingsData: {
    llmPreferences: { defaultModel: string; fallbackModel?: string };
  } = {
    llmPreferences: { defaultModel },
  };
  if (fallbackModel !== undefined) {
    settingsData.llmPreferences.fallbackModel = fallbackModel;
  }

  nock('http://localhost:3000')
    .get('/internal/users/user123/settings')
    .matchHeader('X-Internal-Auth', 'test-token')
    .reply(200, { success: true, data: settingsData });

  nock('http://localhost:3000')
    .get('/internal/users/user123/llm-keys')
    .matchHeader('X-Internal-Auth', 'test-token')
    .reply(200, {
      success: true,
      data: {
        google: 'google-key',
        openrouter: 'openrouter-key',
      },
    });
}

describe('getLlmClient fallback behavior', () => {
  beforeEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
  });

  it('returns primary result when primary generate succeeds (no fallback attempted)', async () => {
    setupNocks(PRIMARY_MODEL, FALLBACK_MODEL);

    const primaryGenerate = vi.fn().mockResolvedValue(makeSuccessResult('primary response'));
    const primaryClient: LlmGenerateClient = { generate: primaryGenerate };

    // createLlmClient returns primary client (called once for primary)
    mockCreateLlmClient.mockReturnValue(primaryClient);

    const serviceClient = createUserServiceClient(config);
    const result = await serviceClient.getLlmClient('user123');

    if (!result.ok) expect.fail('Expected ok result');

    const generateResult = await result.value.generate('test prompt');

    expect(generateResult.ok).toBe(true);
    if (generateResult.ok) {
      expect(generateResult.value.content).toBe('primary response');
    }
    // Fallback generate was never called — only one generate invocation
    expect(primaryGenerate).toHaveBeenCalledTimes(1);
    // createLlmClient only called once (primary)
    expect(mockCreateLlmClient).toHaveBeenCalledTimes(1);
  });

  it('retries with fallback when primary fails and fallback succeeds', async () => {
    setupNocks(PRIMARY_MODEL, FALLBACK_MODEL);

    const primaryGenerate = vi.fn().mockResolvedValue(makeErrorResult());
    const primaryClient: LlmGenerateClient = { generate: primaryGenerate };

    const fallbackGenerate = vi.fn().mockResolvedValue(makeSuccessResult('fallback response'));
    const fallbackClient: LlmGenerateClient = { generate: fallbackGenerate };

    // First call → primary, second call → fallback
    mockCreateLlmClient.mockReturnValueOnce(primaryClient).mockReturnValueOnce(fallbackClient);

    const serviceClient = createUserServiceClient(config);
    const result = await serviceClient.getLlmClient('user123');

    if (!result.ok) expect.fail('Expected ok result');

    const generateResult = await result.value.generate('test prompt');

    expect(generateResult.ok).toBe(true);
    if (generateResult.ok) {
      expect(generateResult.value.content).toBe('fallback response');
    }
    expect(primaryGenerate).toHaveBeenCalledTimes(1);
    expect(fallbackGenerate).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user123',
        primaryModel: PRIMARY_MODEL,
        fallbackModel: FALLBACK_MODEL,
      }),
      'Primary model failed, attempting fallback'
    );
  });

  it('propagates primary error when no fallback model is configured', async () => {
    // No fallbackModel in settings
    setupNocks(PRIMARY_MODEL);

    const primaryGenerate = vi.fn().mockResolvedValue(makeErrorResult());
    const primaryClient: LlmGenerateClient = { generate: primaryGenerate };
    mockCreateLlmClient.mockReturnValue(primaryClient);

    const serviceClient = createUserServiceClient(config);
    const result = await serviceClient.getLlmClient('user123');

    if (!result.ok) expect.fail('Expected ok result');

    const generateResult = await result.value.generate('test prompt');

    expect(generateResult.ok).toBe(false);
    if (!generateResult.ok) {
      expect(generateResult.error.code).toBe('PROVIDER_ERROR');
    }
    // Only primary was ever called
    expect(mockCreateLlmClient).toHaveBeenCalledTimes(1);
  });

  it('returns fallback error when both primary and fallback fail', async () => {
    setupNocks(PRIMARY_MODEL, FALLBACK_MODEL);

    const primaryGenerate = vi.fn().mockResolvedValue(makeErrorResult());
    const primaryClient: LlmGenerateClient = { generate: primaryGenerate };

    const fallbackGenerate = vi
      .fn()
      .mockResolvedValue(err({ code: 'PROVIDER_ERROR', message: 'fallback also failed' }));
    const fallbackClient: LlmGenerateClient = { generate: fallbackGenerate };

    mockCreateLlmClient.mockReturnValueOnce(primaryClient).mockReturnValueOnce(fallbackClient);

    const serviceClient = createUserServiceClient(config);
    const result = await serviceClient.getLlmClient('user123');

    if (!result.ok) expect.fail('Expected ok result');

    const generateResult = await result.value.generate('test prompt');

    expect(generateResult.ok).toBe(false);
    if (!generateResult.ok) {
      expect(generateResult.error.message).toBe('fallback also failed');
    }
    expect(primaryGenerate).toHaveBeenCalledTimes(1);
    expect(fallbackGenerate).toHaveBeenCalledTimes(1);
  });

  it('skips fallback wrapping when fallback model is not default-eligible', async () => {
    // An OpenRouter model NOT in the curated allowlist fails isDefaultEligibleModel
    const UNLISTED_OR_MODEL = 'or:some/unlisted-model';

    nock('http://localhost:3000')
      .get('/internal/users/user123/settings')
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, {
        success: true,
        data: {
          llmPreferences: {
            defaultModel: PRIMARY_MODEL,
            fallbackModel: UNLISTED_OR_MODEL,
          },
        },
      });

    nock('http://localhost:3000')
      .get('/internal/users/user123/llm-keys')
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, {
        success: true,
        data: {
          google: 'google-key',
          openrouter: 'openrouter-key',
        },
      });

    const primaryGenerate = vi.fn().mockResolvedValue(makeErrorResult());
    const primaryClient: LlmGenerateClient = { generate: primaryGenerate };

    mockCreateLlmClient.mockReturnValue(primaryClient);

    const serviceClient = createUserServiceClient(config);
    const result = await serviceClient.getLlmClient('user123');

    if (!result.ok) expect.fail('Expected ok result');

    // Unlisted model fails isDefaultEligibleModel → no wrapping → primary error returned directly
    const generateResult = await result.value.generate('test prompt');

    expect(generateResult.ok).toBe(false);
    if (!generateResult.ok) {
      expect(generateResult.error.code).toBe('PROVIDER_ERROR');
    }
    // Only primary client created; no fallback attempted
    expect(mockCreateLlmClient).toHaveBeenCalledTimes(1);
  });

  it('returns primary error when fallback model has no API key', async () => {
    // User has google key but the fallback is an anthropic model — no anthropic key
    // ClaudeHaiku35 is a FastModel → passes isDefaultEligibleModel
    const ANTHROPIC_FALLBACK = LlmModels.ClaudeHaiku35;

    nock('http://localhost:3000')
      .get('/internal/users/user123/settings')
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, {
        success: true,
        data: {
          llmPreferences: {
            defaultModel: PRIMARY_MODEL,
            fallbackModel: ANTHROPIC_FALLBACK,
          },
        },
      });

    nock('http://localhost:3000')
      .get('/internal/users/user123/llm-keys')
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, {
        success: true,
        data: {
          google: 'google-key',
          // No anthropic key
        },
      });

    const primaryGenerate = vi.fn().mockResolvedValue(makeErrorResult());
    const primaryClient: LlmGenerateClient = { generate: primaryGenerate };
    mockCreateLlmClient.mockReturnValueOnce(primaryClient);

    const serviceClient = createUserServiceClient(config);
    const result = await serviceClient.getLlmClient('user123');

    if (!result.ok) expect.fail('Expected ok result');

    const generateResult = await result.value.generate('test prompt');

    expect(generateResult.ok).toBe(false);
    if (!generateResult.ok) {
      expect(generateResult.error.code).toBe('PROVIDER_ERROR');
    }
    // Primary generate called once, then fallback attempted but no key → primary error returned
    expect(primaryGenerate).toHaveBeenCalledTimes(1);
    expect(mockCreateLlmClient).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user123', fallbackModel: ANTHROPIC_FALLBACK }),
      'No API key for fallback model'
    );
  });
});

describe('getLlmClient ownerType tagging', () => {
  beforeEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
  });

  it('passes ownerType: "user" to createLlmClient for the main client (call site 3)', async () => {
    // Normal path: user has a key for their default model
    setupNocks(PRIMARY_MODEL);

    const fakeClient: LlmGenerateClient = {
      generate: vi.fn().mockResolvedValue(makeSuccessResult('ok')),
    };
    mockCreateLlmClient.mockReturnValue(fakeClient);

    const serviceClient = createUserServiceClient(config);
    const result = await serviceClient.getLlmClient('user123');

    if (!result.ok) expect.fail(`Expected ok, got ${JSON.stringify(result.error)}`);

    // One createLlmClient call for the main client
    expect(mockCreateLlmClient).toHaveBeenCalledTimes(1);
    const capturedConfig = mockCreateLlmClient.mock.calls[0]?.[0] as LlmClientConfig;
    expect(capturedConfig).toMatchObject({ ownerType: 'user' });
  });

  it('passes ownerType: "user" to createLlmClient for the buildClientForModel helper (call site 2)', async () => {
    // Fallback retry path: primary fails, buildClientForModel creates fallback client
    setupNocks(PRIMARY_MODEL, FALLBACK_MODEL);

    const primaryGenerate = vi.fn().mockResolvedValue(makeErrorResult());
    const primaryClient: LlmGenerateClient = { generate: primaryGenerate };

    const fallbackGenerate = vi.fn().mockResolvedValue(makeSuccessResult('fallback ok'));
    const fallbackClient: LlmGenerateClient = { generate: fallbackGenerate };

    mockCreateLlmClient.mockReturnValueOnce(primaryClient).mockReturnValueOnce(fallbackClient);

    const serviceClient = createUserServiceClient(config);
    const result = await serviceClient.getLlmClient('user123');

    if (!result.ok) expect.fail(`Expected ok, got ${JSON.stringify(result.error)}`);

    // Trigger fallback so buildClientForModel is invoked
    await result.value.generate('test prompt');

    // Two calls: primary (call site 3) and fallback (call site 2 inside buildClientForModel)
    expect(mockCreateLlmClient).toHaveBeenCalledTimes(2);
    const primaryConfig = mockCreateLlmClient.mock.calls[0]?.[0] as LlmClientConfig;
    const fallbackConfig = mockCreateLlmClient.mock.calls[1]?.[0] as LlmClientConfig;
    expect(primaryConfig).toMatchObject({ ownerType: 'user' });
    expect(fallbackConfig).toMatchObject({ ownerType: 'user' });
  });

  it('passes ownerType: "user" to createLlmClient for the platform Gemini fallback (call site 1)', async () => {
    // Platform Gemini path: user has no key for their preferred model
    // and the service has a platform Gemini key configured
    const configWithPlatformKey = {
      ...config,
      platformGeminiApiKey: 'platform-gemini-key',
    };

    // User wants ClaudeHaiku35 but has no anthropic key
    nock('http://localhost:3000')
      .get('/internal/users/user123/settings')
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, {
        success: true,
        data: {
          llmPreferences: { defaultModel: LlmModels.ClaudeHaiku35 },
        },
      });

    nock('http://localhost:3000')
      .get('/internal/users/user123/llm-keys')
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, {
        success: true,
        data: { openai: 'openai-key' }, // no anthropic key
      });

    const fakeClient: LlmGenerateClient = {
      generate: vi.fn().mockResolvedValue(makeSuccessResult('gemini ok')),
    };
    mockCreateLlmClient.mockReturnValue(fakeClient);

    const serviceClient = createUserServiceClient(configWithPlatformKey);
    const result = await serviceClient.getLlmClient('user123');

    if (!result.ok) expect.fail(`Expected ok, got ${JSON.stringify(result.error)}`);

    // Platform Gemini fallback: one call via call site 1
    expect(mockCreateLlmClient).toHaveBeenCalledTimes(1);
    const capturedConfig = mockCreateLlmClient.mock.calls[0]?.[0] as LlmClientConfig;
    expect(capturedConfig).toMatchObject({ ownerType: 'user' });
  });
});

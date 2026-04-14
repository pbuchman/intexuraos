import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createLlmClientMock } = vi.hoisted(() => ({
  createLlmClientMock: vi.fn(),
}));

vi.mock('@intexuraos/llm-factory', () => ({
  createLlmClient: createLlmClientMock,
}));

const { getDefaultAllowlistPricingMock } = vi.hoisted(() => ({
  getDefaultAllowlistPricingMock: vi.fn(),
}));

vi.mock('@intexuraos/infra-openrouter', () => ({
  getDefaultAllowlistPricing: getDefaultAllowlistPricingMock,
}));

const { HttpWebhookUsageSinkMock } = vi.hoisted(() => {
  const constructorSpy = vi.fn();
  function HttpWebhookUsageSinkMock(this: Record<string, unknown>, config: unknown): void {
    constructorSpy(config);
  }
  // Expose the spy on the constructor for assertions
  (HttpWebhookUsageSinkMock as unknown as Record<string, unknown>)['_spy'] = constructorSpy;
  return { HttpWebhookUsageSinkMock };
});

vi.mock('@intexuraos/llm-pricing', () => ({
  HttpWebhookUsageSink: HttpWebhookUsageSinkMock,
}));

const { parseValidationModels, buildValidationClients, GEMINI_VALIDATION_PRICING } =
  await import('../validation-model-clients.js');

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as import('@intexuraos/common-core').Logger;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseValidationModels', () => {
  it('parses comma-separated model list with or: prefix and plain models', () => {
    const result = parseValidationModels('or:google/gemma-4-31b-it:free,gemini-2.5-flash');
    expect(result).toEqual([
      {
        provider: 'openrouter',
        modelId: 'or:google/gemma-4-31b-it:free',
        rawId: 'google/gemma-4-31b-it:free',
      },
      { provider: 'gemini', modelId: 'gemini-2.5-flash', rawId: 'gemini-2.5-flash' },
    ]);
  });

  it('parses single model', () => {
    const result = parseValidationModels('gemini-2.5-flash');
    expect(result).toEqual([
      { provider: 'gemini', modelId: 'gemini-2.5-flash', rawId: 'gemini-2.5-flash' },
    ]);
  });

  it('parses single openrouter model', () => {
    const result = parseValidationModels('or:xiaomi/mimo-v2-pro');
    expect(result).toEqual([
      { provider: 'openrouter', modelId: 'or:xiaomi/mimo-v2-pro', rawId: 'xiaomi/mimo-v2-pro' },
    ]);
  });

  it('throws on empty string', () => {
    expect(() => parseValidationModels('')).toThrow(
      'INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS must not be empty'
    );
  });

  it('throws on whitespace-only string', () => {
    expect(() => parseValidationModels('   ')).toThrow(
      'INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS must not be empty'
    );
  });

  it('throws on entry that is just whitespace after trimming', () => {
    expect(() => parseValidationModels('gemini-2.5-flash, ')).toThrow(
      'INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS contains empty entry at position 2'
    );
  });

  it('trims whitespace around model entries', () => {
    const result = parseValidationModels(' or:model/a , gemini-2.5-flash ');
    expect(result).toEqual([
      { provider: 'openrouter', modelId: 'or:model/a', rawId: 'model/a' },
      { provider: 'gemini', modelId: 'gemini-2.5-flash', rawId: 'gemini-2.5-flash' },
    ]);
  });
});

describe('buildValidationClients', () => {
  it('builds clients in priority order', () => {
    const fakeClient1 = { generate: vi.fn() };
    const fakeClient2 = { generate: vi.fn() };
    createLlmClientMock.mockReturnValueOnce(fakeClient1).mockReturnValueOnce(fakeClient2);
    getDefaultAllowlistPricingMock.mockReturnValue({
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    });

    const models = parseValidationModels('or:google/gemma-4-31b-it:free,gemini-2.5-flash');
    const clients = buildValidationClients({
      models,
      openRouterApiKey: 'or-key',
      geminiApiKey: 'gem-key',
      usageWebhookUrl: 'http://usage',
      orchestratorSecret: 'secret',
      internalAuthToken: 'token',
      logger: fakeLogger,
      getCorrelationTaskId: () => null,
    });

    expect(clients).toHaveLength(2);
    expect(clients[0]?.client).toBe(fakeClient1);
    expect(clients[0]?.modelName).toBe('or:google/gemma-4-31b-it:free');
    expect(clients[1]?.client).toBe(fakeClient2);
    expect(clients[1]?.modelName).toBe('gemini-2.5-flash');
    expect(createLlmClientMock).toHaveBeenCalledTimes(2);

    // First call: OpenRouter model
    const firstCallConfig = createLlmClientMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstCallConfig['apiKey']).toBe('or-key');
    expect(firstCallConfig['model']).toBe('or:google/gemma-4-31b-it:free');

    // Second call: Gemini model
    const secondCallConfig = createLlmClientMock.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(secondCallConfig['apiKey']).toBe('gem-key');
    expect(secondCallConfig['model']).toBe('gemini-2.5-flash');
  });

  it('uses getDefaultAllowlistPricing for OpenRouter models', () => {
    const expectedPricing = { inputPricePerMillion: 0.3, outputPricePerMillion: 1.0 };
    getDefaultAllowlistPricingMock.mockReturnValue(expectedPricing);
    createLlmClientMock.mockReturnValue({ generate: vi.fn() });

    const models = parseValidationModels('or:google/gemma-4-31b-it:free');
    buildValidationClients({
      models,
      openRouterApiKey: 'or-key',
      geminiApiKey: 'gem-key',
      usageWebhookUrl: 'http://usage',
      orchestratorSecret: 'secret',
      internalAuthToken: 'token',
      logger: fakeLogger,
      getCorrelationTaskId: () => null,
    });

    expect(getDefaultAllowlistPricingMock).toHaveBeenCalledWith('google/gemma-4-31b-it:free');
    const callConfig = createLlmClientMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callConfig['pricing']).toBe(expectedPricing);
  });

  it('falls back to zero pricing when OpenRouter model is not in default allowlist', () => {
    getDefaultAllowlistPricingMock.mockReturnValue(undefined);
    createLlmClientMock.mockReturnValue({ generate: vi.fn() });

    const models = parseValidationModels('or:unknown/model');
    buildValidationClients({
      models,
      openRouterApiKey: 'or-key',
      geminiApiKey: 'gem-key',
      usageWebhookUrl: 'http://usage',
      orchestratorSecret: 'secret',
      internalAuthToken: 'token',
      logger: fakeLogger,
      getCorrelationTaskId: () => null,
    });

    const callConfig = createLlmClientMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callConfig['pricing']).toEqual({
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    });
  });

  it('uses GEMINI_VALIDATION_PRICING for Gemini models', () => {
    createLlmClientMock.mockReturnValue({ generate: vi.fn() });

    const models = parseValidationModels('gemini-2.5-flash');
    buildValidationClients({
      models,
      openRouterApiKey: 'or-key',
      geminiApiKey: 'gem-key',
      usageWebhookUrl: 'http://usage',
      orchestratorSecret: 'secret',
      internalAuthToken: 'token',
      logger: fakeLogger,
      getCorrelationTaskId: () => null,
    });

    const callConfig = createLlmClientMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callConfig['pricing']).toBe(GEMINI_VALIDATION_PRICING);
  });

  it('throws when openRouterApiKey is empty and an or: model is present', () => {
    const models = parseValidationModels('or:google/gemma-4-31b-it:free');
    expect(() =>
      buildValidationClients({
        models,
        openRouterApiKey: '',
        geminiApiKey: 'gem-key',
        usageWebhookUrl: 'http://usage',
        orchestratorSecret: 'secret',
        internalAuthToken: 'token',
        logger: fakeLogger,
        getCorrelationTaskId: () => null,
      })
    ).toThrow('INTEXURAOS_OPENROUTER_APP_API_KEY is required for OpenRouter validation model');
  });

  it('throws when geminiApiKey is empty and a Gemini model is present', () => {
    const models = parseValidationModels('gemini-2.5-flash');
    expect(() =>
      buildValidationClients({
        models,
        openRouterApiKey: 'or-key',
        geminiApiKey: '',
        usageWebhookUrl: 'http://usage',
        orchestratorSecret: 'secret',
        internalAuthToken: 'token',
        logger: fakeLogger,
        getCorrelationTaskId: () => null,
      })
    ).toThrow('INTEXURAOS_GEMINI_APP_API_KEY is required for Gemini validation model');
  });

  it('threads getCorrelationTaskId into the HttpWebhookUsageSink for each client', () => {
    createLlmClientMock.mockReturnValue({ generate: vi.fn() });
    getDefaultAllowlistPricingMock.mockReturnValue({
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    });

    const getCorrelationTaskId = vi.fn().mockReturnValue('task-123');
    const models = parseValidationModels('or:google/gemma-4-31b-it:free,gemini-2.5-flash');
    buildValidationClients({
      models,
      openRouterApiKey: 'or-key',
      geminiApiKey: 'gem-key',
      usageWebhookUrl: 'http://usage',
      orchestratorSecret: 'secret',
      internalAuthToken: 'token',
      logger: fakeLogger,
      getCorrelationTaskId,
    });

    const spy = (HttpWebhookUsageSinkMock as unknown as Record<string, unknown>)[
      '_spy'
    ] as ReturnType<typeof vi.fn>;
    expect(spy).toHaveBeenCalledTimes(2);
    const sinkConfig0 = spy.mock.calls[0]?.[0] as Record<string, unknown>;
    const sinkConfig1 = spy.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(sinkConfig0['getCorrelationTaskId']).toBe(getCorrelationTaskId);
    expect(sinkConfig1['getCorrelationTaskId']).toBe(getCorrelationTaskId);
  });
});

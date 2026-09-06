import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntexuraOSError, type Logger } from '@intexuraos/common-core';
import {
  IntexAgentModels,
  LlmModels,
  LlmProviders,
  type OpenRouterModelId,
} from '@intexuraos/llm-contract';
import { FakeUsageSink } from '@intexuraos/llm-pricing';

const mockGenerateClient = { generate: vi.fn() };
const mockToolClient = { callTool: vi.fn() };

vi.mock('../openRouterGenerateClient.js', () => ({
  createOpenRouterGenerateClient: vi.fn(() => mockGenerateClient),
}));

vi.mock('@intexuraos/infra-openrouter', () => ({
  createOpenRouterToolCallingClient: vi.fn(() => mockToolClient),
}));

const { createLlmClient, createToolCallingClient, isSupportedProvider } =
  await import('../llmClientFactory.js');

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const usageSink = new FakeUsageSink();

describe('llmClientFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an OpenRouter generate client', async () => {
    const { createOpenRouterGenerateClient } = await import('../openRouterGenerateClient.js');
    const config = {
      apiKey: 'openrouter-key',
      model: IntexAgentModels.MiniMaxM3,
      userId: 'user-1',
      logger,
      usageSink,
      ownerType: 'user' as const,
      timeoutMs: 10_000,
      maxAttempts: 2,
      deadlineAtMs: 20_000,
    };

    expect(createLlmClient(config)).toBe(mockGenerateClient);
    expect(createOpenRouterGenerateClient).toHaveBeenCalledWith(config);
  });

  it.each([LlmModels.GPT54, LlmModels.ClaudeSonnet46, LlmModels.Sonar, 'unknown'])(
    'rejects non-OpenRouter model %s at runtime',
    (model) => {
      expect(() =>
        createLlmClient({
          apiKey: 'direct-key',
          model: model as OpenRouterModelId,
          userId: 'user-1',
          logger,
          usageSink,
        })
      ).toThrow(IntexuraOSError);
    }
  );

  it('recognizes only OpenRouter as a supported provider', () => {
    expect(isSupportedProvider(LlmProviders.OpenRouter)).toBe(true);
    expect(isSupportedProvider(LlmProviders.OpenAI)).toBe(false);
    expect(isSupportedProvider(LlmProviders.Anthropic)).toBe(false);
    expect(isSupportedProvider(LlmProviders.Perplexity)).toBe(false);
    expect(isSupportedProvider('unknown')).toBe(false);
  });

  it('creates an allowlisted OpenRouter tool-calling client and forwards optional policy', async () => {
    const { createOpenRouterToolCallingClient } = await import('@intexuraos/infra-openrouter');
    const client = createToolCallingClient({
      apiKey: 'openrouter-key',
      model: IntexAgentModels.Gemini36Flash,
      userId: 'user-1',
      logger,
      usageSink,
      ownerType: 'user',
      timeoutMs: 10_000,
      maxAttempts: 2,
      deadlineAtMs: 20_000,
    });

    expect(client).toBe(mockToolClient);
    expect(createOpenRouterToolCallingClient).toHaveBeenCalledWith({
      apiKey: 'openrouter-key',
      model: 'google/gemini-3.6-flash',
      userId: 'user-1',
      logger,
      usageSink,
      ownerType: 'user',
      timeoutMs: 10_000,
      maxAttempts: 2,
      deadlineAtMs: 20_000,
      evidenceModelId: IntexAgentModels.Gemini36Flash,
    });
  });

  it('omits unset optional tool-calling policy', async () => {
    const { createOpenRouterToolCallingClient } = await import('@intexuraos/infra-openrouter');
    createToolCallingClient({
      apiKey: 'openrouter-key',
      model: IntexAgentModels.MiniMaxM3,
      userId: 'user-1',
      logger,
      usageSink,
    });

    expect(createOpenRouterToolCallingClient).toHaveBeenCalledWith({
      apiKey: 'openrouter-key',
      model: 'minimax/minimax-m3',
      userId: 'user-1',
      logger,
      usageSink,
      evidenceModelId: IntexAgentModels.MiniMaxM3,
    });
  });

  it('rejects a non-allowlisted OpenRouter tool-calling model', () => {
    expect(() =>
      createToolCallingClient({
        apiKey: 'openrouter-key',
        model: 'or:unknown/model' as typeof IntexAgentModels.MiniMaxM3,
        userId: 'user-1',
        logger,
        usageSink,
      })
    ).toThrow('Unsupported LLM model: or:unknown/model');
  });

  it('rejects a direct tool-calling model at runtime', () => {
    expect(() =>
      createToolCallingClient({
        apiKey: 'direct-key',
        model: LlmModels.GPT54 as unknown as typeof IntexAgentModels.MiniMaxM3,
        userId: 'user-1',
        logger,
        usageSink,
      })
    ).toThrow(`Direct LLM model '${LlmModels.GPT54}' is disabled`);
  });
});

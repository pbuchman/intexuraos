import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import type { Google, OpenAI } from '@intexuraos/llm-contract';
import { LlmProviders } from '@intexuraos/llm-contract';
import type { ImagePromptModelConfig, PromptGenerator } from '../../domain/index.js';
import { createGeneratePromptUseCase } from '../../application/generatePrompt.js';
import { FakeUserServiceClient, FakePromptGenerator, createFakeLogger } from '../fakes.js';

const fakeLogger = createFakeLogger();

describe('createGeneratePromptUseCase', () => {
  const modelConfig: ImagePromptModelConfig = { provider: LlmProviders.OpenAI, modelId: 'gpt-4.1' };
  let fakeUserClient: FakeUserServiceClient;
  let fakeGenerator: FakePromptGenerator;
  let createPromptGeneratorSpy: ReturnType<
    typeof vi.fn<(provider: Google | OpenAI, apiKey: string, userId: string, logger: Logger) => PromptGenerator>
  >;

  beforeEach(() => {
    fakeUserClient = new FakeUserServiceClient();
    fakeGenerator = new FakePromptGenerator();
    createPromptGeneratorSpy = vi.fn<
      (provider: Google | OpenAI, apiKey: string, userId: string, logger: Logger) => PromptGenerator
    >(() => fakeGenerator);
    vi.clearAllMocks();
  });

  function buildUseCase(): ReturnType<typeof createGeneratePromptUseCase> {
    return createGeneratePromptUseCase(
      {
        userServiceClient: fakeUserClient,
        createPromptGenerator: createPromptGeneratorSpy,
        logger: fakeLogger,
      },
      modelConfig
    );
  }

  it('returns prompt on success', async () => {
    fakeUserClient.setApiKeys({ openai: 'sk-test-key' });
    const useCase = buildUseCase();

    const result = await useCase({ text: 'A blog about cats', model: 'gpt-4.1', userId: 'user-1' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toStrictEqual({
      title: 'Test Title',
      visualSummary: 'A test visual summary',
      prompt: 'A test prompt for image generation',
      negativePrompt: 'bad, ugly, distorted',
      parameters: {
        framing: 'centered',
        realism: 'photorealistic',
        people: 'none',
      },
    });
    expect(createPromptGeneratorSpy).toHaveBeenCalledWith(
      LlmProviders.OpenAI,
      'sk-test-key',
      'user-1',
      fakeLogger
    );
  });

  it('returns API_KEYS_UNAVAILABLE when user-service fails', async () => {
    fakeUserClient.setFailNext(true);
    const useCase = buildUseCase();

    const result = await useCase({ text: 'Some text', model: 'gpt-4.1', userId: 'user-1' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('API_KEYS_UNAVAILABLE');
  });

  it('returns MISSING_API_KEY when provider key is absent', async () => {
    fakeUserClient.setApiKeys({ google: 'google-key' });
    const useCase = buildUseCase();

    const result = await useCase({ text: 'Some text', model: 'gpt-4.1', userId: 'user-1' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MISSING_API_KEY');
    if (result.error.code !== 'MISSING_API_KEY') return;
    expect(result.error.provider).toBe(LlmProviders.OpenAI);
  });

  it('returns RATE_LIMITED when generator returns RATE_LIMITED', async () => {
    fakeUserClient.setApiKeys({ openai: 'sk-test-key' });
    fakeGenerator.setFailNext(true, 'RATE_LIMITED');
    const useCase = buildUseCase();

    const result = await useCase({ text: 'Some text', model: 'gpt-4.1', userId: 'user-1' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RATE_LIMITED');
  });

  it('returns GENERATION_FAILED for other generator errors', async () => {
    fakeUserClient.setApiKeys({ openai: 'sk-test-key' });
    fakeGenerator.setFailNext(true, 'API_ERROR');
    const useCase = buildUseCase();

    const result = await useCase({ text: 'Some text', model: 'gpt-4.1', userId: 'user-1' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('GENERATION_FAILED');
  });
});

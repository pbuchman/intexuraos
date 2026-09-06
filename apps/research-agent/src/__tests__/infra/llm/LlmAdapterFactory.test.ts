/**
 * Tests for the OpenRouter-only research adapter factory.
 */

import { describe, expect, it, vi } from 'vitest';
import { FakeUsageSink } from '@intexuraos/llm-pricing';
import type { Logger } from '@intexuraos/common-core';
import {
  DEFAULT_PLATFORM_LLM_MODEL,
  LegacyGoogleModels,
  LlmModels,
  type ResearchModel,
} from '@intexuraos/llm-contract';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};
const fakeUsageSink = new FakeUsageSink();

vi.mock('../../../infra/llm/OpenRouterAdapter.js', () => ({
  OpenRouterAdapter: class MockOpenRouterAdapter {
    apiKey: string;
    model: string;
    userId: string;
    researchId: string | undefined;

    constructor(
      apiKey: string,
      model: string,
      userId: string,
      _logger: Logger,
      _usageSink: unknown,
      researchId?: string
    ) {
      this.apiKey = apiKey;
      this.model = model;
      this.userId = userId;
      this.researchId = researchId;
    }
  },
}));

vi.mock('../../../infra/llm/ContextInferenceAdapter.js', () => ({
  ContextInferenceAdapter: class MockContextInferenceAdapter {
    constructor(
      public readonly apiKey: string,
      public readonly model: string,
      public readonly userId: string
    ) {}
  },
}));

vi.mock('../../../infra/llm/InputValidationAdapter.js', () => ({
  InputValidationAdapter: class MockInputValidationAdapter {
    constructor(
      public readonly apiKey: string,
      public readonly model: string,
      public readonly userId: string
    ) {}
  },
}));

const {
  createContextInferrer,
  createInputValidator,
  createSynthesizer,
  createTitleGenerator,
  createResearchProvider,
} = await import('../../../infra/llm/LlmAdapterFactory.js');

const ALLOWED_RESEARCH_MODEL = 'or:anthropic/claude-sonnet-4.6' as ResearchModel;

describe('LlmAdapterFactory', () => {
  describe('createResearchProvider', () => {
    it.each([
      LegacyGoogleModels.Gemini25Pro,
      LlmModels.GPT54,
      LlmModels.ClaudeOpus46,
      LlmModels.SonarPro,
    ])('rejects direct model %s', (model) => {
      expect(() =>
        createResearchProvider(
          model as unknown as ResearchModel,
          'direct-key',
          'test-user-id',
          mockLogger,
          fakeUsageSink
        )
      ).toThrow('Only allowlisted OpenRouter research models are executable');
    });

    it('rejects a non-allowlisted OpenRouter model', () => {
      expect(() =>
        createResearchProvider(
          'or:unknown/not-allowed' as ResearchModel,
          'openrouter-key',
          'test-user-id',
          mockLogger,
          fakeUsageSink
        )
      ).toThrow('Only allowlisted OpenRouter research models are executable');
    });

    it('creates OpenRouterAdapter for an allowlisted model', () => {
      const provider = createResearchProvider(
        ALLOWED_RESEARCH_MODEL,
        'openrouter-key',
        'test-user-id',
        mockLogger,
        fakeUsageSink
      );

      expect(provider).toMatchObject({
        apiKey: 'openrouter-key',
        model: ALLOWED_RESEARCH_MODEL,
        userId: 'test-user-id',
      });
    });
  });

  describe('createSynthesizer', () => {
    it('rejects a direct-provider synthesis model', () => {
      expect(() =>
        createSynthesizer(
          LlmModels.GPT54 as unknown as ResearchModel,
          'direct-key',
          'test-user-id',
          mockLogger,
          fakeUsageSink
        )
      ).toThrow('Only allowlisted OpenRouter synthesis models are executable');
    });

    it('creates OpenRouterAdapter and threads researchId', () => {
      const synthesizer = createSynthesizer(
        DEFAULT_PLATFORM_LLM_MODEL,
        'openrouter-key',
        'test-user-id',
        mockLogger,
        fakeUsageSink,
        'research-123'
      );

      expect(synthesizer).toMatchObject({
        apiKey: 'openrouter-key',
        model: DEFAULT_PLATFORM_LLM_MODEL,
        researchId: 'research-123',
      });
    });

    it('rejects an allowlisted research model outside the synthesis catalog', () => {
      expect(() =>
        createSynthesizer(
          ALLOWED_RESEARCH_MODEL,
          'openrouter-key',
          'test-user-id',
          mockLogger,
          fakeUsageSink
        )
      ).toThrow('Only allowlisted OpenRouter synthesis models are executable');
    });
  });

  describe('createTitleGenerator', () => {
    it('rejects a direct-provider title model', () => {
      expect(() =>
        createTitleGenerator(
          LlmModels.GPT54 as unknown as ResearchModel,
          'direct-key',
          'test-user-id',
          mockLogger,
          fakeUsageSink
        )
      ).toThrow('Only allowlisted OpenRouter title models are executable');
    });

    it('creates OpenRouterAdapter for title generation', () => {
      const generator = createTitleGenerator(
        ALLOWED_RESEARCH_MODEL,
        'openrouter-key',
        'test-user-id',
        mockLogger,
        fakeUsageSink
      );

      expect(generator).toMatchObject({ model: ALLOWED_RESEARCH_MODEL });
    });
  });

  describe('createContextInferrer', () => {
    it('rejects direct-provider context models', () => {
      expect(() =>
        createContextInferrer(
          LlmModels.GPT54 as unknown as ResearchModel,
          'direct-key',
          'test-user-id',
          mockLogger,
          fakeUsageSink
        )
      ).toThrow('Only allowlisted OpenRouter context models are executable');
    });

    it('creates the OpenRouter-only context adapter', () => {
      const adapter = createContextInferrer(
        DEFAULT_PLATFORM_LLM_MODEL,
        'openrouter-key',
        'test-user-id',
        mockLogger,
        fakeUsageSink
      );

      expect(adapter).toMatchObject({
        apiKey: 'openrouter-key',
        model: DEFAULT_PLATFORM_LLM_MODEL,
      });
    });
  });

  describe('createInputValidator', () => {
    it('rejects direct-provider validation models', () => {
      expect(() =>
        createInputValidator(
          LlmModels.GPT54 as unknown as ResearchModel,
          'direct-key',
          'test-user-id',
          mockLogger,
          fakeUsageSink
        )
      ).toThrow('Only allowlisted OpenRouter validation models are executable');
    });

    it('creates the OpenRouter-only validation adapter', () => {
      const adapter = createInputValidator(
        DEFAULT_PLATFORM_LLM_MODEL,
        'openrouter-key',
        'test-user-id',
        mockLogger,
        fakeUsageSink
      );

      expect(adapter).toMatchObject({
        apiKey: 'openrouter-key',
        model: DEFAULT_PLATFORM_LLM_MODEL,
      });
    });
  });
});

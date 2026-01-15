/**
 * Tests for GlmAdapter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelPricing } from '@intexuraos/llm-contract';
import { LlmModels } from '@intexuraos/llm-contract';

const mockResearch = vi.fn();
const mockGenerate = vi.fn();

const mockCreateGlmClient = vi.fn().mockReturnValue({
  research: mockResearch,
  generate: mockGenerate,
});

vi.mock('@intexuraos/infra-glm', () => ({
  createGlmClient: mockCreateGlmClient,
}));

vi.mock('@intexuraos/llm-common', () => ({
  buildSynthesisPrompt: vi.fn(),
  titlePrompt: {
    build: vi.fn(),
  },
}));

const { GlmAdapter } = await import('../../../infra/llm/GlmAdapter.js');

// Get mocked functions after import
const { buildSynthesisPrompt: mockBuildSynthesisPrompt, titlePrompt: mockTitlePrompt } =
  await import('@intexuraos/llm-common');

const testPricing: ModelPricing = {
  inputPricePerMillion: 0.6,
  outputPricePerMillion: 2.2,
  webSearchCostPerCall: 0.005,
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const createMockLogger = () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
});

describe('GlmAdapter', () => {
  let adapter: InstanceType<typeof GlmAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockLogger = createMockLogger();
    adapter = new GlmAdapter('test-key', LlmModels.Glm47, 'test-user-id', testPricing, mockLogger);
  });

  describe('constructor', () => {
    it('passes apiKey and model to client', () => {
      mockCreateGlmClient.mockClear();
      const mockLogger = createMockLogger();
      new GlmAdapter('test-key', LlmModels.Glm47, 'test-user-id', testPricing, mockLogger);

      expect(mockCreateGlmClient).toHaveBeenCalledWith({
        apiKey: 'test-key',
        model: LlmModels.Glm47,
        userId: 'test-user-id',
        pricing: testPricing,
        logger: expect.any(Object),
      });
    });

    it('accepts optional logger', () => {
      const mockLogger = createMockLogger();
      mockCreateGlmClient.mockClear();
      new GlmAdapter('test-key', LlmModels.Glm47, 'test-user-id', testPricing, mockLogger);

      expect(mockCreateGlmClient).toHaveBeenCalledWith({
        apiKey: 'test-key',
        model: LlmModels.Glm47,
        userId: 'test-user-id',
        pricing: testPricing,
        logger: expect.any(Object),
      });
    });
  });

  describe('research', () => {
    const mockUsage = { inputTokens: 100, outputTokens: 50, costUsd: 0.00017 };

    it('delegates to GLM client', async () => {
      mockResearch.mockResolvedValue({
        ok: true,
        value: { content: 'GLM research result', sources: ['https://source.com'], usage: mockUsage },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('GLM research result');
        expect(result.value.sources).toEqual(['https://source.com']);
      }
      expect(mockResearch).toHaveBeenCalledWith('Test prompt');
    });

    it('returns usage from GLM client', async () => {
      mockResearch.mockResolvedValue({
        ok: true,
        value: { content: 'Result', sources: [], usage: mockUsage },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage).toEqual(mockUsage);
      }
    });

    it('maps error codes correctly', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
        expect(result.error.message).toBe('Too many requests');
      }
    });

    it('maps INVALID_KEY error', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'INVALID_KEY', message: 'Invalid API key' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('maps OVERLOADED error', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'OVERLOADED', message: 'Service overloaded' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('OVERLOADED');
      }
    });

    it('maps CONTEXT_LENGTH error', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'CONTEXT_LENGTH', message: 'Context too long' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONTEXT_LENGTH');
      }
    });

    it('maps CONTENT_FILTERED error', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'CONTENT_FILTERED', message: 'Content was filtered' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONTENT_FILTERED');
      }
    });

    it('maps TIMEOUT error', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'TIMEOUT', message: 'Request timed out' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('maps unknown error codes to API_ERROR', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'UNKNOWN_CODE', message: 'Unknown error' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('logs research start and success', async () => {
      const mockLogger = createMockLogger();
      const loggingAdapter = new GlmAdapter('test-key', LlmModels.Glm47, 'user-id', testPricing, mockLogger);
      mockResearch.mockResolvedValue({
        ok: true,
        value: { content: 'Result', sources: [], usage: mockUsage },
      });

      await loggingAdapter.research('Test');

      expect(mockLogger.info).toHaveBeenCalledWith(
        { model: LlmModels.Glm47, promptLength: 4 },
        'GLM research started'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        { model: LlmModels.Glm47, usage: mockUsage },
        'GLM research completed'
      );
    });

    it('logs research failure', async () => {
      const mockLogger = createMockLogger();
      const loggingAdapter = new GlmAdapter('test-key', LlmModels.Glm47, 'user-id', testPricing, mockLogger);
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });

      await loggingAdapter.research('Test');

      expect(mockLogger.error).toHaveBeenCalledWith(
        { model: LlmModels.Glm47, errorCode: 'RATE_LIMITED', errorMessage: 'Too many requests' },
        'GLM research failed'
      );
    });
  });

  describe('synthesize', () => {
    const mockUsage = { inputTokens: 10, outputTokens: 20, costUsd: 0.001 };

    it('builds synthesis prompt and calls generate', async () => {
      (mockBuildSynthesisPrompt as ReturnType<typeof vi.fn> & { mockReturnValue: (val: string) => void }).mockReturnValue(
        'Synthesis: Prompt, Gemini result, '
      );
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: 'Synthesized result', usage: mockUsage },
      });

      const result = await adapter.synthesize('Prompt', [
        { model: 'gemini', content: 'Gemini result' },
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Synthesized result');
        expect(result.value.usage).toEqual({
          inputTokens: 10,
          outputTokens: 20,
          costUsd: 0.001,
        });
      }
      expect(mockGenerate).toHaveBeenCalledWith('Synthesis: Prompt, Gemini result, ');
    });

    it('includes external sources in synthesis prompt', async () => {
      (mockBuildSynthesisPrompt as ReturnType<typeof vi.fn> & { mockReturnValue: (val: string) => void }).mockReturnValue(
        'Synthesis: Prompt, Gemini, External context'
      );
      mockGenerate.mockResolvedValue({ ok: true, value: { content: 'Result', usage: mockUsage } });

      await adapter.synthesize(
        'Prompt',
        [{ model: 'gemini', content: 'Gemini' }],
        [{ content: 'External context' }]
      );

      expect(mockGenerate).toHaveBeenCalledWith('Synthesis: Prompt, Gemini, External context');
    });

    it('uses synthesis context when provided', async () => {
      (mockBuildSynthesisPrompt as ReturnType<typeof vi.fn> & { mockReturnValue: (val: string) => void }).mockReturnValue(
        'Synthesis with context: Prompt, Gemini, '
      );
      mockGenerate.mockResolvedValue({ ok: true, value: { content: 'Result', usage: mockUsage } });

      await adapter.synthesize('Prompt', [{ model: 'gemini', content: 'Gemini' }], undefined, {
        language: 'en',
        domain: 'general',
        mode: 'standard',
        synthesis_goals: ['merge'],
        missing_sections: [],
        detected_conflicts: [],
        source_preference: {
          prefer_official_over_aggregators: true,
          prefer_recent_when_time_sensitive: true,
        },
        defaults_applied: [],
        assumptions: [],
        output_format: { wants_table: false, wants_actionable_summary: true },
        safety: { high_stakes: false, required_disclaimers: [] },
        red_flags: [],
      });

      expect(mockGenerate).toHaveBeenCalledWith('Synthesis with context: Prompt, Gemini, ');
    });

    it('maps errors correctly', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'TIMEOUT', message: 'Request timed out' },
      });

      const result = await adapter.synthesize('Prompt', [{ model: 'gemini', content: 'Gemini' }]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('logs synthesis start and success', async () => {
      (mockBuildSynthesisPrompt as ReturnType<typeof vi.fn> & { mockReturnValue: (val: string) => void }).mockReturnValue('Synthesis: Prompt, Gemini, ');
      const mockLogger = createMockLogger();
      const loggingAdapter = new GlmAdapter('test-key', LlmModels.Glm47, 'user-id', testPricing, mockLogger);
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: 'Result', usage: mockUsage },
      });

      await loggingAdapter.synthesize('Prompt', [{ model: 'gemini', content: 'Gemini' }]);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { model: LlmModels.Glm47, reportCount: 1, sourceCount: 0 },
        'GLM synthesis started'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        { model: LlmModels.Glm47, usage: mockUsage },
        'GLM synthesis completed'
      );
    });

    it('logs synthesis failure', async () => {
      const mockLogger = createMockLogger();
      const loggingAdapter = new GlmAdapter('test-key', LlmModels.Glm47, 'user-id', testPricing, mockLogger);
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'INVALID_KEY', message: 'Invalid key' },
      });

      await loggingAdapter.synthesize('Prompt', [{ model: 'gemini', content: 'Gemini' }]);

      expect(mockLogger.error).toHaveBeenCalledWith(
        { model: LlmModels.Glm47, errorCode: 'INVALID_KEY', errorMessage: 'Invalid key' },
        'GLM synthesis failed'
      );
    });
  });

  describe('generateTitle', () => {
    const mockUsage = { inputTokens: 10, outputTokens: 20, costUsd: 0.001 };

    it('delegates to generate with title prompt', async () => {
      (mockTitlePrompt.build as ReturnType<typeof vi.fn> & { mockReturnValue: (val: string) => void }).mockReturnValue(
        'Generate a short, concise title (between 5 and 8 words) in the SAME LANGUAGE as the following text:\n\nTest prompt'
      );
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: '  Generated Title  ', usage: mockUsage },
      });

      const result = await adapter.generateTitle('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Generated Title');
        expect(result.value.usage.costUsd).toBe(0.001);
      }
      expect(mockGenerate).toHaveBeenCalledWith(
        'Generate a short, concise title (between 5 and 8 words) in the SAME LANGUAGE as the following text:\n\nTest prompt'
      );
    });

    it('trims whitespace from generated title', async () => {
      (mockTitlePrompt.build as ReturnType<typeof vi.fn> & { mockReturnValue: (val: string) => void }).mockReturnValue('Title prompt with Test');
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: ' \n\n  Title With Spaces \n\t ', usage: mockUsage },
      });

      const result = await adapter.generateTitle('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Title With Spaces');
      }
    });

    it('returns usage without totalTokens', async () => {
      (mockTitlePrompt.build as ReturnType<typeof vi.fn> & { mockReturnValue: (val: string) => void }).mockReturnValue('Title prompt with Test');
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: 'Title', usage: mockUsage },
      });

      const result = await adapter.generateTitle('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage).toEqual({
          inputTokens: 10,
          outputTokens: 20,
          costUsd: 0.001,
        });
      }
    });

    it('maps errors correctly', async () => {
      (mockTitlePrompt.build as ReturnType<typeof vi.fn> & { mockReturnValue: (val: string) => void }).mockReturnValue('Title prompt with Test prompt');
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'INVALID_KEY', message: 'Invalid API key' },
      });

      const result = await adapter.generateTitle('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('logs title generation start and success', async () => {
      const mockLogger = createMockLogger();
      const loggingAdapter = new GlmAdapter('test-key', LlmModels.Glm47, 'user-id', testPricing, mockLogger);
      (mockTitlePrompt.build as ReturnType<typeof vi.fn> & { mockReturnValue: (val: string) => void }).mockReturnValue('Title prompt with Test');
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: 'Title', usage: mockUsage },
      });

      await loggingAdapter.generateTitle('Test');

      expect(mockLogger.info).toHaveBeenCalledWith({ model: LlmModels.Glm47 }, 'GLM title generation started');
      expect(mockLogger.info).toHaveBeenCalledWith(
        { model: LlmModels.Glm47, usage: mockUsage },
        'GLM title generation completed'
      );
    });

    it('logs title generation failure', async () => {
      const mockLogger = createMockLogger();
      const loggingAdapter = new GlmAdapter('test-key', LlmModels.Glm47, 'user-id', testPricing, mockLogger);
      (mockTitlePrompt.build as ReturnType<typeof vi.fn> & { mockReturnValue: (val: string) => void }).mockReturnValue('Title prompt with Test');
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'OVERLOADED', message: 'Service overloaded' },
      });

      await loggingAdapter.generateTitle('Test');

      expect(mockLogger.error).toHaveBeenCalledWith(
        { model: LlmModels.Glm47, errorCode: 'OVERLOADED', errorMessage: 'Service overloaded' },
        'GLM title generation failed'
      );
    });
  });
});

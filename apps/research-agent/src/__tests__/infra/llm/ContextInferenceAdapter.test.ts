/**
 * Tests for ContextInferenceAdapter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import type { ResearchContext, SynthesisContext } from '@intexuraos/llm-common';
import { type ModelPricing, LlmModels } from '@intexuraos/llm-contract';

const mockGenerate = vi.fn();

const mockCreateGeminiClient = vi.fn().mockReturnValue({
  generate: mockGenerate,
});

vi.mock('@intexuraos/infra-gemini', () => ({
  createGeminiClient: mockCreateGeminiClient,
}));

const { ContextInferenceAdapter } = await import('../../../infra/llm/ContextInferenceAdapter.js');

const mockUsage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 };

const testPricing: ModelPricing = {
  inputPricePerMillion: 0.1,
  outputPricePerMillion: 0.4,
};

const validResearchContext: ResearchContext = {
  language: 'en',
  domain: 'technical',
  mode: 'standard',
  intent_summary: 'Test intent',
  defaults_applied: [{ key: 'k', value: 'v', reason: 'r' }],
  assumptions: ['assumption'],
  answer_style: ['practical'],
  time_scope: { as_of_date: '2024-01-01', prefers_recent_years: 2, is_time_sensitive: false },
  locale_scope: { country_or_region: 'US', jurisdiction: 'US', currency: 'USD' },
  research_plan: {
    key_questions: ['q1'],
    search_queries: ['s1'],
    preferred_source_types: ['official'],
    avoid_source_types: ['random_blogs'],
  },
  output_format: {
    wants_table: false,
    wants_steps: false,
    wants_pros_cons: false,
    wants_budget_numbers: false,
  },
  safety: { high_stakes: false, required_disclaimers: [] },
  red_flags: [],
};

const validSynthesisContext: SynthesisContext = {
  language: 'en',
  domain: 'technical',
  mode: 'standard',
  synthesis_goals: ['merge'],
  missing_sections: [],
  detected_conflicts: [],
  source_preference: {
    prefer_official_over_aggregators: true,
    prefer_recent_when_time_sensitive: false,
  },
  defaults_applied: [],
  assumptions: [],
  output_format: { wants_table: false, wants_actionable_summary: true },
  safety: { high_stakes: false, required_disclaimers: [] },
  red_flags: [],
};

function createMockLogger(): Logger & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
} {
  return {
    info: vi.fn((_obj: object, _msg?: string) => undefined),
    warn: vi.fn((_obj: object, _msg?: string) => undefined),
    error: vi.fn((_obj: object, _msg?: string) => undefined),
    debug: vi.fn((_obj: object, _msg?: string) => undefined),
  };
}

describe('ContextInferenceAdapter', () => {
  let adapter: InstanceType<typeof ContextInferenceAdapter>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
    adapter = new ContextInferenceAdapter(
      'test-key',
      LlmModels.Gemini20Flash,
      'test-user',
      testPricing,
      mockLogger
    );
  });

  describe('constructor', () => {
    it('passes apiKey, model, and userId to client', () => {
      mockCreateGeminiClient.mockClear();
      new ContextInferenceAdapter('test-key', LlmModels.Gemini20Flash, 'test-user', testPricing, mockLogger);

      expect(mockCreateGeminiClient).toHaveBeenCalledWith({
        apiKey: 'test-key',
        model: LlmModels.Gemini20Flash,
        userId: 'test-user',
        pricing: testPricing,
      });
    });
  });

  describe('inferResearchContext', () => {
    it('returns parsed context on success', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: JSON.stringify(validResearchContext), usage: mockUsage },
      });

      const result = await adapter.inferResearchContext('Test query');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.context.domain).toBe('technical');
        expect(result.value.context.language).toBe('en');
        expect(result.value.usage.costUsd).toBe(mockUsage.costUsd);
      }
      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('Test query'));
    });

    it('passes options to prompt builder', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: JSON.stringify(validResearchContext), usage: mockUsage },
      });

      await adapter.inferResearchContext('Query', {
        asOfDate: '2024-06-15',
        defaultCountryOrRegion: 'UK',
      });

      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('2024-06-15'));
    });

    it('returns error when generate fails', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });

      const result = await adapter.inferResearchContext('Test query');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
        expect(result.error.message).toBe('Too many requests');
      }
    });

    it('maps unknown error codes to API_ERROR', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'UNKNOWN_CODE', message: 'Unknown' },
      });

      const result = await adapter.inferResearchContext('Test query');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('returns error and logs warn message on invalid JSON', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: 'not valid json', usage: mockUsage },
      });

      const result = await adapter.inferResearchContext('Test query');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('JSON parse failed');
      }
      const warnCall = mockLogger.warn.mock.calls[0];
      expect(warnCall).toBeDefined();
      const logData = warnCall?.[0] as Record<string, unknown>;
      expect(logData['llmResponse']).toBe('not valid json');
      expect(logData['operation']).toBe('inferResearchContext');
      expect(logData['errorMessage']).toContain('JSON parse failed');
      expect(warnCall?.[1]).toBe('LLM parse error in inferResearchContext: JSON parse failed');
    });

    it('returns error on schema mismatch', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: JSON.stringify({ invalid: 'schema' }), usage: mockUsage },
      });

      const result = await adapter.inferResearchContext('Test query');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('does not match expected schema');
        expect(result.error.message).toContain('Expected:');
      }
    });

    it('strips markdown code blocks from response', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: {
          content: '```json\n' + JSON.stringify(validResearchContext) + '\n```',
          usage: mockUsage,
        },
      });

      const result = await adapter.inferResearchContext('Test query');

      expect(result.ok).toBe(true);
    });

    it('strips plain code blocks from response', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: {
          content: '```\n' + JSON.stringify(validResearchContext) + '\n```',
          usage: mockUsage,
        },
      });

      const result = await adapter.inferResearchContext('Test query');

      expect(result.ok).toBe(true);
    });

    it('logs warning on parse failure', async () => {
      const adapterWithLogger = new ContextInferenceAdapter('key', 'model', 'test-user', testPricing, mockLogger);
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: 'invalid json', usage: mockUsage },
      });

      const result = await adapterWithLogger.inferResearchContext('Test query');

      expect(result.ok).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: 'JSON parse failed: Invalid JSON in response',
          llmResponse: 'invalid json',
          operation: 'inferResearchContext',
          responseLength: 12,
        }),
        'LLM parse error in inferResearchContext: JSON parse failed'
      );
    });
  });

  describe('inferSynthesisContext', () => {
    it('returns parsed context on success', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: JSON.stringify(validSynthesisContext), usage: mockUsage },
      });

      const result = await adapter.inferSynthesisContext({
        originalPrompt: 'Test prompt',
        reports: [{ model: 'gpt', content: 'GPT result' }],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.context.domain).toBe('technical');
        expect(result.value.context.synthesis_goals).toContain('merge');
        expect(result.value.usage.costUsd).toBe(mockUsage.costUsd);
      }
    });

    it('returns error when generate fails', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'TIMEOUT', message: 'Request timed out' },
      });

      const result = await adapter.inferSynthesisContext({
        originalPrompt: 'Test prompt',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('returns error and logs warn message on invalid JSON', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: '{ malformed json', usage: mockUsage },
      });

      const result = await adapter.inferSynthesisContext({
        originalPrompt: 'Test prompt',
      });

      expect(result.ok).toBe(false);
      const warnCall = mockLogger.warn.mock.calls[0];
      expect(warnCall).toBeDefined();
      const logData = warnCall?.[0] as Record<string, unknown>;
      expect(logData['llmResponse']).toBe('{ malformed json');
      expect(logData['operation']).toBe('inferSynthesisContext');
      expect(typeof logData['errorMessage']).toBe('string');
      expect(warnCall?.[1]).toBe('LLM parse error in inferSynthesisContext: JSON parse failed');
    });

    it('returns error on schema mismatch', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: JSON.stringify({ wrong: 'structure' }), usage: mockUsage },
      });

      const result = await adapter.inferSynthesisContext({
        originalPrompt: 'Test prompt',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('does not match expected schema');
      }
    });

    it('logs warning on parse failure', async () => {
      const adapterWithLogger = new ContextInferenceAdapter('key', 'model', 'test-user', testPricing, mockLogger);
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: '{ invalid }', usage: mockUsage },
      });

      const result = await adapterWithLogger.inferSynthesisContext({
        originalPrompt: 'Test prompt',
      });

      expect(result.ok).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: 'JSON parse failed: Invalid JSON in response',
          llmResponse: '{ invalid }',
          operation: 'inferSynthesisContext',
          responseLength: 11,
        }),
        'LLM parse error in inferSynthesisContext: JSON parse failed'
      );
    });

    it('includes additional sources in prompt', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: JSON.stringify(validSynthesisContext), usage: mockUsage },
      });

      await adapter.inferSynthesisContext({
        originalPrompt: 'Test prompt',
        additionalSources: [{ content: 'External data', label: 'Source A' }],
      });

      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('External data'));
    });
  });

  describe('error code mapping', () => {
    const validCodes = ['API_ERROR', 'TIMEOUT', 'INVALID_KEY', 'RATE_LIMITED'] as const;

    for (const code of validCodes) {
      it(`preserves ${code} error code`, async () => {
        mockGenerate.mockResolvedValue({
          ok: false,
          error: { code, message: 'Test message' },
        });

        const result = await adapter.inferResearchContext('Test query');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe(code);
        }
      });
    }
  });
});

/**
 * Tests for ContextInferenceAdapter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger, ResearchContext, SynthesisContext } from '@intexuraos/common-core';

const mockGenerate = vi.fn();

const mockCreateGeminiClient = vi.fn().mockReturnValue({
  generate: mockGenerate,
});

vi.mock('@intexuraos/infra-gemini', () => ({
  createGeminiClient: mockCreateGeminiClient,
}));

const { ContextInferenceAdapter } = await import('../../../infra/llm/ContextInferenceAdapter.js');

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
    adapter = new ContextInferenceAdapter('test-key', 'gemini-2.0-flash', mockLogger);
  });

  describe('constructor', () => {
    it('passes apiKey and model to client', () => {
      mockCreateGeminiClient.mockClear();
      new ContextInferenceAdapter('test-key', 'gemini-2.0-flash');

      expect(mockCreateGeminiClient).toHaveBeenCalledWith({
        apiKey: 'test-key',
        model: 'gemini-2.0-flash',
      });
    });
  });

  describe('inferResearchContext', () => {
    it('returns parsed context on success', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: JSON.stringify(validResearchContext),
      });

      const result = await adapter.inferResearchContext('Test query');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.domain).toBe('technical');
        expect(result.value.language).toBe('en');
      }
      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('Test query'));
    });

    it('passes options to prompt builder', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: JSON.stringify(validResearchContext),
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

    it('returns error and logs warning on invalid JSON', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: 'not valid json',
      });

      const result = await adapter.inferResearchContext('Test query');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('JSON parse error');
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('JSON parse error') }),
        'Failed to parse research context'
      );
    });

    it('returns error on schema mismatch', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: JSON.stringify({ invalid: 'schema' }),
      });

      const result = await adapter.inferResearchContext('Test query');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('does not match expected schema');
      }
    });

    it('strips markdown code blocks from response', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: '```json\n' + JSON.stringify(validResearchContext) + '\n```',
      });

      const result = await adapter.inferResearchContext('Test query');

      expect(result.ok).toBe(true);
    });

    it('strips plain code blocks from response', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: '```\n' + JSON.stringify(validResearchContext) + '\n```',
      });

      const result = await adapter.inferResearchContext('Test query');

      expect(result.ok).toBe(true);
    });

    it('works without logger', async () => {
      const adapterNoLogger = new ContextInferenceAdapter('key', 'model');
      mockGenerate.mockResolvedValue({
        ok: true,
        value: 'invalid json',
      });

      const result = await adapterNoLogger.inferResearchContext('Test query');

      expect(result.ok).toBe(false);
    });
  });

  describe('inferSynthesisContext', () => {
    it('returns parsed context on success', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: JSON.stringify(validSynthesisContext),
      });

      const result = await adapter.inferSynthesisContext({
        originalPrompt: 'Test prompt',
        reports: [{ model: 'gpt', content: 'GPT result' }],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.domain).toBe('technical');
        expect(result.value.synthesis_goals).toContain('merge');
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

    it('returns error and logs warning on invalid JSON', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: '{ malformed json',
      });

      const result = await adapter.inferSynthesisContext({
        originalPrompt: 'Test prompt',
      });

      expect(result.ok).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('JSON parse error') }),
        'Failed to parse synthesis context'
      );
    });

    it('returns error on schema mismatch', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: JSON.stringify({ wrong: 'structure' }),
      });

      const result = await adapter.inferSynthesisContext({
        originalPrompt: 'Test prompt',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('does not match expected schema');
      }
    });

    it('works without logger on parse failure', async () => {
      const adapterNoLogger = new ContextInferenceAdapter('key', 'model');
      mockGenerate.mockResolvedValue({
        ok: true,
        value: '{ invalid }',
      });

      const result = await adapterNoLogger.inferSynthesisContext({
        originalPrompt: 'Test prompt',
      });

      expect(result.ok).toBe(false);
    });

    it('includes additional sources in prompt', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: JSON.stringify(validSynthesisContext),
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

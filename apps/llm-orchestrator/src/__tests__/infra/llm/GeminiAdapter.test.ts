/**
 * Tests for GeminiAdapter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResearch = vi.fn();
const mockGenerate = vi.fn();

const mockCreateGeminiClient = vi.fn().mockReturnValue({
  research: mockResearch,
  generate: mockGenerate,
});

vi.mock('@intexuraos/infra-gemini', () => ({
  createGeminiClient: mockCreateGeminiClient,
}));

const { GeminiAdapter } = await import('../../../infra/llm/GeminiAdapter.js');

const mockTracker = {
  track: vi.fn(),
};

const mockUsage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 };

describe('GeminiAdapter', () => {
  let adapter: InstanceType<typeof GeminiAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GeminiAdapter('test-key', 'gemini-2.5-pro', 'test-user-id', mockTracker);
  });

  describe('constructor', () => {
    it('passes apiKey and model to client', () => {
      mockCreateGeminiClient.mockClear();
      new GeminiAdapter('test-key', 'gemini-2.5-pro', 'test-user-id');

      expect(mockCreateGeminiClient).toHaveBeenCalledWith({
        apiKey: 'test-key',
        model: 'gemini-2.5-pro',
        userId: 'test-user-id',
      });
    });

    it('works without tracker', async () => {
      mockResearch.mockResolvedValue({
        ok: true,
        value: { content: 'Result', sources: [], usage: mockUsage },
      });

      const adapterNoTracker = new GeminiAdapter('test-key', 'gemini-2.5-pro', 'test-user-id');
      const result = await adapterNoTracker.research('Test');

      expect(result.ok).toBe(true);
    });
  });

  describe('research', () => {
    it('delegates to Gemini client', async () => {
      mockResearch.mockResolvedValue({
        ok: true,
        value: { content: 'Research result', sources: ['https://source.com'], usage: mockUsage },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Research result');
      }
      expect(mockResearch).toHaveBeenCalledWith('Test prompt');
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
  });

  describe('synthesize', () => {
    it('builds synthesis prompt and calls generate', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: 'Synthesized result', usage: mockUsage },
      });

      const result = await adapter.synthesize('Prompt', [{ model: 'gpt', content: 'GPT result' }]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Synthesized result');
      }
      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('Prompt'));
      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('GPT result'));
    });

    it('includes external reports in synthesis prompt', async () => {
      mockGenerate.mockResolvedValue({ ok: true, value: { content: 'Result', usage: mockUsage } });

      await adapter.synthesize(
        'Prompt',
        [{ model: 'gpt', content: 'GPT' }],
        [{ content: 'External context' }]
      );

      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('External context'));
    });

    it('uses synthesis context when provided', async () => {
      mockGenerate.mockResolvedValue({ ok: true, value: { content: 'Result', usage: mockUsage } });

      await adapter.synthesize('Prompt', [{ model: 'gpt', content: 'GPT' }], undefined, {
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

      expect(mockGenerate).toHaveBeenCalled();
    });

    it('maps errors correctly', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'TIMEOUT', message: 'Request timed out' },
      });

      const result = await adapter.synthesize('Prompt', [{ model: 'gpt', content: 'GPT' }]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });
  });

  describe('generateTitle', () => {
    it('delegates to generate with title prompt', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: '  Generated Title  ', usage: mockUsage },
      });

      const result = await adapter.generateTitle('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Generated Title');
      }
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.stringContaining('Generate a short, concise title')
      );
      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('CRITICAL REQUIREMENTS'));
      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('Test prompt'));
    });

    it('maps errors correctly', async () => {
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
  });

  describe('generateContextLabel', () => {
    it('generates label for short content', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: '  Context label  ', usage: mockUsage },
      });

      const result = await adapter.generateContextLabel('Short context content');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Context label');
      }
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.stringContaining('Generate a very short label')
      );
      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('Short context content'));
    });

    it('truncates long content to 2000 characters', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: 'Long content label', usage: mockUsage },
      });

      const longContent = 'x'.repeat(3000);
      await adapter.generateContextLabel(longContent);

      const calledArg = mockGenerate.mock.calls[0]?.[0] as string;
      expect(calledArg).toContain('x'.repeat(2000));
      expect(calledArg).toContain('...');
      expect(calledArg).not.toContain('x'.repeat(2001));
    });

    it('maps errors correctly', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });

      const result = await adapter.generateContextLabel('Content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });
  });
});

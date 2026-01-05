/**
 * Tests for ClaudeAdapter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResearch = vi.fn();
const mockGenerate = vi.fn();

const mockCreateClaudeClient = vi.fn().mockReturnValue({
  research: mockResearch,
  generate: mockGenerate,
});

vi.mock('@intexuraos/infra-claude', () => ({
  createClaudeClient: mockCreateClaudeClient,
}));

const { ClaudeAdapter } = await import('../../../infra/llm/ClaudeAdapter.js');

const mockTracker = {
  track: vi.fn(),
};

describe('ClaudeAdapter', () => {
  let adapter: InstanceType<typeof ClaudeAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClaudeAdapter(
      'test-key',
      'claude-opus-4-5-20251101',
      'test-user-id',
      mockTracker
    );
  });

  describe('constructor', () => {
    it('passes apiKey and model to client', () => {
      mockCreateClaudeClient.mockClear();
      new ClaudeAdapter('test-key', 'claude-opus-4-5-20251101', 'test-user-id');

      expect(mockCreateClaudeClient).toHaveBeenCalledWith({
        apiKey: 'test-key',
        model: 'claude-opus-4-5-20251101',
        userId: 'test-user-id',
      });
    });
  });

  describe('research', () => {
    const mockUsage = { inputTokens: 100, outputTokens: 50 };

    it('delegates to Claude client', async () => {
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
    const mockUsage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 };

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
    const mockUsage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 };

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
      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('SAME LANGUAGE'));
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
});

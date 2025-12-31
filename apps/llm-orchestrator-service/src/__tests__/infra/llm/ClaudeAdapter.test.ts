/**
 * Tests for ClaudeAdapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResearch = vi.fn();
const mockSynthesize = vi.fn();
const mockGenerateTitle = vi.fn();

vi.mock('@intexuraos/infra-claude', () => ({
  createClaudeClient: vi.fn().mockReturnValue({
    research: mockResearch,
    synthesize: mockSynthesize,
    generateTitle: mockGenerateTitle,
  }),
}));

const { ClaudeAdapter } = await import('../../../infra/llm/ClaudeAdapter.js');

describe('ClaudeAdapter', () => {
  let adapter: InstanceType<typeof ClaudeAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClaudeAdapter('test-key');
  });

  describe('research', () => {
    it('delegates to Claude client', async () => {
      mockResearch.mockResolvedValue({
        ok: true,
        value: { content: 'Research result', sources: ['https://source.com'] },
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
    it('delegates to Claude client', async () => {
      mockSynthesize.mockResolvedValue({
        ok: true,
        value: 'Synthesized result',
      });

      const result = await adapter.synthesize('Prompt', [{ model: 'gpt', content: 'GPT result' }]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Synthesized result');
      }
    });

    it('passes input contexts when provided', async () => {
      mockSynthesize.mockResolvedValue({ ok: true, value: 'Result' });

      await adapter.synthesize(
        'Prompt',
        [{ model: 'gpt', content: 'GPT' }],
        [{ content: 'External context' }]
      );

      expect(mockSynthesize).toHaveBeenCalledWith(
        'Prompt',
        [{ model: 'gpt', content: 'GPT' }],
        [{ content: 'External context' }]
      );
    });

    it('maps errors correctly', async () => {
      mockSynthesize.mockResolvedValue({
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
    it('delegates to Claude client', async () => {
      mockGenerateTitle.mockResolvedValue({
        ok: true,
        value: 'Generated Title',
      });

      const result = await adapter.generateTitle('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Generated Title');
      }
    });

    it('maps errors correctly', async () => {
      mockGenerateTitle.mockResolvedValue({
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

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

describe('ClaudeAdapter', () => {
  let adapter: InstanceType<typeof ClaudeAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClaudeAdapter('test-key');
  });

  describe('constructor', () => {
    it('passes researchModel to client when provided', () => {
      mockCreateClaudeClient.mockClear();
      new ClaudeAdapter('test-key', 'claude-3-haiku-20240307');

      expect(mockCreateClaudeClient).toHaveBeenCalledWith({
        apiKey: 'test-key',
        researchModel: 'claude-3-haiku-20240307',
      });
    });

    it('does not pass researchModel when not provided', () => {
      mockCreateClaudeClient.mockClear();
      new ClaudeAdapter('test-key');

      expect(mockCreateClaudeClient).toHaveBeenCalledWith({
        apiKey: 'test-key',
      });
    });
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
    it('builds synthesis prompt and calls generate', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: 'Synthesized result',
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
      mockGenerate.mockResolvedValue({ ok: true, value: 'Result' });

      await adapter.synthesize(
        'Prompt',
        [{ model: 'gpt', content: 'GPT' }],
        [{ content: 'External context' }]
      );

      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('External context'));
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
        value: '  Generated Title  ',
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

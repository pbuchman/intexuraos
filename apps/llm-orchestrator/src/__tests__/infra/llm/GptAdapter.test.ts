/**
 * Tests for GptAdapter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResearch = vi.fn();
const mockGenerate = vi.fn();

vi.mock('@intexuraos/infra-gpt', () => ({
  createGptClient: vi.fn().mockReturnValue({
    research: mockResearch,
    generate: mockGenerate,
  }),
}));

const { GptAdapter } = await import('../../../infra/llm/GptAdapter.js');

describe('GptAdapter', () => {
  let adapter: InstanceType<typeof GptAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GptAdapter('test-key');
  });

  describe('research', () => {
    it('delegates to GPT client', async () => {
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

      const result = await adapter.synthesize('Prompt', [
        { model: 'claude', content: 'Claude result' },
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Synthesized result');
      }
      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('Prompt'));
      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('Claude result'));
    });

    it('includes external reports in synthesis prompt', async () => {
      mockGenerate.mockResolvedValue({ ok: true, value: 'Result' });

      await adapter.synthesize(
        'Prompt',
        [{ model: 'claude', content: 'Claude' }],
        [{ content: 'External context' }]
      );

      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('External context'));
    });

    it('maps errors correctly', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'TIMEOUT', message: 'Request timed out' },
      });

      const result = await adapter.synthesize('Prompt', [{ model: 'claude', content: 'Claude' }]);

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

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

describe('GeminiAdapter', () => {
  let adapter: InstanceType<typeof GeminiAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GeminiAdapter('test-key', 'gemini-2.5-pro');
  });

  describe('constructor', () => {
    it('passes apiKey and model to client', () => {
      mockCreateGeminiClient.mockClear();
      new GeminiAdapter('test-key', 'gemini-2.5-pro');

      expect(mockCreateGeminiClient).toHaveBeenCalledWith({
        apiKey: 'test-key',
        model: 'gemini-2.5-pro',
      });
    });
  });

  describe('research', () => {
    it('delegates to Gemini client', async () => {
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
        value: '  Context label  ',
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
        value: 'Long content label',
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

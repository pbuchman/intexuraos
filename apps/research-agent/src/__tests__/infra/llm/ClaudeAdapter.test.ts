/**
 * Tests for ClaudeAdapter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmModels } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import { FakeUsageSink } from '@intexuraos/llm-pricing';

const mockResearch = vi.fn();

const mockCreateClaudeClient = vi.fn().mockReturnValue({
  research: mockResearch,
});

vi.mock('@intexuraos/infra-claude', () => ({
  createClaudeClient: mockCreateClaudeClient,
}));

const { ClaudeAdapter } = await import('../../../infra/llm/ClaudeAdapter.js');

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

describe('ClaudeAdapter', () => {
  let adapter: InstanceType<typeof ClaudeAdapter>;
  let fakeUsageSink: FakeUsageSink;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeUsageSink = new FakeUsageSink();
    adapter = new ClaudeAdapter(
      'test-key',
      LlmModels.ClaudeOpus46,
      'test-user-id',
      mockLogger,
      fakeUsageSink
    );
  });

  describe('constructor', () => {
    it('passes apiKey and model to client', () => {
      mockCreateClaudeClient.mockClear();
      new ClaudeAdapter(
        'test-key',
        LlmModels.ClaudeOpus46,
        'test-user-id',
        mockLogger,
        fakeUsageSink
      );

      expect(mockCreateClaudeClient).toHaveBeenCalledWith({
        apiKey: 'test-key',
        model: LlmModels.ClaudeOpus46,
        userId: 'test-user-id',
        logger: mockLogger,
        usageSink: fakeUsageSink,
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
      expect(mockResearch).toHaveBeenCalledWith(
        expect.stringContaining('Test prompt'),
        { promptType: 'research-web-search' }
      );
    });

    it('threads researchId through per-call correlation when provided', async () => {
      mockResearch.mockResolvedValue({
        ok: true,
        value: { content: 'Research result', sources: [], usage: mockUsage },
      });

      await adapter.research('Test prompt', undefined, { researchId: 'r-1', promptType: 'research-web-search' });

      expect(mockResearch).toHaveBeenCalledWith(
        expect.stringContaining('Test prompt'),
        { promptType: 'research-web-search', correlation: { researchId: 'r-1' } }
      );
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
});

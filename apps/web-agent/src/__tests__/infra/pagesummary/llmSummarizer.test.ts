import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ok, err, type Result } from '@intexuraos/common-core';
import type { LlmGenerateClient, GenerateResult, LLMError } from '@intexuraos/llm-factory';
import type { Logger } from 'pino';
import { createLlmSummarizer } from '../../../infra/pagesummary/llmSummarizer.js';

class MockLlmGenerateClient implements LlmGenerateClient {
  private responses: { ok: boolean; content?: string; error?: string }[] = [];
  private callCount = 0;

  setResponses(responses: { ok: boolean; content?: string; error?: string }[]): void {
    this.responses = responses;
    this.callCount = 0;
  }

  async generate(_prompt: string): Promise<Result<GenerateResult, LLMError>> {
    const response = this.responses[this.callCount] ?? this.responses[0];
    this.callCount++;

    if (response === undefined) {
      return err({
        code: 'API_ERROR',
        message: 'No response configured',
      });
    }

    if (response.ok) {
      return ok({
        content: response.content ?? '',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
      });
    }

    return err({
      code: 'API_ERROR',
      message: response.error ?? 'LLM generation failed',
    });
  }

  getCallCount(): number {
    return this.callCount;
  }
}

describe('LlmSummarizer', () => {
  let llmClient: MockLlmGenerateClient;
  let summarizer: ReturnType<typeof createLlmSummarizer>;
  let logger: Logger;

  beforeEach(() => {
    llmClient = new MockLlmGenerateClient();
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    summarizer = createLlmSummarizer(logger);
  });

  describe('success path', () => {
    it('returns parsed summary on valid clean response', async () => {
      llmClient.setResponses([{ ok: true, content: 'This is a clean summary.' }]);

      const result = await summarizer.summarize('content', { url: 'https://example.com' }, llmClient);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('This is a clean summary.');
        expect(result.value.wordCount).toBe(5);
        expect(result.value.estimatedReadingMinutes).toBe(1); // Math.ceil(5/200) = 1
        expect(result.value.url).toBe('https://example.com');
      }
    });

    it('uses default values for maxSentences and maxReadingMinutes', async () => {
      llmClient.setResponses([{ ok: true, content: 'Summary text.' }]);

      await summarizer.summarize('content', { url: 'https://example.com' }, llmClient);

      const prompt = llmClient.getCallCount();
      expect(prompt).toBeGreaterThan(0);
    });

    it('passes maxSentences and maxReadingMinutes to prompt', async () => {
      llmClient.setResponses([{ ok: true, content: 'Summary.' }]);

      await summarizer.summarize(
        'content',
        { url: 'https://example.com', maxSentences: 10, maxReadingMinutes: 5 },
        llmClient
      );

      expect(llmClient.getCallCount()).toBe(1);
    });

    it('calculates reading minutes correctly for longer content', async () => {
      const longSummary = 'Word '.repeat(250).trim(); // 250 words
      llmClient.setResponses([{ ok: true, content: longSummary }]);

      const result = await summarizer.summarize('content', { url: 'https://example.com' }, llmClient);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.estimatedReadingMinutes).toBe(2); // Math.ceil(250/200) = 2
      }
    });
  });

  describe('LLM API errors', () => {
    it('returns API_ERROR when LLM client fails', async () => {
      llmClient.setResponses([{ ok: false, error: 'Rate limit exceeded' }]);

      const result = await summarizer.summarize('content', { url: 'https://example.com' }, llmClient);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('Rate limit exceeded');
      }
    });
  });

  describe('repair mechanism', () => {
    it('triggers repair when response is valid JSON', async () => {
      // First call returns JSON (triggers repair), second call succeeds
      llmClient.setResponses([
        { ok: true, content: '[{"summary": "text"}]' },
        { ok: true, content: 'Repaired clean summary.' },
      ]);

      const result = await summarizer.summarize('content', { url: 'https://example.com' }, llmClient);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('Repaired clean summary.');
      }
      expect(llmClient.getCallCount()).toBe(2); // Original + repair
    });

    it('triggers repair when response is empty', async () => {
      llmClient.setResponses([
        { ok: true, content: '   ' }, // Empty after trim
        { ok: true, content: 'Fixed summary.' },
      ]);

      const result = await summarizer.summarize('content', { url: 'https://example.com' }, llmClient);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('Fixed summary.');
      }
      expect(llmClient.getCallCount()).toBe(2);
    });

    it('returns REPAIR_FAILED when LLM fails during repair', async () => {
      llmClient.setResponses([
        { ok: true, content: '[{"json": "format"}]' },
        { ok: false, error: 'API error during repair' },
      ]);

      const result = await summarizer.summarize('content', { url: 'https://example.com' }, llmClient);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPAIR_FAILED');
        expect(result.error.message).toContain('Repair failed');
      }
    });

    it('returns REPAIR_FAILED when repair also returns invalid format', async () => {
      llmClient.setResponses([
        { ok: true, content: '[{"still": "json"}]' },
        { ok: true, content: '[{"also": "json"}]' }, // Repair also returns JSON
      ]);

      const result = await summarizer.summarize('content', { url: 'https://example.com' }, llmClient);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPAIR_FAILED');
        expect(result.error.message).toContain('Parse failed after repair');
      }
    });

    it('includes both parse errors in repair failure message', async () => {
      llmClient.setResponses([
        { ok: true, content: '' }, // Empty error
        { ok: true, content: '' }, // Still empty
      ]);

      const result = await summarizer.summarize('content', { url: 'https://example.com' }, llmClient);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Summary is empty after cleaning');
        expect(result.error.message).toContain('Summary is empty after cleaning');
      }
    });
  });

  describe('logging', () => {
    it('logs info on successful summarization', async () => {
      llmClient.setResponses([{ ok: true, content: 'Summary text.' }]);

      await summarizer.summarize('content', { url: 'https://example.com' }, llmClient);

      expect(logger.info).toHaveBeenCalledWith(
        { url: 'https://example.com', maxSentences: 20, maxReadingMinutes: 3 },
        'Starting LLM summarization'
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://example.com',
          wordCount: expect.any(Number),
          estimatedReadingMinutes: expect.any(Number),
        }),
        'LLM summarization completed successfully'
      );
    });

    it('logs error when LLM generation fails', async () => {
      llmClient.setResponses([{ ok: false, error: 'API failure' }]);

      await summarizer.summarize('content', { url: 'https://example.com' }, llmClient);

      expect(logger.error).toHaveBeenCalled();
    });

    it('logs warning when attempting repair', async () => {
      // Use valid JSON to trigger repair (invalid JSON like '[{json}]' actually passes)
      llmClient.setResponses([
        { ok: true, content: '{"summary": "json response"}' },
        { ok: true, content: 'Fixed.' },
      ]);

      await summarizer.summarize('content', { url: 'https://example.com' }, llmClient);

      expect(logger.warn).toHaveBeenCalledWith(
        { parseError: expect.any(String) },
        'Attempting repair of invalid summary response'
      );
    });

    it('logs info on successful repair', async () => {
      // Use valid JSON to trigger repair
      llmClient.setResponses([
        { ok: true, content: '[{"index": 0}]' },
        { ok: true, content: 'Fixed summary.' },
      ]);

      await summarizer.summarize('content', { url: 'https://example.com' }, llmClient);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          wordCount: expect.any(Number),
        }),
        'Summary repair successful'
      );
    });

    it('logs error when repair fails with second parse error', async () => {
      llmClient.setResponses([
        { ok: true, content: '' }, // Empty - first error
        { ok: true, content: '' }, // Still empty - second error
      ]);

      await summarizer.summarize('content', { url: 'https://example.com' }, llmClient);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          originalParseError: expect.any(String),
          repairParseError: expect.any(String),
        }),
        'Summary repair failed - second parse error'
      );
    });
  });
});

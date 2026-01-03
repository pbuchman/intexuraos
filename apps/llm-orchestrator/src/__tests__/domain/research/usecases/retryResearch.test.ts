/**
 * Tests for retryResearch use case.
 * Verifies intelligent retry logic for failed research.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { retryResearch, type RetryResearchDeps } from '../../../../domain/research/usecases/retryResearch.js';
import type { Research } from '../../../../domain/research/models/index.js';

function createMockDeps(): RetryResearchDeps & {
  mockRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateLlmResult: ReturnType<typeof vi.fn>;
  };
  mockPublisher: {
    publishLlmCall: ReturnType<typeof vi.fn>;
  };
  mockRunSynthesis: ReturnType<typeof vi.fn>;
} {
  const mockRepo = {
    findById: vi.fn(),
    save: vi.fn(),
    update: vi.fn().mockResolvedValue(ok(undefined)),
    updateLlmResult: vi.fn().mockResolvedValue(ok(undefined)),
    findByUserId: vi.fn(),
    clearShareInfo: vi.fn().mockResolvedValue(ok(undefined)),
    delete: vi.fn(),
  };

  const mockPublisher = {
    publishLlmCall: vi.fn().mockResolvedValue(ok(undefined)),
  };

  const mockRunSynthesis = vi.fn().mockResolvedValue({ ok: true });

  const mockSynthesizer = {
    synthesize: vi.fn().mockResolvedValue(ok({ content: 'Synthesized result' })),
  };

  const mockNotificationSender = {
    sendResearchComplete: vi.fn().mockResolvedValue(ok(undefined)),
  };

  const mockSynthesisDeps = {
    researchRepo: mockRepo,
    synthesizer: mockSynthesizer as any,
    notificationSender: mockNotificationSender as any,
    shareStorage: null,
    shareConfig: null,
    webAppUrl: 'https://example.com',
  };

  return {
    researchRepo: mockRepo,
    llmCallPublisher: mockPublisher,
    synthesisDeps: mockSynthesisDeps,
    mockRepo,
    mockPublisher,
    mockRunSynthesis,
  };
}

function createTestResearch(overrides: Partial<Research> = {}): Research {
  return {
    id: 'research-1',
    userId: 'user-1',
    title: 'Test Research',
    prompt: 'Test research prompt',
    status: 'failed',
    selectedLlms: ['google', 'openai'],
    synthesisLlm: 'google',
    llmResults: [
      {
        provider: 'google',
        model: 'gemini-2.0-flash',
        status: 'completed',
        result: 'Google Result',
      },
      {
        provider: 'openai',
        model: 'o4-mini-deep-research',
        status: 'failed',
        error: 'Rate limit',
      },
    ],
    startedAt: '2024-01-01T10:00:00Z',
    ...overrides,
  };
}

describe('retryResearch', () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('validation', () => {
    it('returns error when research not found', async () => {
      deps.mockRepo.findById.mockResolvedValue(ok(null));

      const result = await retryResearch('nonexistent', deps);

      expect(result).toEqual({ ok: false, error: 'Research not found' });
      expect(deps.mockPublisher.publishLlmCall).not.toHaveBeenCalled();
    });

    it('returns error on repository error', async () => {
      deps.mockRepo.findById.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'Error' }));

      const result = await retryResearch('research-1', deps);

      expect(result).toEqual({ ok: false, error: 'Research not found' });
    });

    it('returns error when status is not failed', async () => {
      const research = createTestResearch({ status: 'processing' });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await retryResearch('research-1', deps);

      expect(result).toEqual({
        ok: false,
        error: 'Cannot retry research with status: processing. Only failed research can be retried.',
      });
      expect(deps.mockPublisher.publishLlmCall).not.toHaveBeenCalled();
    });

    it('retries all failed LLMs even when no successful results exist', async () => {
      const research = createTestResearch({
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'failed',
            error: 'Error 1',
          },
          {
            provider: 'openai',
            model: 'o4-mini-deep-research',
            status: 'failed',
            error: 'Error 2',
          },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await retryResearch('research-1', deps);

      expect(result).toEqual({
        ok: true,
        action: 'retrying_llms',
        retriedProviders: ['google', 'openai'],
        message: 'Retrying 2 failed LLM providers',
      });

      // Should update status to retrying
      expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
        status: 'retrying',
      });

      // Should reset both failed LLM results
      expect(deps.mockRepo.updateLlmResult).toHaveBeenCalledWith('research-1', 'google', {
        status: 'pending',
        error: undefined,
        startedAt: undefined,
        completedAt: undefined,
        durationMs: undefined,
      });
      expect(deps.mockRepo.updateLlmResult).toHaveBeenCalledWith('research-1', 'openai', {
        status: 'pending',
        error: undefined,
        startedAt: undefined,
        completedAt: undefined,
        durationMs: undefined,
      });

      // Should publish retry events for both providers
      expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledTimes(2);
    });
  });

  describe('retrying failed LLMs', () => {
    it('retries only failed LLM providers', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await retryResearch('research-1', deps);

      expect(result).toEqual({
        ok: true,
        action: 'retrying_llms',
        retriedProviders: ['openai'],
        message: 'Retrying 1 failed LLM provider',
      });

      // Should update status to retrying
      expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
        status: 'retrying',
      });

      // Should reset failed LLM result
      expect(deps.mockRepo.updateLlmResult).toHaveBeenCalledWith('research-1', 'openai', {
        status: 'pending',
        error: undefined,
        startedAt: undefined,
        completedAt: undefined,
        durationMs: undefined,
      });

      // Should publish retry event
      expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledWith({
        type: 'llm.call',
        researchId: 'research-1',
        userId: 'user-1',
        provider: 'openai',
        prompt: 'Test research prompt',
      });
    });

    it('handles multiple failed providers', async () => {
      const research = createTestResearch({
        selectedLlms: ['google', 'openai', 'anthropic'],
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Result',
          },
          {
            provider: 'openai',
            model: 'o4-mini-deep-research',
            status: 'failed',
            error: 'Error 1',
          },
          {
            provider: 'anthropic',
            model: 'claude-3-opus',
            status: 'failed',
            error: 'Error 2',
          },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await retryResearch('research-1', deps);

      expect(result).toEqual({
        ok: true,
        action: 'retrying_llms',
        retriedProviders: ['openai', 'anthropic'],
        message: 'Retrying 2 failed LLM providers',
      });

      expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledTimes(2);
      expect(deps.mockRepo.updateLlmResult).toHaveBeenCalledTimes(2);
    });

    it('marks LLM as failed if publishing fails', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));
      deps.mockPublisher.publishLlmCall.mockResolvedValue(
        err({ code: 'PUBLISH_ERROR', message: 'Failed to publish' })
      );

      const result = await retryResearch('research-1', deps);

      expect(result.ok).toBe(true);
      expect(deps.mockRepo.updateLlmResult).toHaveBeenCalledWith('research-1', 'openai', {
        status: 'failed',
        error: 'Failed to publish retry event: Failed to publish',
      });
    });
  });

  describe('synthesis handling', () => {
    it('runs synthesis when no synthesis result exists', async () => {
      const research = createTestResearch({
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Result',
          },
          {
            provider: 'openai',
            model: 'o4-mini-deep-research',
            status: 'completed',
            result: 'Result 2',
          },
        ],
        synthesizedResult: undefined,
        synthesisError: undefined,
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      // Mock runSynthesis by creating a spy on the module
      const runSynthesisSpy = vi.fn().mockResolvedValue({ ok: true });
      const depsWithSpy = { ...deps, synthesisDeps: { ...deps.synthesisDeps } };

      // Replace the actual runSynthesis call with our spy
      vi.doMock('../../../../domain/research/usecases/runSynthesis.js', () => ({
        runSynthesis: runSynthesisSpy,
      }));

      // Import after mocking
      const { retryResearch: retryWithMock } = await import(
        '../../../../domain/research/usecases/retryResearch.js'
      );

      const result = await retryWithMock('research-1', depsWithSpy);

      expect(result).toEqual({
        ok: true,
        action: 'synthesis_completed',
        message: 'Synthesis completed successfully',
      });

      vi.doUnmock('../../../../domain/research/usecases/runSynthesis.js');
    });

    it('runs synthesis when synthesis error exists', async () => {
      const research = createTestResearch({
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Result',
          },
          {
            provider: 'openai',
            model: 'o4-mini-deep-research',
            status: 'completed',
            result: 'Result 2',
          },
        ],
        synthesizedResult: undefined,
        synthesisError: 'Previous synthesis failed',
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const runSynthesisSpy = vi.fn().mockResolvedValue({ ok: true });
      vi.doMock('../../../../domain/research/usecases/runSynthesis.js', () => ({
        runSynthesis: runSynthesisSpy,
      }));

      const { retryResearch: retryWithMock } = await import(
        '../../../../domain/research/usecases/retryResearch.js'
      );

      const result = await retryWithMock('research-1', deps);

      expect(result).toEqual({
        ok: true,
        action: 'synthesis_completed',
        message: 'Synthesis completed successfully',
      });

      vi.doUnmock('../../../../domain/research/usecases/runSynthesis.js');
    });

    it('returns error when synthesis fails', async () => {
      const research = createTestResearch({
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Result',
          },
          {
            provider: 'openai',
            model: 'o4-mini-deep-research',
            status: 'completed',
            result: 'Result 2',
          },
        ],
        synthesizedResult: undefined,
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      // Configure synthesizer mock to return an error
      const mockSynthesizer = deps.synthesisDeps.synthesizer as any;
      mockSynthesizer.synthesize.mockResolvedValueOnce(err({ code: 'API_ERROR', message: 'Synthesis failed' }));

      const result = await retryResearch('research-1', deps);

      expect(result).toEqual({
        ok: false,
        error: 'Synthesis failed',
      });
    });
  });

  describe('already completed scenarios', () => {
    it('marks as completed when synthesis already exists', async () => {
      const research = createTestResearch({
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Result',
          },
          {
            provider: 'openai',
            model: 'o4-mini-deep-research',
            status: 'completed',
            result: 'Result 2',
          },
        ],
        synthesizedResult: 'Existing synthesis result',
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await retryResearch('research-1', deps);

      expect(result).toEqual({
        ok: true,
        action: 'already_completed',
        message: 'Research was already completed',
      });

      expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
        status: 'completed',
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000, // 2 hours
        synthesisError: undefined,
      });
    });

    it('handles skipSynthesis flag', async () => {
      const research = createTestResearch({
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Result',
          },
        ],
        skipSynthesis: true,
        synthesizedResult: undefined,
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await retryResearch('research-1', deps);

      expect(result).toEqual({
        ok: true,
        action: 'synthesis_skipped',
        message: 'Research completed (synthesis skipped)',
      });

      expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
        status: 'completed',
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000,
        synthesisError: undefined,
      });
    });
  });
});

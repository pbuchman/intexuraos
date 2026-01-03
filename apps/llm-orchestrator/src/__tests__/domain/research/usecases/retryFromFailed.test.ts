/**
 * Tests for retryFromFailed use case.
 * Verifies retry logic from terminal failed status.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import {
  retryFromFailed,
  type RetryFromFailedDeps,
} from '../../../../domain/research/usecases/retryFromFailed.js';
import type { Research } from '../../../../domain/research/models/index.js';

function createMockDeps(): RetryFromFailedDeps & {
  mockRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateLlmResult: ReturnType<typeof vi.fn>;
  };
  mockPublisher: {
    publishLlmCall: ReturnType<typeof vi.fn>;
  };
  mockSynthesizer: {
    synthesize: ReturnType<typeof vi.fn>;
  };
  mockNotificationSender: {
    sendResearchComplete: ReturnType<typeof vi.fn>;
  };
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

  const mockSynthesizer = {
    synthesize: vi.fn().mockResolvedValue(ok('Synthesized result')),
    generateTitle: vi.fn().mockResolvedValue(ok('Generated Title')),
  };

  const mockNotificationSender = {
    sendResearchComplete: vi.fn().mockResolvedValue(undefined),
    sendLlmFailure: vi.fn().mockResolvedValue(undefined),
  };

  return {
    researchRepo: mockRepo,
    llmCallPublisher: mockPublisher,
    synthesisDeps: {
      synthesizer: mockSynthesizer,
      notificationSender: mockNotificationSender,
      shareStorage: null,
      shareConfig: null,
      webAppUrl: 'https://app.example.com',
    },
    mockRepo,
    mockPublisher,
    mockSynthesizer,
    mockNotificationSender,
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

describe('retryFromFailed', () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('error cases', () => {
    it('returns error when research not found', async () => {
      deps.mockRepo.findById.mockResolvedValue(ok(null));

      const result = await retryFromFailed('nonexistent', deps);

      expect(result).toEqual({ ok: false, error: 'Research not found' });
      expect(deps.mockPublisher.publishLlmCall).not.toHaveBeenCalled();
    });

    it('returns error on repository error', async () => {
      deps.mockRepo.findById.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'Error' }));

      const result = await retryFromFailed('research-1', deps);

      expect(result).toEqual({ ok: false, error: 'Research not found' });
    });

    it('returns error when status is processing', async () => {
      const research = createTestResearch({ status: 'processing' });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await retryFromFailed('research-1', deps);

      expect(result).toEqual({ ok: false, error: 'Cannot retry from status: processing' });
    });

    it('returns error when status is awaiting_confirmation', async () => {
      const research = createTestResearch({ status: 'awaiting_confirmation' });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await retryFromFailed('research-1', deps);

      expect(result).toEqual({
        ok: false,
        error: 'Cannot retry from status: awaiting_confirmation',
      });
    });
  });

  describe('idempotent cases', () => {
    it('returns already_completed when status is completed', async () => {
      const research = createTestResearch({ status: 'completed' });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await retryFromFailed('research-1', deps);

      expect(result).toEqual({ ok: true, action: 'already_completed' });
      expect(deps.mockRepo.update).not.toHaveBeenCalled();
    });

    it('marks completed when nothing to retry', async () => {
      const research = createTestResearch({
        status: 'failed',
        llmResults: [
          { provider: 'google', model: 'gemini-2.0-flash', status: 'completed', result: 'Result' },
          { provider: 'openai', model: 'o4-mini', status: 'completed', result: 'Result' },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await retryFromFailed('research-1', deps);

      expect(result).toEqual({ ok: true, action: 'already_completed' });
      expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
        status: 'completed',
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000,
      });
    });
  });

  describe('retry failed LLMs', () => {
    it('resets failed LLM results to pending', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      await retryFromFailed('research-1', deps);

      expect(deps.mockRepo.updateLlmResult).toHaveBeenCalledWith('research-1', 'openai', {
        status: 'pending',
        error: undefined,
      });
    });

    it('updates research status to retrying', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      await retryFromFailed('research-1', deps);

      expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
        status: 'retrying',
        synthesisError: undefined,
      });
    });

    it('publishes LLM calls for failed providers only', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      await retryFromFailed('research-1', deps);

      expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledTimes(1);
      expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledWith({
        type: 'llm.call',
        researchId: 'research-1',
        userId: 'user-1',
        provider: 'openai',
        prompt: 'Test research prompt',
      });
    });

    it('returns success with retried_llms action', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await retryFromFailed('research-1', deps);

      expect(result).toEqual({
        ok: true,
        action: 'retried_llms',
        retriedProviders: ['openai'],
      });
    });

    it('handles multiple failed providers', async () => {
      const research = createTestResearch({
        selectedLlms: ['google', 'openai', 'anthropic'],
        llmResults: [
          { provider: 'google', model: 'gemini-2.0-flash', status: 'completed', result: 'Result' },
          { provider: 'openai', model: 'o4-mini', status: 'failed', error: 'Error 1' },
          { provider: 'anthropic', model: 'claude-3-opus', status: 'failed', error: 'Error 2' },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await retryFromFailed('research-1', deps);

      expect(result).toEqual({
        ok: true,
        action: 'retried_llms',
        retriedProviders: ['openai', 'anthropic'],
      });
      expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledTimes(2);
      expect(deps.mockRepo.updateLlmResult).toHaveBeenCalledTimes(2);
    });
  });

  describe('retry synthesis', () => {
    it('re-runs synthesis when synthesis failed but LLMs succeeded', async () => {
      const research = createTestResearch({
        status: 'failed',
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Result 1',
          },
          { provider: 'openai', model: 'o4-mini', status: 'completed', result: 'Result 2' },
        ],
        synthesisError: 'Synthesis failed: rate limit',
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await retryFromFailed('research-1', deps);

      expect(result).toEqual({ ok: true, action: 'retried_synthesis' });
      expect(deps.mockSynthesizer.synthesize).toHaveBeenCalled();
    });

    it('calls synthesizer when re-running synthesis', async () => {
      const research = createTestResearch({
        status: 'failed',
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Result 1',
          },
          { provider: 'openai', model: 'o4-mini', status: 'completed', result: 'Result 2' },
        ],
        synthesisError: 'Previous error',
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      await retryFromFailed('research-1', deps);

      expect(deps.mockSynthesizer.synthesize).toHaveBeenCalled();
    });

    it('returns error when synthesis fails again', async () => {
      const research = createTestResearch({
        status: 'failed',
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Result 1',
          },
          { provider: 'openai', model: 'o4-mini', status: 'completed', result: 'Result 2' },
        ],
        synthesisError: 'Previous error',
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));
      deps.mockSynthesizer.synthesize.mockResolvedValue(err({ message: 'Rate limit exceeded' }));

      const result = await retryFromFailed('research-1', deps);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Rate limit exceeded');
    });

    it('prioritizes LLM retry over synthesis retry', async () => {
      const research = createTestResearch({
        status: 'failed',
        llmResults: [
          { provider: 'google', model: 'gemini-2.0-flash', status: 'completed', result: 'Result' },
          { provider: 'openai', model: 'o4-mini', status: 'failed', error: 'LLM Error' },
        ],
        synthesisError: 'Synthesis also failed',
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await retryFromFailed('research-1', deps);

      expect(result.action).toBe('retried_llms');
      expect(deps.mockSynthesizer.synthesize).not.toHaveBeenCalled();
    });
  });
});

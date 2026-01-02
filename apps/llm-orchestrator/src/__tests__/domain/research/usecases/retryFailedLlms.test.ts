/**
 * Tests for retryFailedLlms use case.
 * Verifies retry logic for failed LLM providers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import {
  retryFailedLlms,
  type RetryFailedLlmsDeps,
} from '../../../../domain/research/usecases/retryFailedLlms.js';
import type { Research } from '../../../../domain/research/models/index.js';

function createMockDeps(): RetryFailedLlmsDeps & {
  mockRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateLlmResult: ReturnType<typeof vi.fn>;
  };
  mockPublisher: {
    publishLlmCall: ReturnType<typeof vi.fn>;
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

  return {
    researchRepo: mockRepo,
    llmCallPublisher: mockPublisher,
    mockRepo,
    mockPublisher,
  };
}

function createTestResearch(overrides: Partial<Research> = {}): Research {
  return {
    id: 'research-1',
    userId: 'user-1',
    title: 'Test Research',
    prompt: 'Test research prompt',
    status: 'awaiting_confirmation',
    selectedLlms: ['google', 'openai'],
    synthesisLlm: 'google',
    llmResults: [
      {
        provider: 'google',
        model: 'gemini-2.0-flash',
        status: 'completed',
        result: 'Google Result',
      },
      { provider: 'openai', model: 'o4-mini-deep-research', status: 'failed', error: 'Rate limit' },
    ],
    partialFailure: {
      failedProviders: ['openai'],
      detectedAt: '2024-01-01T10:00:00Z',
      retryCount: 0,
    },
    startedAt: '2024-01-01T10:00:00Z',
    ...overrides,
  };
}

describe('retryFailedLlms', () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns error when research not found', async () => {
    deps.mockRepo.findById.mockResolvedValue(ok(null));

    const result = await retryFailedLlms('nonexistent', deps);

    expect(result).toEqual({ ok: false, error: 'Research not found' });
    expect(deps.mockPublisher.publishLlmCall).not.toHaveBeenCalled();
  });

  it('returns error on repository error', async () => {
    deps.mockRepo.findById.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'Error' }));

    const result = await retryFailedLlms('research-1', deps);

    expect(result).toEqual({ ok: false, error: 'Research not found' });
  });

  it('returns error when status is not awaiting_confirmation', async () => {
    const research = createTestResearch({ status: 'processing' });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await retryFailedLlms('research-1', deps);

    expect(result).toEqual({ ok: false, error: 'Invalid status for retry: processing' });
  });

  it('returns error when partialFailure is undefined', async () => {
    const research: Research = {
      id: 'research-1',
      userId: 'user-1',
      title: 'Test Research',
      prompt: 'Test research prompt',
      status: 'awaiting_confirmation',
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
    };
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await retryFailedLlms('research-1', deps);

    expect(result).toEqual({ ok: false, error: 'No partial failure info found' });
  });

  it('returns error when max retries exceeded', async () => {
    const research = createTestResearch({
      partialFailure: {
        failedProviders: ['openai'],
        detectedAt: '2024-01-01T10:00:00Z',
        retryCount: 2,
      },
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await retryFailedLlms('research-1', deps);

    expect(result).toEqual({ ok: false, error: 'Maximum retry attempts exceeded' });
    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      status: 'failed',
      synthesisError: 'Maximum retry attempts exceeded',
      completedAt: '2024-01-01T12:00:00.000Z',
    });
  });

  it('resets failed LLM results to pending', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await retryFailedLlms('research-1', deps);

    expect(deps.mockRepo.updateLlmResult).toHaveBeenCalledWith('research-1', 'openai', {
      status: 'pending',
    });
  });

  it('updates research status to retrying with incremented retry count', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await retryFailedLlms('research-1', deps);

    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      status: 'retrying',
      partialFailure: {
        failedProviders: ['openai'],
        detectedAt: '2024-01-01T10:00:00Z',
        retryCount: 1,
        userDecision: 'retry',
      },
    });
  });

  it('publishes LLM calls for failed providers only', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await retryFailedLlms('research-1', deps);

    expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledTimes(1);
    expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledWith({
      type: 'llm.call',
      researchId: 'research-1',
      userId: 'user-1',
      provider: 'openai',
      prompt: 'Test research prompt',
    });
  });

  it('returns success with retried providers', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await retryFailedLlms('research-1', deps);

    expect(result).toEqual({
      ok: true,
      retriedProviders: ['openai'],
    });
  });

  it('handles multiple failed providers', async () => {
    const research = createTestResearch({
      selectedLlms: ['google', 'openai', 'anthropic'],
      llmResults: [
        { provider: 'google', model: 'gemini-2.0-flash', status: 'completed', result: 'Result' },
        { provider: 'openai', model: 'o4-mini-deep-research', status: 'failed', error: 'Error 1' },
        { provider: 'anthropic', model: 'claude-3-opus', status: 'failed', error: 'Error 2' },
      ],
      partialFailure: {
        failedProviders: ['openai', 'anthropic'],
        detectedAt: '2024-01-01T10:00:00Z',
        retryCount: 0,
      },
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await retryFailedLlms('research-1', deps);

    expect(result).toEqual({
      ok: true,
      retriedProviders: ['openai', 'anthropic'],
    });
    expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledTimes(2);
    expect(deps.mockRepo.updateLlmResult).toHaveBeenCalledTimes(2);
  });

  it('allows retry when retryCount is 1 (second retry)', async () => {
    const research = createTestResearch({
      partialFailure: {
        failedProviders: ['openai'],
        detectedAt: '2024-01-01T10:00:00Z',
        retryCount: 1,
      },
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await retryFailedLlms('research-1', deps);

    expect(result.ok).toBe(true);
    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      status: 'retrying',
      partialFailure: expect.objectContaining({
        retryCount: 2,
      }),
    });
  });
});

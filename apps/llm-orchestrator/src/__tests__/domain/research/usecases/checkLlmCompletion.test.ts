/**
 * Tests for checkLlmCompletion use case.
 * Verifies completion detection after each LLM result is stored.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import {
  checkLlmCompletion,
  type CheckLlmCompletionDeps,
} from '../../../../domain/research/usecases/checkLlmCompletion.js';
import type { Research } from '../../../../domain/research/models/index.js';

function createMockDeps(): CheckLlmCompletionDeps & {
  mockRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
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

  return {
    researchRepo: mockRepo,
    mockRepo,
  };
}

function createTestResearch(overrides: Partial<Research> = {}): Research {
  return {
    id: 'research-1',
    userId: 'user-1',
    title: 'Test Research',
    prompt: 'Test research prompt',
    status: 'processing',
    selectedModels: ['gemini-2.5-pro', 'o4-mini-deep-research'],
    synthesisModel: 'gemini-2.5-pro',
    llmResults: [
      { provider: 'google', model: 'gemini-2.5-pro', status: 'pending' },
      { provider: 'openai', model: 'o4-mini-deep-research', status: 'pending' },
    ],
    startedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('checkLlmCompletion', () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns pending when research not found', async () => {
    deps.mockRepo.findById.mockResolvedValue(ok(null));

    const result = await checkLlmCompletion('nonexistent', deps);

    expect(result).toEqual({ type: 'pending' });
    expect(deps.mockRepo.update).not.toHaveBeenCalled();
  });

  it('returns pending on repository error', async () => {
    deps.mockRepo.findById.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'Error' }));

    const result = await checkLlmCompletion('research-1', deps);

    expect(result).toEqual({ type: 'pending' });
    expect(deps.mockRepo.update).not.toHaveBeenCalled();
  });

  it('returns pending when LLMs are still in pending state', async () => {
    const research = createTestResearch({
      llmResults: [
        { provider: 'google', model: 'gemini-2.5-pro', status: 'completed', result: 'Result' },
        { provider: 'openai', model: 'o4-mini-deep-research', status: 'pending' },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await checkLlmCompletion('research-1', deps);

    expect(result).toEqual({ type: 'pending' });
    expect(deps.mockRepo.update).not.toHaveBeenCalled();
  });

  it('returns pending when LLMs are in processing state', async () => {
    const research = createTestResearch({
      llmResults: [
        { provider: 'google', model: 'gemini-2.5-pro', status: 'completed', result: 'Result' },
        { provider: 'openai', model: 'o4-mini-deep-research', status: 'processing' },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await checkLlmCompletion('research-1', deps);

    expect(result).toEqual({ type: 'pending' });
    expect(deps.mockRepo.update).not.toHaveBeenCalled();
  });

  it('returns all_completed when all LLMs completed successfully', async () => {
    const research = createTestResearch({
      llmResults: [
        {
          provider: 'google',
          model: 'gemini-2.5-pro',
          status: 'completed',
          result: 'Google Result',
        },
        {
          provider: 'openai',
          model: 'o4-mini-deep-research',
          status: 'completed',
          result: 'OpenAI Result',
        },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await checkLlmCompletion('research-1', deps);

    expect(result).toEqual({ type: 'all_completed' });
    expect(deps.mockRepo.update).not.toHaveBeenCalled();
  });

  it('returns all_failed and updates research when all LLMs failed', async () => {
    const research = createTestResearch({
      llmResults: [
        { provider: 'google', model: 'gemini-2.5-pro', status: 'failed', error: 'API Error' },
        {
          provider: 'openai',
          model: 'o4-mini-deep-research',
          status: 'failed',
          error: 'Rate limit',
        },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await checkLlmCompletion('research-1', deps);

    expect(result).toEqual({ type: 'all_failed' });
    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      status: 'failed',
      synthesisError: 'All LLM calls failed',
      completedAt: '2024-01-01T12:00:00.000Z',
    });
  });

  it('returns partial_failure when some LLMs failed', async () => {
    const research = createTestResearch({
      llmResults: [
        {
          provider: 'google',
          model: 'gemini-2.5-pro',
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
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await checkLlmCompletion('research-1', deps);

    expect(result).toEqual({ type: 'partial_failure', failedModels: ['o4-mini-deep-research'] });
    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      status: 'awaiting_confirmation',
      partialFailure: {
        failedModels: ['o4-mini-deep-research'],
        detectedAt: '2024-01-01T12:00:00.000Z',
        retryCount: 0,
      },
    });
  });

  it('preserves retry count from previous partial failure', async () => {
    const research = createTestResearch({
      partialFailure: {
        failedModels: ['o4-mini-deep-research'],
        detectedAt: '2024-01-01T10:00:00Z',
        retryCount: 1,
      },
      llmResults: [
        {
          provider: 'google',
          model: 'gemini-2.5-pro',
          status: 'completed',
          result: 'Google Result',
        },
        {
          provider: 'openai',
          model: 'o4-mini-deep-research',
          status: 'failed',
          error: 'Rate limit again',
        },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await checkLlmCompletion('research-1', deps);

    expect(result).toEqual({ type: 'partial_failure', failedModels: ['o4-mini-deep-research'] });
    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      status: 'awaiting_confirmation',
      partialFailure: {
        failedModels: ['o4-mini-deep-research'],
        detectedAt: '2024-01-01T12:00:00.000Z',
        retryCount: 1,
      },
    });
  });

  it('handles multiple failed providers', async () => {
    const research = createTestResearch({
      selectedModels: ['gemini-2.5-pro', 'o4-mini-deep-research', 'claude-opus-4-5-20251101'],
      llmResults: [
        {
          provider: 'google',
          model: 'gemini-2.5-pro',
          status: 'completed',
          result: 'Google Result',
        },
        { provider: 'openai', model: 'o4-mini-deep-research', status: 'failed', error: 'Error 1' },
        {
          provider: 'anthropic',
          model: 'claude-opus-4-5-20251101',
          status: 'failed',
          error: 'Error 2',
        },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await checkLlmCompletion('research-1', deps);

    expect(result).toEqual({
      type: 'partial_failure',
      failedModels: ['o4-mini-deep-research', 'claude-opus-4-5-20251101'],
    });
  });

  it('ignores stale llmResults for providers not in selectedModels', async () => {
    const research = createTestResearch({
      selectedModels: ['gemini-2.5-pro'],
      llmResults: [
        {
          provider: 'google',
          model: 'gemini-2.5-pro',
          status: 'completed',
          result: 'Google Result',
        },
        { provider: 'openai', model: 'o4-mini-deep-research', status: 'pending' },
        { provider: 'anthropic', model: 'claude-opus-4-5-20251101', status: 'pending' },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await checkLlmCompletion('research-1', deps);

    expect(result).toEqual({ type: 'all_completed' });
    expect(deps.mockRepo.update).not.toHaveBeenCalled();
  });
});

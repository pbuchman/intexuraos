/**
 * Tests for enhanceResearch use case.
 * Verifies creation of enhanced research from completed source.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import {
  enhanceResearch,
  type EnhanceResearchDeps,
  type EnhanceResearchInput,
} from '../../../../domain/research/usecases/enhanceResearch.js';
import type { Research } from '../../../../domain/research/models/index.js';

function createMockDeps(): EnhanceResearchDeps & {
  mockRepo: {
    findById: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
} {
  const mockRepo = {
    findById: vi.fn(),
    save: vi.fn().mockResolvedValue(ok({ id: 'new-research-id' })),
    update: vi.fn(),
    updateLlmResult: vi.fn(),
    findByUserId: vi.fn(),
    clearShareInfo: vi.fn(),
    delete: vi.fn(),
  };

  return {
    researchRepo: mockRepo,
    generateId: () => 'generated-id',
    mockRepo,
  };
}

function createCompletedResearch(overrides: Partial<Research> = {}): Research {
  return {
    id: 'source-research-id',
    userId: 'user-1',
    title: 'Original Research',
    prompt: 'Test research prompt',
    status: 'completed',
    selectedModels: [LlmModels.Gemini25Pro, LlmModels.O4MiniDeepResearch],
    synthesisModel: LlmModels.Gemini25Pro,
    llmResults: [
      {
        provider: LlmProviders.Google,
        model: LlmModels.Gemini20Flash,
        status: 'completed',
        result: 'Google result',
      },
      {
        provider: LlmProviders.OpenAI,
        model: LlmModels.O4MiniDeepResearch,
        status: 'completed',
        result: 'OpenAI result',
      },
    ],
    startedAt: '2024-01-01T00:00:00Z',
    completedAt: '2024-01-01T00:05:00Z',
    ...overrides,
  };
}

describe('enhanceResearch', () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns NOT_FOUND when source research does not exist', async () => {
    deps.mockRepo.findById.mockResolvedValue(ok(null));

    const params: EnhanceResearchInput = {
      sourceResearchId: 'nonexistent',
      userId: 'user-1',
      additionalModels: [LlmModels.ClaudeOpus45],
    };

    const result = await enhanceResearch(params, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('NOT_FOUND');
    }
  });

  it('returns REPO_ERROR when repository fails', async () => {
    deps.mockRepo.findById.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'Database error' })
    );

    const params: EnhanceResearchInput = {
      sourceResearchId: 'research-1',
      userId: 'user-1',
      additionalModels: [LlmModels.ClaudeOpus45],
    };

    const result = await enhanceResearch(params, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('REPO_ERROR');
    }
  });

  it('returns FORBIDDEN when user does not own source research', async () => {
    const source = createCompletedResearch({ userId: 'other-user' });
    deps.mockRepo.findById.mockResolvedValue(ok(source));

    const params: EnhanceResearchInput = {
      sourceResearchId: 'source-research-id',
      userId: 'user-1',
      additionalModels: [LlmModels.ClaudeOpus45],
    };

    const result = await enhanceResearch(params, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('FORBIDDEN');
    }
  });

  it('returns INVALID_STATUS when source research is not completed', async () => {
    const source = createCompletedResearch({ status: 'processing' });
    deps.mockRepo.findById.mockResolvedValue(ok(source));

    const params: EnhanceResearchInput = {
      sourceResearchId: 'source-research-id',
      userId: 'user-1',
      additionalModels: [LlmModels.ClaudeOpus45],
    };

    const result = await enhanceResearch(params, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('INVALID_STATUS');
      expect(result.error).toHaveProperty('status', 'processing');
    }
  });

  it('returns NO_CHANGES when no modifications provided', async () => {
    const source = createCompletedResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(source));

    const params: EnhanceResearchInput = {
      sourceResearchId: 'source-research-id',
      userId: 'user-1',
    };

    const result = await enhanceResearch(params, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('NO_CHANGES');
    }
  });

  it('creates enhanced research with additional LLMs', async () => {
    const source = createCompletedResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(source));
    deps.mockRepo.save.mockImplementation((research: Research) => ok(research));

    const params: EnhanceResearchInput = {
      sourceResearchId: 'source-research-id',
      userId: 'user-1',
      additionalModels: [LlmModels.ClaudeOpus45],
    };

    const result = await enhanceResearch(params, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('generated-id');
      expect(result.value.sourceResearchId).toBe('source-research-id');
      expect(result.value.selectedModels).toContain(LlmModels.ClaudeOpus45);
      expect(result.value.llmResults).toHaveLength(3);
    }
    expect(deps.mockRepo.save).toHaveBeenCalledOnce();
  });

  it('creates enhanced research with new synthesis LLM', async () => {
    const source = createCompletedResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(source));
    deps.mockRepo.save.mockImplementation((research: Research) => ok(research));

    const params: EnhanceResearchInput = {
      sourceResearchId: 'source-research-id',
      userId: 'user-1',
      synthesisModel: LlmModels.ClaudeOpus45,
    };

    const result = await enhanceResearch(params, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.synthesisModel).toBe(LlmModels.ClaudeOpus45);
    }
  });

  it('creates enhanced research with additional contexts', async () => {
    const source = createCompletedResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(source));
    deps.mockRepo.save.mockImplementation((research: Research) => ok(research));

    const params: EnhanceResearchInput = {
      sourceResearchId: 'source-research-id',
      userId: 'user-1',
      additionalContexts: [{ content: 'Additional context data' }],
    };

    const result = await enhanceResearch(params, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.inputContexts).toBeDefined();
      expect(result.value.inputContexts?.length).toBeGreaterThan(0);
    }
  });

  it('creates enhanced research with removed contexts', async () => {
    const source = createCompletedResearch({
      inputContexts: [{ id: 'ctx-1', content: 'Context 1', addedAt: '2024-01-01T00:00:00Z' }],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(source));
    deps.mockRepo.save.mockImplementation((research: Research) => ok(research));

    const params: EnhanceResearchInput = {
      sourceResearchId: 'source-research-id',
      userId: 'user-1',
      removeContextIds: ['ctx-1'],
    };

    const result = await enhanceResearch(params, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.inputContexts ?? []).toHaveLength(0);
    }
  });

  it('returns REPO_ERROR when save fails', async () => {
    const source = createCompletedResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(source));
    deps.mockRepo.save.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'Save failed' }));

    const params: EnhanceResearchInput = {
      sourceResearchId: 'source-research-id',
      userId: 'user-1',
      additionalModels: [LlmModels.ClaudeOpus45],
    };

    const result = await enhanceResearch(params, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('REPO_ERROR');
    }
  });

  it('passes synthesisModel to enhanced research', async () => {
    const source = createCompletedResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(source));
    deps.mockRepo.save.mockImplementation((research: Research) => ok(research));

    const params: EnhanceResearchInput = {
      sourceResearchId: 'source-research-id',
      userId: 'user-1',
      additionalModels: [LlmModels.ClaudeOpus45],
      synthesisModel: LlmModels.Gemini25Flash,
    };

    const result = await enhanceResearch(params, deps);

    expect(result.ok).toBe(true);
    expect(deps.mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        llmResults: expect.arrayContaining([
          expect.objectContaining({
            provider: LlmProviders.Anthropic,
            model: LlmModels.ClaudeOpus45,
          }),
        ]),
      })
    );
  });

  it('omits token and cost data from copied LLM results', async () => {
    const source = createCompletedResearch({
      llmResults: [
        {
          provider: LlmProviders.Google,
          model: LlmModels.Gemini25Pro,
          status: 'completed',
          result: 'Google result',
          inputTokens: 1000,
          outputTokens: 500,
          costUsd: 0.05,
        },
        {
          provider: LlmProviders.OpenAI,
          model: LlmModels.O4MiniDeepResearch,
          status: 'completed',
          result: 'OpenAI result',
          inputTokens: 2000,
          outputTokens: 1000,
          costUsd: 0.15,
        },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(source));
    deps.mockRepo.save.mockImplementation((research: Research) => ok(research));

    const params: EnhanceResearchInput = {
      sourceResearchId: 'source-research-id',
      userId: 'user-1',
      synthesisModel: LlmModels.ClaudeOpus45,
    };

    const result = await enhanceResearch(params, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Copied results preserve token/cost data for accurate totals
      for (const llmResult of result.value.llmResults) {
        expect(llmResult.inputTokens).toBeDefined();
        expect(llmResult.outputTokens).toBeDefined();
        expect(llmResult.costUsd).toBeDefined();
      }
      // Source costs are tracked in sourceLlmCostUsd for aggregation
      expect(result.value.sourceLlmCostUsd).toBe(0.2); // 0.05 + 0.15
    }
  });
});

/**
 * Tests for processResearch usecase.
 * The usecase dispatches LLM calls to Pub/Sub for parallel processing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok, type ResearchContext } from '@intexuraos/common-core';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import {
  processResearch,
  type ProcessResearchDeps,
} from '../../../../domain/research/usecases/processResearch.js';
import type { Research } from '../../../../domain/research/models/index.js';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

function createMockDeps(): ProcessResearchDeps & {
  mockRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  mockPublisher: {
    publishLlmCall: ReturnType<typeof vi.fn>;
  };
  mockTitleGenerator: {
    generateTitle: ReturnType<typeof vi.fn>;
    generateContextLabel: ReturnType<typeof vi.fn>;
  };
  mockReportSuccess: ReturnType<typeof vi.fn>;
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

  const mockTitleGenerator = {
    generateTitle: vi.fn().mockResolvedValue(ok('Generated Title')),
    generateContextLabel: vi.fn().mockResolvedValue(ok('Generated Label')),
  };

  const mockReportSuccess = vi.fn();

  return {
    researchRepo: mockRepo,
    llmCallPublisher: mockPublisher,
    logger: mockLogger,
    titleGenerator: mockTitleGenerator,
    reportLlmSuccess: mockReportSuccess,
    mockRepo,
    mockPublisher,
    mockTitleGenerator,
    mockReportSuccess,
  };
}

function createTestResearch(overrides: Partial<Research> = {}): Research {
  return {
    id: 'research-1',
    userId: 'user-1',
    title: 'Test Research',
    prompt: 'Test research prompt',
    status: 'pending',
    selectedModels: [LlmModels.Gemini25Pro, LlmModels.O4MiniDeepResearch],
    synthesisModel: LlmModels.Gemini25Pro,
    llmResults: [
      { provider: LlmProviders.Google, model: LlmModels.Gemini20Flash, status: 'pending' },
      { provider: LlmProviders.OpenAI, model: LlmModels.O4MiniDeepResearch, status: 'pending' },
    ],
    startedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('processResearch', () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns early if research not found', async () => {
    deps.mockRepo.findById.mockResolvedValue(ok(null));

    await processResearch('nonexistent', deps);

    expect(deps.mockRepo.update).not.toHaveBeenCalled();
    expect(deps.mockPublisher.publishLlmCall).not.toHaveBeenCalled();
  });

  it('returns early on repository error', async () => {
    deps.mockRepo.findById.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'Error' }));

    await processResearch('research-1', deps);

    expect(deps.mockRepo.update).not.toHaveBeenCalled();
    expect(deps.mockPublisher.publishLlmCall).not.toHaveBeenCalled();
  });

  it('updates status to processing and resets startedAt', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await processResearch('research-1', deps);

    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      status: 'processing',
      startedAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('generates title when titleGenerator is provided', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockTitleGenerator.generateTitle.mockResolvedValue(ok('Generated Title'));

    await processResearch('research-1', deps);

    expect(deps.mockTitleGenerator.generateTitle).toHaveBeenCalledWith('Test research prompt');
    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', { title: 'Generated Title' });
    expect(deps.mockReportSuccess).toHaveBeenCalledWith(LlmModels.Gemini25Flash);
  });

  it('uses synthesizer for title generation when titleGenerator not provided', async () => {
    const research = createTestResearch({ synthesisModel: LlmModels.ClaudeOpus4520251101 });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const mockSynthesizer = {
      generateTitle: vi.fn().mockResolvedValue(ok('Synthesizer Title')),
      synthesize: vi.fn(),
    };

    const mockReportSuccess = vi.fn();
    const depsWithSynthesizer: ProcessResearchDeps = {
      researchRepo: deps.researchRepo,
      llmCallPublisher: deps.llmCallPublisher,
      logger: mockLogger,
      synthesizer: mockSynthesizer,
      reportLlmSuccess: mockReportSuccess,
    };

    await processResearch('research-1', depsWithSynthesizer);

    expect(mockSynthesizer.generateTitle).toHaveBeenCalledWith('Test research prompt');
    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', { title: 'Synthesizer Title' });
    expect(mockReportSuccess).toHaveBeenCalledWith(LlmModels.ClaudeOpus4520251101);
  });

  it('does not update title when title generation fails', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockTitleGenerator.generateTitle.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Failed' })
    );

    await processResearch('research-1', deps);

    expect(deps.mockRepo.update).not.toHaveBeenCalledWith(
      'research-1',
      expect.objectContaining({ title: expect.any(String) })
    );
    expect(deps.mockReportSuccess).not.toHaveBeenCalled();
  });

  it('publishes LLM call for each pending provider', async () => {
    const research = createTestResearch({
      selectedModels: [LlmModels.Gemini25Pro, LlmModels.O4MiniDeepResearch, LlmModels.ClaudeOpus4520251101],
      llmResults: [
        { provider: LlmProviders.Google, model: LlmModels.Gemini20Flash, status: 'pending' },
        { provider: LlmProviders.OpenAI, model: LlmModels.O4MiniDeepResearch, status: 'pending' },
        { provider: LlmProviders.Anthropic, model: LlmModels.ClaudeSonnet420250514, status: 'pending' },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await processResearch('research-1', deps);

    expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledTimes(3);
    expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledWith({
      type: 'llm.call',
      researchId: 'research-1',
      userId: 'user-1',
      model: LlmModels.Gemini20Flash,
      prompt: 'Test research prompt',
    });
    expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledWith({
      type: 'llm.call',
      researchId: 'research-1',
      userId: 'user-1',
      model: LlmModels.O4MiniDeepResearch,
      prompt: 'Test research prompt',
    });
    expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledWith({
      type: 'llm.call',
      researchId: 'research-1',
      userId: 'user-1',
      model: LlmModels.ClaudeSonnet420250514,
      prompt: 'Test research prompt',
    });
  });

  it('publishes in order of llmResults', async () => {
    const research = createTestResearch({
      selectedModels: [LlmModels.ClaudeSonnet4520250929, LlmModels.Gemini25Flash],
      llmResults: [
        { provider: LlmProviders.Anthropic, model: LlmModels.ClaudeSonnet4520250929, status: 'pending' },
        { provider: LlmProviders.Google, model: LlmModels.Gemini25Flash, status: 'pending' },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await processResearch('research-1', deps);

    const calls = deps.mockPublisher.publishLlmCall.mock.calls;
    expect(calls[0]?.[0].model).toBe(LlmModels.ClaudeSonnet4520250929);
    expect(calls[1]?.[0].model).toBe(LlmModels.Gemini25Flash);
  });

  it('skips already completed llmResults', async () => {
    const research = createTestResearch({
      selectedModels: [LlmModels.Gemini25Pro, LlmModels.O4MiniDeepResearch, LlmModels.ClaudeOpus4520251101],
      llmResults: [
        { provider: LlmProviders.Google, model: LlmModels.Gemini20Flash, status: 'completed', result: 'Existing' },
        { provider: LlmProviders.OpenAI, model: LlmModels.O4MiniDeepResearch, status: 'pending' },
        { provider: LlmProviders.Anthropic, model: LlmModels.ClaudeSonnet420250514, status: 'pending' },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await processResearch('research-1', deps);

    expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledTimes(2);
    expect(deps.mockPublisher.publishLlmCall).not.toHaveBeenCalledWith(
      expect.objectContaining({ model: LlmModels.Gemini20Flash })
    );
    expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({ model: LlmModels.O4MiniDeepResearch })
    );
    expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({ model: LlmModels.ClaudeSonnet420250514 })
    );
  });

  it('triggers synthesis when all results already completed', async () => {
    const research = createTestResearch({
      selectedModels: [LlmModels.Gemini25Pro, LlmModels.O4MiniDeepResearch],
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
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await processResearch('research-1', deps);

    expect(deps.mockPublisher.publishLlmCall).not.toHaveBeenCalled();
    expect(result.triggerSynthesis).toBe(true);
  });

  it('does not trigger synthesis when pending results exist', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await processResearch('research-1', deps);

    expect(result.triggerSynthesis).toBe(false);
  });

  it('works without optional dependencies', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const minimalDeps: ProcessResearchDeps = {
      researchRepo: deps.researchRepo,
      llmCallPublisher: deps.llmCallPublisher,
      logger: mockLogger,
    };

    await processResearch('research-1', minimalDeps);

    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      status: 'processing',
      startedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledTimes(2);
  });

  it('generates title without reportLlmSuccess callback', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const depsWithoutCallback: ProcessResearchDeps = {
      researchRepo: deps.researchRepo,
      llmCallPublisher: deps.llmCallPublisher,
      logger: mockLogger,
      titleGenerator: {
        generateTitle: vi.fn().mockResolvedValue(ok('Title Without Callback')),
        generateContextLabel: vi.fn().mockResolvedValue(ok('Label Without Callback')),
      },
    };

    await processResearch('research-1', depsWithoutCallback);

    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      title: 'Title Without Callback',
    });
  });

  it('returns immediately after dispatching (does not wait for LLM results)', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const start = Date.now();
    await processResearch('research-1', deps);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(100);
    expect(deps.mockPublisher.publishLlmCall).toHaveBeenCalledTimes(2);
  });

  describe('context inference', () => {
    const mockResearchContext: ResearchContext = {
      language: 'en',
      domain: 'travel',
      mode: 'standard',
      intent_summary: 'User wants travel info',
      defaults_applied: [],
      assumptions: [],
      answer_style: ['practical'],
      time_scope: {
        as_of_date: '2024-01-01',
        prefers_recent_years: 2,
        is_time_sensitive: false,
      },
      locale_scope: {
        country_or_region: 'United States',
        jurisdiction: 'United States',
        currency: 'USD',
      },
      research_plan: {
        key_questions: ['What are the best destinations?'],
        search_queries: ['travel destinations'],
        preferred_source_types: ['official'],
        avoid_source_types: ['random_blogs'],
      },
      output_format: {
        wants_table: false,
        wants_steps: false,
        wants_pros_cons: false,
        wants_budget_numbers: false,
      },
      safety: {
        high_stakes: false,
        required_disclaimers: [],
      },
      red_flags: [],
    };

    it('infers and stores research context when contextInferrer is provided', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockContextInferrer = {
        inferResearchContext: vi.fn().mockResolvedValue(ok(mockResearchContext)),
        inferSynthesisContext: vi.fn(),
      };

      const localReportSuccess = vi.fn();

      const depsWithInferrer: ProcessResearchDeps = {
        researchRepo: deps.researchRepo,
        llmCallPublisher: deps.llmCallPublisher,
        logger: mockLogger,
        contextInferrer: mockContextInferrer,
        reportLlmSuccess: localReportSuccess,
      };

      await processResearch('research-1', depsWithInferrer);

      expect(mockContextInferrer.inferResearchContext).toHaveBeenCalledWith('Test research prompt');
      expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
        researchContext: mockResearchContext,
      });
      expect(localReportSuccess).toHaveBeenCalledWith(LlmModels.Gemini25Flash);
    });

    it('logs warning when context inference fails', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockContextInferrer = {
        inferResearchContext: vi
          .fn()
          .mockResolvedValue(err({ code: 'API_ERROR', message: 'Failed to infer context' })),
        inferSynthesisContext: vi.fn(),
      };

      const depsWithInferrer: ProcessResearchDeps = {
        researchRepo: deps.researchRepo,
        llmCallPublisher: deps.llmCallPublisher,
        logger: mockLogger,
        contextInferrer: mockContextInferrer,
      };

      await processResearch('research-1', depsWithInferrer);

      expect(mockContextInferrer.inferResearchContext).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ researchId: 'research-1' }),
        '[2.4.2] Context inference failed, proceeding without context'
      );
    });

    it('does not call reportLlmSuccess when context inference fails', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockContextInferrer = {
        inferResearchContext: vi
          .fn()
          .mockResolvedValue(err({ code: 'API_ERROR', message: 'Failed' })),
        inferSynthesisContext: vi.fn(),
      };

      const localMockReportSuccess = vi.fn();

      const depsWithInferrer: ProcessResearchDeps = {
        researchRepo: deps.researchRepo,
        llmCallPublisher: deps.llmCallPublisher,
        logger: mockLogger,
        contextInferrer: mockContextInferrer,
        reportLlmSuccess: localMockReportSuccess,
      };

      await processResearch('research-1', depsWithInferrer);

      expect(localMockReportSuccess).not.toHaveBeenCalledWith(LlmModels.Gemini25Flash);
    });

    it('skips reportLlmSuccess when callback not provided', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockContextInferrer = {
        inferResearchContext: vi.fn().mockResolvedValue(ok(mockResearchContext)),
        inferSynthesisContext: vi.fn(),
      };

      const depsWithoutCallback: ProcessResearchDeps = {
        researchRepo: deps.researchRepo,
        llmCallPublisher: deps.llmCallPublisher,
        logger: mockLogger,
        contextInferrer: mockContextInferrer,
      };

      await processResearch('research-1', depsWithoutCallback);

      expect(mockContextInferrer.inferResearchContext).toHaveBeenCalled();
      expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
        researchContext: mockResearchContext,
      });
    });
  });
});

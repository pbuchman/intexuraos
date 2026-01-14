/**
 * Tests for runSynthesis use case.
 * Verifies synthesis of LLM results into final research output.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { SynthesisContext } from '@intexuraos/llm-common';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import {
  runSynthesis,
  type RunSynthesisDeps,
} from '../../../../domain/research/usecases/runSynthesis.js';
import * as repairAttributionModule from '../../../../domain/research/usecases/repairAttribution.js';
import type { Research } from '../../../../domain/research/models/index.js';
import type { ShareStoragePort } from '../../../../domain/research/ports/index.js';

function createMockDeps(): RunSynthesisDeps & {
  mockRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  mockSynthesizer: {
    synthesize: ReturnType<typeof vi.fn>;
    generateTitle: ReturnType<typeof vi.fn>;
  };
  mockNotificationSender: {
    sendResearchComplete: ReturnType<typeof vi.fn>;
    sendLlmFailure: ReturnType<typeof vi.fn>;
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

  const mockSynthesizer = {
    synthesize: vi.fn().mockResolvedValue(
      ok({ content: 'Synthesized result', usage: { inputTokens: 500, outputTokens: 200, costUsd: 0.01 } })
    ),
    generateTitle: vi.fn().mockResolvedValue(
      ok({ title: 'Generated Title', usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 } })
    ),
  };

  const mockNotificationSender = {
    sendResearchComplete: vi.fn().mockResolvedValue(ok(undefined)),
    sendLlmFailure: vi.fn().mockResolvedValue(ok(undefined)),
  };

  const mockReportSuccess = vi.fn();

  return {
    researchRepo: mockRepo,
    synthesizer: mockSynthesizer,
    notificationSender: mockNotificationSender,
    shareStorage: null,
    shareConfig: null,
    imageServiceClient: null,
    userId: 'user-1',
    webAppUrl: 'https://app.example.com',
    reportLlmSuccess: mockReportSuccess,
    mockRepo,
    mockSynthesizer,
    mockNotificationSender,
    mockReportSuccess,
  };
}

function createTestResearch(overrides: Partial<Research> = {}): Research {
  return {
    id: 'research-1',
    userId: 'user-1',
    title: 'Test Research',
    prompt: 'Test research prompt',
    status: 'processing',
    selectedModels: [LlmModels.Gemini25Pro, LlmModels.O4MiniDeepResearch],
    synthesisModel: LlmModels.Gemini25Pro,
    llmResults: [
      {
        provider: LlmProviders.Google,
        model: LlmModels.Gemini20Flash,
        status: 'completed',
        result: 'Google Result',
      },
      {
        provider: LlmProviders.OpenAI,
        model: LlmModels.O4MiniDeepResearch,
        status: 'completed',
        result: 'OpenAI Result',
      },
    ],
    startedAt: '2024-01-01T10:00:00Z',
    ...overrides,
  };
}

describe('runSynthesis', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let repairAttributionSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    deps = createMockDeps();
    // Mock repairAttribution to fail (so no extra cost from repair attempt)
    const repairError = new Error('Repair disabled in tests') as Error & { code: string };
    repairError.code = 'REPAIR_DISABLED';
    repairAttributionSpy = vi.spyOn(repairAttributionModule, 'repairAttribution').mockResolvedValue(
      err(repairError)
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    repairAttributionSpy.mockRestore();
  });

  it('returns error when research not found', async () => {
    deps.mockRepo.findById.mockResolvedValue(ok(null));

    const result = await runSynthesis('nonexistent', deps);

    expect(result).toEqual({ ok: false, error: 'Research not found' });
    expect(deps.mockSynthesizer.synthesize).not.toHaveBeenCalled();
  });

  it('returns error on repository error', async () => {
    deps.mockRepo.findById.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'Error' }));

    const result = await runSynthesis('research-1', deps);

    expect(result).toEqual({ ok: false, error: 'Research not found' });
  });

  it('updates status to synthesizing before synthesis', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await runSynthesis('research-1', deps);

    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      status: 'synthesizing',
    });
  });

  it('returns error when no successful LLM results', async () => {
    const research = createTestResearch({
      llmResults: [
        {
          provider: LlmProviders.Google,
          model: LlmModels.Gemini20Flash,
          status: 'failed',
          error: 'Error',
        },
        {
          provider: LlmProviders.OpenAI,
          model: LlmModels.O4MiniDeepResearch,
          status: 'failed',
          error: 'Error',
        },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await runSynthesis('research-1', deps);

    expect(result).toEqual({ ok: false, error: 'No successful LLM results' });
    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      status: 'failed',
      synthesisError: 'No successful LLM results to synthesize',
      completedAt: '2024-01-01T12:00:00.000Z',
    });
  });

  it('synthesizes successful results only', async () => {
    const research = createTestResearch({
      llmResults: [
        {
          provider: LlmProviders.Google,
          model: LlmModels.Gemini20Flash,
          status: 'completed',
          result: 'Google Result',
        },
        {
          provider: LlmProviders.Anthropic,
          model: 'claude-3',
          status: 'completed',
          result: 'Claude Result',
        },
        {
          provider: LlmProviders.OpenAI,
          model: LlmModels.O4MiniDeepResearch,
          status: 'failed',
          error: 'Error',
        },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await runSynthesis('research-1', deps);

    expect(deps.mockSynthesizer.synthesize).toHaveBeenCalledWith(
      'Test research prompt',
      [
        { model: LlmModels.Gemini20Flash, content: 'Google Result' },
        { model: 'claude-3', content: 'Claude Result' },
      ],
      undefined,
      undefined
    );
  });

  it('includes input contexts in synthesis', async () => {
    const research = createTestResearch({
      inputContexts: [
        {
          id: 'ctx-1',
          content: 'Input context 1',
          label: 'external-model',
          addedAt: '2024-01-01T10:00:00Z',
        },
        { id: 'ctx-2', content: 'Input context 2', addedAt: '2024-01-01T10:00:00Z' },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await runSynthesis('research-1', deps);

    expect(deps.mockSynthesizer.synthesize).toHaveBeenCalledWith(
      'Test research prompt',
      expect.any(Array),
      [{ content: 'Input context 1', label: 'external-model' }, { content: 'Input context 2' }],
      undefined
    );
  });

  it('handles synthesis failure', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockSynthesizer.synthesize.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Synthesis failed' })
    );

    const result = await runSynthesis('research-1', deps);

    expect(result).toEqual({ ok: false, error: 'Synthesis failed' });
    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      status: 'failed',
      synthesisError: 'Synthesis failed',
      completedAt: '2024-01-01T12:00:00.000Z',
    });
  });

  it('completes research successfully', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await runSynthesis('research-1', deps);

    expect(result).toEqual({ ok: true });
    expect(deps.mockRepo.update).toHaveBeenNthCalledWith(2, 'research-1', {
      status: 'completed',
      synthesizedResult: expect.stringContaining('Synthesized result'),
      completedAt: '2024-01-01T12:00:00.000Z',
      totalDurationMs: 7200000,
      totalInputTokens: 500,
      totalOutputTokens: 200,
<<<<<<< HEAD
      totalCostUsd: 0.02, // Synthesis (0.01) + attribution repair (0.01)
=======
      totalCostUsd: 0.01, // Synthesis (0.01) - repair attribution disabled in tests
>>>>>>> origin/development
      attributionStatus: expect.stringMatching(/^(complete|incomplete|repaired)$/),
    });
  });

  it('sends notification on completion', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await runSynthesis('research-1', deps);

    expect(deps.mockNotificationSender.sendResearchComplete).toHaveBeenCalledWith(
      'user-1',
      'research-1',
      'Test Research',
      'https://app.example.com/#/research/research-1'
    );
  });

  it('reports LLM success when callback provided', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await runSynthesis('research-1', deps);

    expect(deps.mockReportSuccess).toHaveBeenCalled();
  });

  it('works without reportLlmSuccess callback', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const minimalDeps: RunSynthesisDeps = {
      researchRepo: deps.researchRepo,
      synthesizer: deps.synthesizer,
      notificationSender: deps.notificationSender,
      shareStorage: null,
      shareConfig: null,
      imageServiceClient: null,
      userId: 'user-1',
      webAppUrl: 'https://app.example.com',
    };

    const result = await runSynthesis('research-1', minimalDeps);

    expect(result).toEqual({ ok: true });
  });

  it('handles empty result string from LLM', async () => {
    const research = createTestResearch({
      llmResults: [
        { provider: LlmProviders.Google, model: LlmModels.Gemini20Flash, status: 'completed' },
        {
          provider: LlmProviders.OpenAI,
          model: 'gpt-4',
          status: 'completed',
          result: 'OpenAI Result',
        },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await runSynthesis('research-1', deps);

    expect(deps.mockSynthesizer.synthesize).toHaveBeenCalledWith(
      'Test research prompt',
      [
        { model: LlmModels.Gemini20Flash, content: '' },
        { model: 'gpt-4', content: 'OpenAI Result' },
      ],
      undefined,
      undefined
    );
  });

  describe('skip synthesis logic', () => {
    it('skips synthesis when only 1 successful LLM and no input contexts', async () => {
      const research = createTestResearch({
        selectedModels: [LlmModels.Gemini25Pro],
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Single result',
          },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await runSynthesis('research-1', deps);

      expect(result).toEqual({ ok: true });
      expect(deps.mockSynthesizer.synthesize).not.toHaveBeenCalled();
      expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
        status: 'completed',
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000,
      });
    });

    it('skips synthesis when multiple LLMs selected but only 1 succeeds', async () => {
      const research = createTestResearch({
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Only success',
          },
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.O4MiniDeepResearch,
            status: 'failed',
            error: 'Failed',
          },
          {
            provider: LlmProviders.Anthropic,
            model: 'claude-opus',
            status: 'failed',
            error: 'Failed',
          },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await runSynthesis('research-1', deps);

      expect(result).toEqual({ ok: true });
      expect(deps.mockSynthesizer.synthesize).not.toHaveBeenCalled();
    });

    it('runs synthesis when 1 LLM succeeds with input contexts', async () => {
      const research = createTestResearch({
        selectedModels: [LlmModels.Gemini25Pro],
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Google result',
          },
        ],
        inputContexts: [
          { id: 'ctx-1', content: 'Context 1', addedAt: '2024-01-01T10:00:00Z' },
          { id: 'ctx-2', content: 'Context 2', addedAt: '2024-01-01T10:00:00Z' },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await runSynthesis('research-1', deps);

      expect(result).toEqual({ ok: true });
      expect(deps.mockSynthesizer.synthesize).toHaveBeenCalled();
    });

    it('runs synthesis when 2+ LLMs succeed without external reports', async () => {
      const research = createTestResearch({
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

      const result = await runSynthesis('research-1', deps);

      expect(result).toEqual({ ok: true });
      expect(deps.mockSynthesizer.synthesize).toHaveBeenCalled();
    });

    it('runs synthesis when no LLMs succeed but has input contexts', async () => {
      const research = createTestResearch({
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'failed',
            error: 'Failed',
          },
        ],
        inputContexts: [
          { id: 'ctx-1', content: 'Context 1', addedAt: '2024-01-01T10:00:00Z' },
          { id: 'ctx-2', content: 'Context 2', addedAt: '2024-01-01T10:00:00Z' },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await runSynthesis('research-1', deps);

      expect(result).toEqual({ ok: true });
      expect(deps.mockSynthesizer.synthesize).toHaveBeenCalled();
    });

    it('sends notification with app URL when synthesis skipped', async () => {
      const research = createTestResearch({
        selectedModels: [LlmModels.Gemini25Pro],
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Single result',
          },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      await runSynthesis('research-1', deps);

      expect(deps.mockNotificationSender.sendResearchComplete).toHaveBeenCalledWith(
        'user-1',
        'research-1',
        'Test Research',
        'https://app.example.com/#/research/research-1'
      );
    });

    it('does not report LLM success when synthesis skipped', async () => {
      const research = createTestResearch({
        selectedModels: [LlmModels.Gemini25Pro],
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Single result',
          },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      await runSynthesis('research-1', deps);

      expect(deps.mockReportSuccess).not.toHaveBeenCalled();
    });
  });

  describe('synthesis context inference', () => {
    const mockSynthesisContext: SynthesisContext = {
      language: 'en',
      domain: 'travel',
      mode: 'standard',
      synthesis_goals: ['merge', 'summarize'],
      missing_sections: [],
      detected_conflicts: [],
      source_preference: {
        prefer_official_over_aggregators: true,
        prefer_recent_when_time_sensitive: true,
      },
      defaults_applied: [],
      assumptions: [],
      output_format: {
        wants_table: false,
        wants_actionable_summary: true,
      },
      safety: {
        high_stakes: false,
        required_disclaimers: [],
      },
      red_flags: [],
    };

    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    it('infers synthesis context when contextInferrer is provided', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockContextInferrer = {
        inferResearchContext: vi.fn(),
        inferSynthesisContext: vi.fn().mockResolvedValue(
          ok({ context: mockSynthesisContext, usage: { inputTokens: 200, outputTokens: 100, costUsd: 0.003 } })
        ),
      };

      await runSynthesis('research-1', {
        ...deps,
        contextInferrer: mockContextInferrer,
        logger: mockLogger,
      });

      expect(mockContextInferrer.inferSynthesisContext).toHaveBeenCalledWith({
        originalPrompt: 'Test research prompt',
        reports: [
          { model: LlmModels.Gemini20Flash, content: 'Google Result' },
          { model: LlmModels.O4MiniDeepResearch, content: 'OpenAI Result' },
        ],
        additionalSources: undefined,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[4.2.2] Synthesis context inferred successfully (costUsd: 0.003)'
      );
    });

    it('passes synthesis context to synthesizer', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockContextInferrer = {
        inferResearchContext: vi.fn(),
        inferSynthesisContext: vi.fn().mockResolvedValue(
          ok({ context: mockSynthesisContext, usage: { inputTokens: 200, outputTokens: 100, costUsd: 0.003 } })
        ),
      };

      await runSynthesis('research-1', {
        ...deps,
        contextInferrer: mockContextInferrer,
        logger: mockLogger,
      });

      expect(deps.mockSynthesizer.synthesize).toHaveBeenCalledWith(
        'Test research prompt',
        expect.any(Array),
        undefined,
        mockSynthesisContext
      );
    });

    it('logs error when synthesis context inference fails', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockContextInferrer = {
        inferResearchContext: vi.fn(),
        inferSynthesisContext: vi
          .fn()
          .mockResolvedValue(err({ code: 'API_ERROR', message: 'Failed to infer' })),
      };

      await runSynthesis('research-1', {
        ...deps,
        contextInferrer: mockContextInferrer,
        logger: mockLogger,
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Object) }),
        '[4.2.2] Synthesis context inference failed, proceeding without context'
      );
    });

    it('proceeds without context when inference fails', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockContextInferrer = {
        inferResearchContext: vi.fn(),
        inferSynthesisContext: vi
          .fn()
          .mockResolvedValue(err({ code: 'API_ERROR', message: 'Failed' })),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        contextInferrer: mockContextInferrer,
        logger: mockLogger,
      });

      expect(result).toEqual({ ok: true });
      expect(deps.mockSynthesizer.synthesize).toHaveBeenCalledWith(
        'Test research prompt',
        expect.any(Array),
        undefined,
        undefined
      );
    });

    it('tracks cost when synthesis context inference fails but includes usage data', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockContextInferrer = {
        inferResearchContext: vi.fn(),
        inferSynthesisContext: vi.fn().mockResolvedValue(
          err({
            code: 'API_ERROR',
            message: 'Response does not match expected schema',
            usage: { inputTokens: 6272, outputTokens: 334, costUsd: 0.002717 },
          })
        ),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        contextInferrer: mockContextInferrer,
        logger: mockLogger,
      });

      expect(result).toEqual({ ok: true });
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ costUsd: 0.002717 }),
        '[4.2.2] Synthesis context inference failed but cost tracked'
      );
    });
  });

  describe('with share storage', () => {
    const shareConfig = {
      shareBaseUrl: 'https://example.com/share/research',
      staticAssetsUrl: 'https://static.example.com',
    };

    it('generates and uploads shareable HTML when share storage is configured', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockUpload = vi
        .fn()
        .mockResolvedValue(ok({ gcsPath: 'research/abc123-token-test-research.html' }));
      const mockShareStorage: ShareStoragePort = {
        upload: mockUpload,
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
      });

      expect(result).toEqual({ ok: true });
      expect(mockUpload).toHaveBeenCalledWith(
        expect.stringMatching(/^research\/resear-[a-zA-Z0-9]+-test-research\.html$/),
        expect.stringContaining('<!DOCTYPE html>')
      );
    });

    it('includes shareInfo when upload succeeds', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockShareStorage: ShareStoragePort = {
        upload: vi
          .fn()
          .mockResolvedValue(ok({ gcsPath: 'research/abc123-token-test-research.html' })),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
      });

      expect(deps.mockRepo.update).toHaveBeenLastCalledWith('research-1', {
        status: 'completed',
        synthesizedResult: expect.stringContaining('Synthesized result'),
        attributionStatus: expect.stringMatching(/^(complete|incomplete|repaired)$/),
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000,
        totalInputTokens: 500,
        totalOutputTokens: 200,
<<<<<<< HEAD
        totalCostUsd: 0.02, // Synthesis (0.01) + attribution repair (0.01)
=======
        totalCostUsd: 0.01, // Synthesis (0.01) - repair attribution disabled in tests
>>>>>>> origin/development
        shareInfo: expect.objectContaining({
          shareToken: expect.any(String),
          slug: 'test-research',
          shareUrl: expect.stringContaining('https://example.com/share/research/'),
          sharedAt: '2024-01-01T12:00:00.000Z',
          gcsPath: 'research/abc123-token-test-research.html',
        }),
      });
    });

    it('sends notification with share URL when share storage is configured', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockShareStorage: ShareStoragePort = {
        upload: vi
          .fn()
          .mockResolvedValue(ok({ gcsPath: 'research/abc123-token-test-research.html' })),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
      });

      expect(deps.mockNotificationSender.sendResearchComplete).toHaveBeenCalledWith(
        'user-1',
        'research-1',
        'Test Research',
        expect.stringContaining('https://example.com/share/research/')
      );
    });

    it('continues without shareInfo when upload fails', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockShareStorage: ShareStoragePort = {
        upload: vi
          .fn()
          .mockResolvedValue(err({ code: 'STORAGE_ERROR' as const, message: 'Upload failed' })),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
      });

      expect(result).toEqual({ ok: true });
      expect(deps.mockRepo.update).toHaveBeenLastCalledWith('research-1', {
        status: 'completed',
        synthesizedResult: expect.stringContaining('Synthesized result'),
        attributionStatus: expect.stringMatching(/^(complete|incomplete|repaired)$/),
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000,
        totalInputTokens: 500,
        totalOutputTokens: 200,
<<<<<<< HEAD
        totalCostUsd: 0.02, // Synthesis (0.01) + attribution repair (0.01)
=======
        totalCostUsd: 0.01, // Synthesis (0.01) - repair attribution disabled in tests
>>>>>>> origin/development
      });
    });

    it('includes cover image in shareInfo when image generation succeeds with Google key', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockShareStorage: ShareStoragePort = {
        upload: vi.fn().mockResolvedValue(ok({ gcsPath: 'research/abc123-share.html' })),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      const mockImageServiceClient = {
        generatePrompt: vi
          .fn()
          .mockResolvedValue(ok({ title: 'Test Cover Title', prompt: 'generated prompt' })),
        generateImage: vi.fn().mockResolvedValue(
          ok({
            id: 'img-123',
            thumbnailUrl: 'https://storage.example.com/thumb.jpg',
            fullSizeUrl: 'https://storage.example.com/full.png',
          })
        ),
        deleteImage: vi.fn(),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
        imageServiceClient: mockImageServiceClient,
        imageApiKeys: { google: 'test-google-key' },
      });

      expect(result).toEqual({ ok: true });
      expect(mockImageServiceClient.generatePrompt).toHaveBeenCalledWith(
        expect.stringContaining('Synthesized result'),
        LlmModels.Gemini25Pro,
        'user-1'
      );
      expect(mockImageServiceClient.generateImage).toHaveBeenCalledWith(
        'generated prompt',
        LlmModels.Gemini25FlashImage,
        'user-1',
        { title: 'Test Cover Title' }
      );
      expect(deps.mockRepo.update).toHaveBeenLastCalledWith('research-1', {
        status: 'completed',
        synthesizedResult: expect.stringContaining('Synthesized result'),
        attributionStatus: expect.stringMatching(/^(complete|incomplete|repaired)$/),
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000,
        totalInputTokens: 500,
        totalOutputTokens: 200,
<<<<<<< HEAD
        totalCostUsd: 0.02, // Synthesis (0.01) + attribution repair (0.01)
=======
        totalCostUsd: 0.01, // Synthesis (0.01) - repair attribution disabled in tests
>>>>>>> origin/development
        shareInfo: expect.objectContaining({
          coverImageId: 'img-123',
        }),
      });
    });

    it('uses OpenAI when only OpenAI key is available', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockShareStorage: ShareStoragePort = {
        upload: vi.fn().mockResolvedValue(ok({ gcsPath: 'research/abc123-share.html' })),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      const mockImageServiceClient = {
        generatePrompt: vi
          .fn()
          .mockResolvedValue(ok({ title: 'OpenAI Cover Title', prompt: 'generated prompt' })),
        generateImage: vi.fn().mockResolvedValue(
          ok({
            id: 'img-456',
            thumbnailUrl: 'https://storage.example.com/thumb.jpg',
            fullSizeUrl: 'https://storage.example.com/full.png',
          })
        ),
        deleteImage: vi.fn(),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
        imageServiceClient: mockImageServiceClient,
        imageApiKeys: { openai: 'test-openai-key' },
      });

      expect(result).toEqual({ ok: true });
      expect(mockImageServiceClient.generateImage).toHaveBeenCalledWith(
        'generated prompt',
        LlmModels.GPTImage1,
        'user-1',
        { title: 'OpenAI Cover Title' }
      );
    });

    it('skips image generation when no API keys provided', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockShareStorage: ShareStoragePort = {
        upload: vi.fn().mockResolvedValue(ok({ gcsPath: 'research/abc123-share.html' })),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      const mockImageServiceClient = {
        generatePrompt: vi.fn(),
        generateImage: vi.fn(),
        deleteImage: vi.fn(),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
        imageServiceClient: mockImageServiceClient,
      });

      expect(result).toEqual({ ok: true });
      expect(mockImageServiceClient.generatePrompt).not.toHaveBeenCalled();
      expect(mockImageServiceClient.generateImage).not.toHaveBeenCalled();
    });

    it('continues without cover image when prompt generation fails', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockShareStorage: ShareStoragePort = {
        upload: vi.fn().mockResolvedValue(ok({ gcsPath: 'research/abc123-share.html' })),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      const mockImageServiceClient = {
        generatePrompt: vi
          .fn()
          .mockResolvedValue(err({ code: 'API_ERROR' as const, message: 'Failed' })),
        generateImage: vi.fn(),
        deleteImage: vi.fn(),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
        imageServiceClient: mockImageServiceClient,
        imageApiKeys: { google: 'test-key' },
      });

      expect(result).toEqual({ ok: true });
      expect(mockImageServiceClient.generateImage).not.toHaveBeenCalled();
      expect(deps.mockRepo.update).toHaveBeenLastCalledWith('research-1', {
        status: 'completed',
        synthesizedResult: expect.stringContaining('Synthesized result'),
        attributionStatus: expect.stringMatching(/^(complete|incomplete|repaired)$/),
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000,
        totalInputTokens: 500,
        totalOutputTokens: 200,
<<<<<<< HEAD
        totalCostUsd: 0.02, // Synthesis (0.01) + attribution repair (0.01)
=======
        totalCostUsd: 0.01, // Synthesis (0.01) - repair attribution disabled in tests
>>>>>>> origin/development
        shareInfo: expect.not.objectContaining({
          coverImageId: expect.anything(),
        }),
      });
    });

    it('continues without cover image when image generation fails', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockShareStorage: ShareStoragePort = {
        upload: vi.fn().mockResolvedValue(ok({ gcsPath: 'research/abc123-share.html' })),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      const mockImageServiceClient = {
        generatePrompt: vi.fn().mockResolvedValue(ok({ prompt: 'generated prompt' })),
        generateImage: vi
          .fn()
          .mockResolvedValue(err({ code: 'API_ERROR' as const, message: 'Failed' })),
        deleteImage: vi.fn(),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
        imageServiceClient: mockImageServiceClient,
        imageApiKeys: { google: 'test-key' },
      });

      expect(result).toEqual({ ok: true });
      expect(deps.mockRepo.update).toHaveBeenLastCalledWith('research-1', {
        status: 'completed',
        synthesizedResult: expect.stringContaining('Synthesized result'),
        attributionStatus: expect.stringMatching(/^(complete|incomplete|repaired)$/),
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000,
        totalInputTokens: 500,
        totalOutputTokens: 200,
<<<<<<< HEAD
        totalCostUsd: 0.02, // Synthesis (0.01) + attribution repair (0.01)
=======
        totalCostUsd: 0.01, // Synthesis (0.01) - repair attribution disabled in tests
>>>>>>> origin/development
        shareInfo: expect.not.objectContaining({
          coverImageId: expect.anything(),
        }),
      });
    });

    it('continues without cover image when image service throws an exception', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockShareStorage: ShareStoragePort = {
        upload: vi.fn().mockResolvedValue(ok({ gcsPath: 'research/abc123-share.html' })),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      const mockImageServiceClient = {
        generatePrompt: vi.fn().mockRejectedValue(new Error('Network error')),
        generateImage: vi.fn(),
        deleteImage: vi.fn(),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
        imageServiceClient: mockImageServiceClient,
        imageApiKeys: { google: 'test-key' },
      });

      expect(result).toEqual({ ok: true });
      expect(deps.mockRepo.update).toHaveBeenLastCalledWith('research-1', {
        status: 'completed',
        synthesizedResult: expect.stringContaining('Synthesized result'),
        attributionStatus: expect.stringMatching(/^(complete|incomplete|repaired)$/),
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000,
        totalInputTokens: 500,
        totalOutputTokens: 200,
<<<<<<< HEAD
        totalCostUsd: 0.02, // Synthesis (0.01) + attribution repair (0.01)
=======
        totalCostUsd: 0.01, // Synthesis (0.01) - repair attribution disabled in tests
>>>>>>> origin/development
        shareInfo: expect.not.objectContaining({
          coverImageId: expect.anything(),
        }),
      });
    });
  });

  describe('Cost Calculation', () => {
    const mockShareStorage: ShareStoragePort = {
      upload: vi.fn().mockResolvedValue(ok({ gcsPath: 'research/abc123-share.html' })),
      delete: vi.fn().mockResolvedValue(ok(undefined)),
    };
    const shareConfig = {
      shareBaseUrl: 'https://share.example.com',
      staticAssetsUrl: 'https://static.example.com',
    };

    it('correctly calculates total cost for normal research with completed LLMs', async () => {
      const research = createTestResearch({
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Result 1',
            inputTokens: 1000,
            outputTokens: 500,
            costUsd: 0.005,
          },
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.O4MiniDeepResearch,
            status: 'completed',
            result: 'Result 2',
            inputTokens: 2000,
            outputTokens: 1000,
            costUsd: 0.015,
          },
          {
            provider: LlmProviders.Anthropic,
            model: LlmModels.ClaudeOpus45,
            status: 'pending', // Should be excluded from cost
          },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
      });

      expect(result).toEqual({ ok: true });
      const updateCall = deps.mockRepo.update.mock.calls.find(
        (call) => call[0] === 'research-1' && typeof call[1]?.totalCostUsd === 'number'
      );
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1].totalCostUsd).toBe(0.03); // 0.005 + 0.015 + 0.01 (synthesis) = 0.03
    });

    it('excludes failed and pending LLM results from cost calculation', async () => {
      const research = createTestResearch({
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Success',
            costUsd: 0.01,
          },
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.O4MiniDeepResearch,
            status: 'completed',
            result: 'Success 2',
            costUsd: 0.005,
          },
          {
            provider: LlmProviders.Anthropic,
            model: LlmModels.ClaudeOpus45,
            status: 'failed',
            error: 'Failed',
            // Failed calls don't have costs - costUsd omitted
          },
          {
            provider: LlmProviders.Perplexity,
            model: LlmModels.SonarPro,
            status: 'pending',
            // Pending calls don't have costs - costUsd omitted
          },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
      });

      expect(result).toEqual({ ok: true });
      const updateCall = deps.mockRepo.update.mock.calls.find(
        (call) => call[0] === 'research-1' && typeof call[1]?.totalCostUsd === 'number'
      );
      expect(updateCall?.[1].totalCostUsd).toBe(0.025); // 0.01 + 0.005 (LLMs) + 0.01 (synthesis) = 0.025
    });

    it('excludes copiedFromSource results from llmTotals for enhanced research', async () => {
      // Enhanced research: 2 source LLMs copied + 1 new LLM
      const research = createTestResearch({
        sourceResearchId: 'source-research-1',
        sourceLlmCostUsd: 0.06, // Source: 0.03 + 0.02 + 0.01 (auxiliary)
        llmResults: [
          // Copied from source (should be excluded from llmTotals)
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Source Result 1',
            inputTokens: 1000,
            outputTokens: 500,
            costUsd: 0.03,
            copiedFromSource: true,
          },
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.O4MiniDeepResearch,
            status: 'completed',
            result: 'Source Result 2',
            inputTokens: 2000,
            outputTokens: 1000,
            costUsd: 0.02,
            copiedFromSource: true,
          },
          // New LLM for enhancement (should be included in llmTotals)
          {
            provider: LlmProviders.Anthropic,
            model: LlmModels.ClaudeOpus45,
            status: 'completed',
            result: 'New Result',
            inputTokens: 500,
            outputTokens: 250,
            costUsd: 0.025,
          },
        ],
        auxiliaryCostUsd: 0.01,
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
      });

      expect(result).toEqual({ ok: true });
      const updateCall = deps.mockRepo.update.mock.calls.find(
        (call) => call[0] === 'research-1' && typeof call[1]?.totalCostUsd === 'number'
      );
      // totalCostUsd = sourceLlmCostUsd (0.06) + new LLM (0.025) + synthesis (0.01) + auxiliary (0.01) = 0.105
      expect(updateCall?.[1].totalCostUsd).toBeCloseTo(0.105, 6);
      // totalInputTokens = new LLM (500) + synthesis (500) = 1000
      expect(updateCall?.[1].totalInputTokens).toBe(1000);
      // totalOutputTokens = new LLM (250) + synthesis (200) = 450
      expect(updateCall?.[1].totalOutputTokens).toBe(450);
    });

    it('includes all cost components: synthesis + auxiliary + additionalCostUsd', async () => {
      const contextInferrer = {
        inferSynthesisContext: vi.fn().mockResolvedValue(
          ok({
            context: { language: 'en', domain: 'tech' } as unknown as SynthesisContext,
            usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.002 },
          })
        ),
        inferResearchContext: vi.fn().mockResolvedValue(
          ok({
            context: { language: 'en', domain: 'tech' } as unknown as SynthesisContext,
            usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.002 },
          })
        ),
      };

      const research = createTestResearch({
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Result',
            costUsd: 0.01,
          },
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.O4MiniDeepResearch,
            status: 'completed',
            result: 'Result 2',
            costUsd: 0.005,
          },
        ],
        auxiliaryCostUsd: 0.005, // From title generation + context inference
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await runSynthesis('research-1', {
        ...deps,
        contextInferrer,
        shareStorage: mockShareStorage,
        shareConfig,
      });

      expect(result).toEqual({ ok: true });
      // Find the update call with totalCostUsd
      const updateCall = deps.mockRepo.update.mock.calls.find(
        (call) => call[0] === 'research-1' && typeof call[1]?.totalCostUsd === 'number'
      );
      // totalCostUsd = LLMs (0.01 + 0.005) + synthesis (0.01) + auxiliary (0.005) + contextInferrer (0.002) = 0.032
      expect(updateCall?.[1]?.totalCostUsd).toBeCloseTo(0.032, 6);
    });

    it('correctly handles enhanced research with no new completed LLMs', async () => {
      // Edge case: enhanced research where new LLMs haven't completed yet
      const research = createTestResearch({
        sourceResearchId: 'source-research-1',
        sourceLlmCostUsd: 0.05,
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Source Result',
            costUsd: 0.03,
            copiedFromSource: true,
          },
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.O4MiniDeepResearch,
            status: 'completed',
            result: 'Source Result 2',
            costUsd: 0.02,
            copiedFromSource: true,
          },
          {
            provider: LlmProviders.Anthropic,
            model: LlmModels.ClaudeOpus45,
            status: 'pending', // New LLM not yet completed
          },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
      });

      expect(result).toEqual({ ok: true });
      // Find the update call with totalCostUsd
      const updateCall = deps.mockRepo.update.mock.calls.find(
        (call) => call[0] === 'research-1' && typeof call[1]?.totalCostUsd === 'number'
      );
      // totalCostUsd = sourceLlmCostUsd (0.05) + synthesis (0.01) = 0.06 (no new LLM costs)
      expect(updateCall?.[1]?.totalCostUsd).toBeCloseTo(0.06, 6);
    });

    it('does NOT double-count source LLM costs in enhanced research', async () => {
      // This is the critical bug fix test
      // Before fix: source costs counted twice (in llmResults + sourceLlmCostUsd)
      // After fix: source costs counted once (only in sourceLlmCostUsd)

      const sourceLlmCost = 0.08; // 2 source LLMs: 0.05 + 0.03

      const research = createTestResearch({
        sourceResearchId: 'source-research-1',
        sourceLlmCostUsd: sourceLlmCost, // Already includes source's auxiliary costs
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Source Result 1',
            costUsd: 0.05,
            copiedFromSource: true, // This cost is in sourceLlmCostUsd (excluded from llmTotals)
          },
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.O4MiniDeepResearch,
            status: 'completed',
            result: 'Source Result 2',
            costUsd: 0.03,
            copiedFromSource: true, // This cost is in sourceLlmCostUsd (excluded from llmTotals)
          },
          {
            provider: LlmProviders.Anthropic,
            model: LlmModels.ClaudeOpus45,
            status: 'completed',
            result: 'New Result',
            costUsd: 0.04,
            copiedFromSource: false, // New LLM for enhancement (included in llmTotals)
          },
        ],
        // Note: enhanced research doesn't copy auxiliaryCostUsd from source
        // It starts undefined and may get new auxiliary costs from its own processing
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
      });

      expect(result).toEqual({ ok: true });
      // Find the update call with totalCostUsd
      const updateCall = deps.mockRepo.update.mock.calls.find(
        (call) => call[0] === 'research-1' && typeof call[1]?.totalCostUsd === 'number'
      );

      // totalCostUsd = new LLM (0.04) + synthesis (0.01) + sourceLlmCostUsd (0.08) = 0.13
      const expectedCost = 0.04 + 0.01 + sourceLlmCost;
      expect(updateCall?.[1]?.totalCostUsd).toBeCloseTo(expectedCost, 6);

      // Before fix: llmTotals would include all results (0.05 + 0.03 + 0.04 = 0.12)
      //              + sourceLlmCostUsd (0.08) + synthesis (0.01) = 0.21 (WRONG!)
      // After fix: llmTotals only includes new results (0.04)
      //           + sourceLlmCostUsd (0.08) + synthesis (0.01) = 0.13 (CORRECT!)
    });
  });
});

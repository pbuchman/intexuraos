/**
 * Tests for completion handlers.
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleAllCompleted } from '../../../routes/helpers/completionHandlers.js';
import type { AllCompletedHandlerParams } from '../../../routes/helpers/completionHandlers.js';
import type { Research } from '../../../domain/research/models/Research.js';
import { ok, err } from '@intexuraos/common-core';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

function createTestResearch(overrides: Partial<Research> = {}): Research {
  return {
    id: 'research-123',
    userId: 'user-123',
    title: 'Test Research',
    prompt: 'Test question?',
    status: 'processing',
    selectedModels: [LlmModels.ClaudeSonnet45, LlmModels.Gemini25Pro],
    llmResults: [
      {
        provider: LlmProviders.Anthropic,
        model: LlmModels.ClaudeSonnet45,
        status: 'completed',
        result: 'Test result from Claude',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.01,
      },
      {
        provider: LlmProviders.Google,
        model: LlmModels.Gemini25Pro,
        status: 'completed',
        result: 'Test result from Gemini',
        inputTokens: 80,
        outputTokens: 40,
        costUsd: 0.008,
      },
    ],
    synthesisModel: LlmModels.ClaudeSonnet45,
    startedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('handleAllCompleted', () => {
  let mockResearchRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let mockParams: AllCompletedHandlerParams;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

    mockResearchRepo = {
      findById: vi.fn(),
      update: vi.fn(),
    };

    mockParams = {
      researchId: 'research-123',
      userId: 'user-123',
      researchRepo: mockResearchRepo as unknown as AllCompletedHandlerParams['researchRepo'],
      apiKeys: {
        anthropic: 'test-key',
        openai: 'test-key-2',
        google: 'test-key-3',
      },
      services: {
        createSynthesizer: () => ({
          synthesize: vi.fn().mockResolvedValue(
            ok({
              content: 'Synthesized result',
              usage: { inputTokens: 500, outputTokens: 200, costUsd: 0.01 },
            })
          ),
          generateTitle: vi.fn().mockResolvedValue(
            ok({ title: 'Generated Title', usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 } })
          ),
        }),
        createContextInferrer: () => ({
          inferSynthesisContext: vi.fn().mockResolvedValue(
            ok({
              context: {
                language: 'en',
                domain: 'general',
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
              },
              usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
            })
          ),
        }),
        pricingContext: {
          getPricing: () => ({ inputPricePerMillion: 0.1, outputPricePerMillion: 0.2 }),
        },
      } as unknown as AllCompletedHandlerParams['services'],
      userServiceClient: {
        reportLlmSuccess: vi.fn().mockResolvedValue(ok(undefined)),
      } as unknown as AllCompletedHandlerParams['userServiceClient'],
      notificationSender: {
        sendResearchComplete: vi.fn().mockResolvedValue(ok(undefined)),
      } as unknown as AllCompletedHandlerParams['notificationSender'],
      shareStorage: null,
      shareConfig: null,
      imageServiceClient: null,
      webAppUrl: 'https://app.example.com',
      logger: mockLogger as unknown as AllCompletedHandlerParams['logger'],
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs error and returns when research not found', async () => {
    mockResearchRepo.findById.mockResolvedValue(ok(null));

    await handleAllCompleted(mockParams);

    expect(mockLogger.error).toHaveBeenCalledWith(
      { researchId: 'research-123' },
      '[3.5.2] Research not found for synthesis'
    );
    expect(mockResearchRepo.update).not.toHaveBeenCalled();
  });

  it('logs error and returns when research fetch fails', async () => {
    mockResearchRepo.findById.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'DB error' })
    );

    await handleAllCompleted(mockParams);

    expect(mockLogger.error).toHaveBeenCalledWith(
      { researchId: 'research-123' },
      '[3.5.2] Research not found for synthesis'
    );
    expect(mockResearchRepo.update).not.toHaveBeenCalled();
  });

  it('completes immediately and sends notification when skipSynthesis is true', async () => {
    const researchWithSkip = createTestResearch({ skipSynthesis: true });
    mockResearchRepo.findById.mockResolvedValue(ok(researchWithSkip));
    mockResearchRepo.update.mockResolvedValue(ok(researchWithSkip));

    await handleAllCompleted(mockParams);

    expect(mockResearchRepo.update).toHaveBeenCalledWith('research-123', {
      status: 'completed',
      completedAt: '2024-01-01T12:00:00.000Z',
      totalDurationMs: 12 * 60 * 60 * 1000,
    });
    expect(mockParams.notificationSender.sendResearchComplete).toHaveBeenCalledWith(
      'user-123',
      'research-123',
      'Test Research',
      'https://app.example.com/#/research/research-123'
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      { researchId: 'research-123' },
      '[3.5.2] All LLMs completed, skipping synthesis (skipSynthesis flag)'
    );
  });

  it('handles missing synthesis API key', async () => {
    mockParams.apiKeys = {};
    const research = createTestResearch();
    mockResearchRepo.findById.mockResolvedValue(ok(research));
    mockResearchRepo.update.mockResolvedValue(ok(research));

    await handleAllCompleted(mockParams);

    expect(mockResearchRepo.update).toHaveBeenCalledWith('research-123', {
      status: 'failed',
      synthesisError: 'API key required for synthesis with claude-sonnet-4-5-20250929',
      completedAt: '2024-01-01T12:00:00.000Z',
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      { researchId: 'research-123', model: 'claude-sonnet-4-5-20250929' },
      '[3.5.2] API key missing for synthesis model'
    );
  });

  it('runs synthesis successfully when API key is present and logs success', async () => {
    const research = createTestResearch();
    mockResearchRepo.findById.mockResolvedValue(ok(research));
    mockResearchRepo.findById.mockResolvedValueOnce(ok(research)).mockResolvedValueOnce(ok(research));
    mockResearchRepo.update.mockResolvedValue(ok(research));

    await handleAllCompleted(mockParams);

    expect(mockParams.userServiceClient.reportLlmSuccess).toHaveBeenCalledWith(
      'user-123',
      'anthropic'
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      { researchId: 'research-123' },
      '[4.END] Synthesis completed successfully'
    );
  });

  it('logs error when synthesis fails', async () => {
    const research = createTestResearch();
    mockResearchRepo.findById.mockResolvedValue(ok(research));
    mockResearchRepo.findById.mockResolvedValueOnce(ok(research)).mockResolvedValueOnce(ok(research));
    mockResearchRepo.update.mockResolvedValue(ok(research));

    const createSynthesizer = vi.fn().mockReturnValue({
      synthesize: vi.fn().mockResolvedValue(err({ code: 'API_ERROR', message: 'Synthesis failed' })),
      generateTitle: vi.fn().mockResolvedValue(
        ok({ title: 'Title', usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 } })
      ),
    });
    mockParams.services = {
      createSynthesizer,
      createContextInferrer: () => ({
        inferSynthesisContext: vi.fn().mockResolvedValue(
          ok({
            context: {
              language: 'en',
              domain: 'general',
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
              output_format: { wants_table: false, wants_actionable_summary: true },
              safety: { high_stakes: false, required_disclaimers: [] },
              red_flags: [],
            },
            usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
          })
        ),
      }),
      pricingContext: {
        getPricing: () => ({ inputPricePerMillion: 0.1, outputPricePerMillion: 0.2 }),
      },
    } as unknown as AllCompletedHandlerParams['services'];

    await handleAllCompleted(mockParams);

    expect(mockLogger.error).toHaveBeenCalledWith(
      { researchId: 'research-123', error: 'Synthesis failed' },
      '[4.END] Synthesis failed'
    );
  });

  it('correctly wraps info calls with researchId', async () => {
    const infoLogs: Array<{ obj: object; msg: string | undefined }> = [];
    const testLogger = {
      info: vi.fn((obj: object, msg?: string) => {
        infoLogs.push({ obj, msg });
      }),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    mockParams.logger = testLogger as unknown as AllCompletedHandlerParams['logger'];

    const research = createTestResearch();
    mockResearchRepo.findById.mockResolvedValue(ok(research));
    mockResearchRepo.findById.mockResolvedValueOnce(ok(research)).mockResolvedValueOnce(ok(research));
    mockResearchRepo.update.mockResolvedValue(ok(research));

    await handleAllCompleted(mockParams);

    const synthesisTriggerLog = infoLogs.find(
      (log) => typeof log.msg === 'string' && log.msg.includes('triggering synthesis')
    );
    expect(synthesisTriggerLog).toBeDefined();
    expect(synthesisTriggerLog?.obj).toHaveProperty('researchId', 'research-123');
  });

  it('handles error logger calls with string obj (ternary branch)', async () => {
    const errorLogs: Array<{ obj: object | string; msg: string | undefined }> = [];
    const testLogger = {
      info: vi.fn(),
      error: vi.fn((obj: object | string, msg?: string) => {
        errorLogs.push({ obj, msg });
      }),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    mockParams.logger = testLogger as unknown as AllCompletedHandlerParams['logger'];

    const research = createTestResearch();
    mockResearchRepo.findById.mockResolvedValue(ok(research));
    mockResearchRepo.findById.mockResolvedValueOnce(ok(research)).mockResolvedValueOnce(ok(research));
    mockResearchRepo.update.mockResolvedValue(ok(research));

    const createSynthesizer = vi.fn().mockReturnValue({
      synthesize: vi.fn().mockResolvedValue(err({ code: 'API_ERROR', message: 'Synthesis failed' })),
      generateTitle: vi.fn().mockResolvedValue(
        ok({ title: 'Title', usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 } })
      ),
    });
    mockParams.services = {
      createSynthesizer,
      createContextInferrer: () => ({
        inferSynthesisContext: vi.fn().mockResolvedValue(
          ok({
            context: {
              language: 'en',
              domain: 'general',
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
              output_format: { wants_table: false, wants_actionable_summary: true },
              safety: { high_stakes: false, required_disclaimers: [] },
              red_flags: [],
            },
            usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
          })
        ),
      }),
      pricingContext: {
        getPricing: () => ({ inputPricePerMillion: 0.1, outputPricePerMillion: 0.2 }),
      },
    } as unknown as AllCompletedHandlerParams['services'];

    await handleAllCompleted(mockParams);

    expect(errorLogs.length).toBeGreaterThan(0);
    const wrappedErrorCall = errorLogs.find((log) =>
      typeof log.obj === 'object' && 'researchId' in log.obj
    );
    expect(wrappedErrorCall).toBeDefined();
  });
});

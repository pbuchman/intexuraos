/**
 * Tests for completion handlers.
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleAllCompleted } from '../../../routes/helpers/completionHandlers.js';
import type { AllCompletedHandlerParams } from '../../../routes/helpers/completionHandlers.js';
import type { Research } from '../../../domain/research/models/Research.js';
import { ok, err } from '@intexuraos/common-core';
import { LlmModels } from '@intexuraos/llm-contract';

describe('handleAllCompleted', () => {
  let mockParams: AllCompletedHandlerParams;
  let logMessages: { level: string; msg: string; obj?: object }[];

  const mockResearch: Research = {
    id: 'research-123',
    userId: 'user-123',
    title: 'Test Research',
    prompt: 'Test question?',
    status: 'processing',
    selectedModels: [LlmModels.ClaudeSonnet45],
    llmResults: [],
    synthesisModel: LlmModels.ClaudeSonnet45,
    startedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    logMessages = [];

    mockParams = {
      researchId: 'research-123',
      userId: 'user-123',
      researchRepo: {
        findById: async () => ok(mockResearch),
        update: async () => ok(mockResearch),
      } as unknown as AllCompletedHandlerParams['researchRepo'],
      apiKeys: {
        anthropic: 'test-key',
        openai: 'test-key-2',
      },
      services: {
        createSynthesizer: () => ({
          synthesize: async () =>
            ok({
              output: 'Test synthesis',
              usage: { inputTokens: 100, outputTokens: 50 },
            }),
        }),
        createContextInferrer: () => ({
          inferContexts: async () =>
            ok({
              contexts: [],
              usage: { inputTokens: 10, outputTokens: 5 },
            }),
        }),
        pricingContext: {
          getPricing: () => ({ inputPricePerMillion: 0.1, outputPricePerMillion: 0.2 }),
        },
      } as unknown as AllCompletedHandlerParams['services'],
      userServiceClient: {
        reportLlmSuccess: async () => ok(undefined),
      } as unknown as AllCompletedHandlerParams['userServiceClient'],
      notificationSender: {
        sendResearchComplete: async () => ok(undefined),
      } as unknown as AllCompletedHandlerParams['notificationSender'],
      shareStorage: null,
      shareConfig: null,
      imageServiceClient: null,
      webAppUrl: 'https://app.example.com',
      logger: {
        info: (obj: object | string, msg?: string) => {
          logMessages.push({
            level: 'info',
            obj: typeof obj === 'object' ? obj : {},
            msg: typeof obj === 'string' ? obj : msg ?? '',
          });
        },
        error: (obj: object, msg: string) => {
          logMessages.push({ level: 'error', obj, msg });
        },
      } as unknown as AllCompletedHandlerParams['logger'],
    };
  });

  it('logs error and returns when research not found', async () => {
    mockParams.researchRepo.findById = async () => ok(null);

    await handleAllCompleted(mockParams);

    const errorLog = logMessages.find((log) => log.level === 'error');
    expect(errorLog).toBeDefined();
    expect(errorLog?.msg).toContain('Research not found');
  });

  it('logs error and returns when research fetch fails', async () => {
    mockParams.researchRepo.findById = async () =>
      err({ code: 'FIRESTORE_ERROR', message: 'DB error' });

    await handleAllCompleted(mockParams);

    const errorLog = logMessages.find((log) => log.level === 'error');
    expect(errorLog).toBeDefined();
    expect(errorLog?.msg).toContain('Research not found');
  });

  it('completes immediately and sends notification when skipSynthesis is true', async () => {
    const researchWithSkip = {
      ...mockResearch,
      skipSynthesis: true,
    };
    mockParams.researchRepo.findById = async () => ok(researchWithSkip);

    let updateCalled = false;
    let notificationCalled = false;

    mockParams.researchRepo.update = async (id, updates) => {
      updateCalled = true;
      expect(id).toBe('research-123');
      expect(updates.status).toBe('completed');
      expect(updates.completedAt).toBeDefined();
      expect(updates.totalDurationMs).toBeDefined();
      return ok(mockResearch);
    };

    mockParams.notificationSender.sendResearchComplete = async (userId, researchId, title, url) => {
      notificationCalled = true;
      expect(userId).toBe('user-123');
      expect(researchId).toBe('research-123');
      expect(title).toBe('Test Research');
      expect(url).toContain('research-123');
      return ok(undefined);
    };

    await handleAllCompleted(mockParams);

    expect(updateCalled).toBe(true);
    expect(notificationCalled).toBe(true);

    const skipLog = logMessages.find((log) => log.msg.includes('skipSynthesis flag'));
    expect(skipLog).toBeDefined();
  });

  it('handles missing synthesis API key', async () => {
    mockParams.apiKeys = {}; // No API keys

    let updateCalled = false;
    mockParams.researchRepo.update = async (_id, updates) => {
      updateCalled = true;
      expect(updates.status).toBe('failed');
      expect(updates.synthesisError).toContain('API key required');
      return ok(mockResearch);
    };

    await handleAllCompleted(mockParams);

    expect(updateCalled).toBe(true);

    const errorLog = logMessages.find((log) => log.msg.includes('API key missing'));
    expect(errorLog).toBeDefined();
  });

});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { getResearchCostSummary } from '../../../domain/usecases/getResearchCostSummary.js';
import { FakeUsageEventRepository } from '../../fakeUsageEventRepository.js';
import { createTestEvent } from '../../helpers.js';

describe('getResearchCostSummary', () => {
  let eventRepo: FakeUsageEventRepository;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as never;

  beforeEach(() => {
    eventRepo = new FakeUsageEventRepository();
  });

  it('summarizes correlated research usage rows and totals', async () => {
    await eventRepo.createEvent(createTestEvent({
      eventId: 'evt_research_1',
      occurredAt: '2026-05-05T07:52:00.000Z',
      request: {
        provider: LlmProviders.Google,
        model: LlmModels.Gemini25FlashImage,
        operation: 'image_generation',
        success: true,
        durationMs: 1200,
        promptType: 'image-thumbnail-prompt',
      },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        thinkingTokens: 0,
        webSearchCalls: 0,
        groundingEnabled: false,
        imageCount: 1,
      },
      cost: {
        billedUsd: 0.03,
        providerReportedUsd: null,
        calculatedUsd: 0.03,
        pricingSource: 'calculated',
      },
      correlation: {
        requestId: 'req_1',
        traceId: null,
        taskId: null,
        researchId: 'research-123',
        attempt: null,
        sessionId: null,
      },
    }));
    await eventRepo.createEvent(createTestEvent({
      eventId: 'evt_research_2',
      occurredAt: '2026-05-05T07:53:00.000Z',
      cost: {
        billedUsd: 0.04,
        providerReportedUsd: null,
        calculatedUsd: 0.04,
        pricingSource: 'calculated',
      },
      correlation: {
        requestId: 'req_2',
        traceId: null,
        taskId: null,
        researchId: 'research-123',
        attempt: null,
        sessionId: null,
      },
    }));
    await eventRepo.createEvent(createTestEvent({
      eventId: 'evt_other_research',
      cost: {
        billedUsd: 1.25,
        providerReportedUsd: null,
        calculatedUsd: 1.25,
        pricingSource: 'calculated',
      },
      correlation: {
        requestId: 'req_other',
        traceId: null,
        taskId: null,
        researchId: 'research-other',
        attempt: null,
        sessionId: null,
      },
    }));

    const result = await getResearchCostSummary(
      { logger, usageEventRepository: eventRepo },
      { researchId: 'research-123' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totals).toEqual(expect.objectContaining({
        calls: 2,
        costUsd: 0.07,
        imageCount: 1,
      }));
      expect(result.value.rows.map((row) => row.eventId)).toEqual(['evt_research_1', 'evt_research_2']);
      expect(result.value.rows[0]).toEqual(expect.objectContaining({
        eventId: 'evt_research_1',
        promptType: 'image-thumbnail-prompt',
        imageCount: 1,
        costUsd: 0.03,
        requestId: 'req_1',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        thinkingTokens: 0,
        webSearchCalls: 0,
      }));
      expect(result.value.diagnostics.missingAttribution.count).toBe(0);
    }
  });

  it('rejects blank researchId before querying the repository', async () => {
    const result = await getResearchCostSummary(
      { logger, usageEventRepository: eventRepo },
      { researchId: '   ' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: 'INVALID_REQUEST',
        message: 'researchId is required',
      });
    }
  });

  it('rejects inverted timeRange before querying the repository', async () => {
    const result = await getResearchCostSummary(
      { logger, usageEventRepository: eventRepo },
      {
        researchId: 'research-123',
        timeRange: {
          from: '2026-05-05T07:57:00.000Z',
          to: '2026-05-05T07:52:00.000Z',
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: 'INVALID_TIME_RANGE',
        message: 'timeRange.from must be less than or equal to timeRange.to',
      });
    }
  });

  it('returns repository failures', async () => {
    eventRepo.setFailure({ code: 'DB_ERROR', message: 'query failed' });

    const result = await getResearchCostSummary(
      { logger, usageEventRepository: eventRepo },
      { researchId: 'research-123' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'DB_ERROR', message: 'query failed' });
    }
  });

  it('uses eventId as a stable tie-breaker when timestamps match', async () => {
    const sameTimestamp = '2026-05-05T07:53:00.000Z';
    await eventRepo.createEvent(createTestEvent({
      eventId: 'evt_correlated_b',
      occurredAt: sameTimestamp,
      correlation: {
        requestId: 'req_b',
        traceId: null,
        taskId: null,
        researchId: 'research-tie',
        attempt: null,
        sessionId: null,
      },
    }));
    await eventRepo.createEvent(createTestEvent({
      eventId: 'evt_correlated_a',
      occurredAt: sameTimestamp,
      correlation: {
        requestId: 'req_a',
        traceId: null,
        taskId: null,
        researchId: 'research-tie',
        attempt: null,
        sessionId: null,
      },
    }));
    await eventRepo.createEvent(createTestEvent({
      eventId: 'evt_missing_b',
      owner: { type: 'user', id: 'user_123' },
      occurredAt: sameTimestamp,
      correlation: {
        requestId: 'req_missing_b',
        traceId: null,
        taskId: null,
        researchId: null,
        attempt: null,
        sessionId: null,
      },
    }));
    await eventRepo.createEvent(createTestEvent({
      eventId: 'evt_missing_a',
      owner: { type: 'user', id: 'user_123' },
      occurredAt: sameTimestamp,
      correlation: {
        requestId: 'req_missing_a',
        traceId: null,
        taskId: null,
        researchId: null,
        attempt: null,
        sessionId: null,
      },
    }));

    const result = await getResearchCostSummary(
      { logger, usageEventRepository: eventRepo },
      {
        researchId: 'research-tie',
        owner: { type: 'user', id: 'user_123' },
        timeRange: {
          from: '2026-05-05T07:52:00.000Z',
          to: '2026-05-05T07:57:00.000Z',
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rows.map((row) => row.eventId)).toEqual([
        'evt_correlated_a',
        'evt_correlated_b',
      ]);
      expect(result.value.diagnostics.missingAttribution.eventIds).toEqual([
        'evt_missing_a',
        'evt_missing_b',
      ]);
    }
  });

  it('applies owner guard and reports owner/time-window events with null researchId', async () => {
    await eventRepo.createEvent(createTestEvent({
      eventId: 'evt_guarded_match',
      owner: { type: 'user', id: 'user_123' },
      occurredAt: '2026-05-05T07:53:00.000Z',
      cost: {
        billedUsd: 0.03,
        providerReportedUsd: null,
        calculatedUsd: 0.03,
        pricingSource: 'calculated',
      },
      correlation: {
        requestId: 'req_match',
        traceId: null,
        taskId: null,
        researchId: 'research-guarded',
        attempt: null,
        sessionId: null,
      },
    }));
    await eventRepo.createEvent(createTestEvent({
      eventId: 'evt_same_research_wrong_owner',
      owner: { type: 'user', id: 'user_other' },
      occurredAt: '2026-05-05T07:54:00.000Z',
      cost: {
        billedUsd: 99,
        providerReportedUsd: null,
        calculatedUsd: 99,
        pricingSource: 'calculated',
      },
      correlation: {
        requestId: 'req_wrong_owner',
        traceId: null,
        taskId: null,
        researchId: 'research-guarded',
        attempt: null,
        sessionId: null,
      },
    }));
    await eventRepo.createEvent(createTestEvent({
      eventId: 'evt_missing_research_id',
      owner: { type: 'user', id: 'user_123' },
      occurredAt: '2026-05-05T07:55:00.000Z',
      cost: {
        billedUsd: 0.02,
        providerReportedUsd: null,
        calculatedUsd: 0.02,
        pricingSource: 'calculated',
      },
      correlation: {
        requestId: 'req_missing',
        traceId: null,
        taskId: null,
        researchId: null,
        attempt: null,
        sessionId: null,
      },
    }));

    const result = await getResearchCostSummary(
      { logger, usageEventRepository: eventRepo },
      {
        researchId: 'research-guarded',
        owner: { type: 'user', id: 'user_123' },
        timeRange: {
          from: '2026-05-05T07:52:00.000Z',
          to: '2026-05-05T07:57:00.000Z',
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totals.calls).toBe(1);
      expect(result.value.totals.costUsd).toBe(0.03);
      expect(result.value.rows.map((row) => row.eventId)).toEqual(['evt_guarded_match']);
      expect(result.value.diagnostics.missingAttribution).toEqual({
        count: 1,
        costUsd: 0.02,
        eventIds: ['evt_missing_research_id'],
      });
    }
  });
});

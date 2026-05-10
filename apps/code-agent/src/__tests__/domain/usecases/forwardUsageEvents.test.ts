/**
 * Tests for forwardUsageEvents use case.
 *
 * Covers:
 * - Happy path: ingestEvents returns ok -> use case returns ok and logs info
 * - Error path: ingestEvents returns err -> use case returns err and logs error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { forwardUsageEvents, type ForwardUsageEventsDeps } from '../../../domain/usecases/forwardUsageEvents.js';
import type { UsageServiceClient, UsageIngestRequest, UsageIngestResponse, UsageServiceError } from '@intexuraos/internal-clients';
import type { Logger } from '@intexuraos/common-core';
import { LlmProviders } from '@intexuraos/llm-contract';

function createMockLogger(): Logger {
  return {
    info: vi.fn<Logger['info']>(),
    warn: vi.fn<Logger['warn']>(),
    error: vi.fn<Logger['error']>(),
    debug: vi.fn<Logger['debug']>(),
  };
}

function createMockUsageServiceClient(
  ingestResult: Awaited<ReturnType<UsageServiceClient['ingestEvents']>>
): UsageServiceClient {
  return {
    ingestEvents: vi.fn().mockResolvedValue(ingestResult),
    queryUsage: vi.fn(),
    fetchPricing: vi.fn(),
    listUsageEvents: vi.fn(),
    getUsageEvent: vi.fn(),
    getResearchCostSummary: vi.fn(),
  };
}

function createValidRequest(): UsageIngestRequest {
  return {
    schemaVersion: 2,
    events: [
      {
        schemaVersion: 2,
        eventId: 'evt-001',
        occurredAt: '2026-04-10T12:00:00Z',
        owner: { type: 'user', id: 'user-1' },
        source: { service: 'code-agent', component: 'orchestrator', client: 'cli', environment: 'dev' },
        request: { provider: LlmProviders.Anthropic, model: 'claude-sonnet-4-20250514', operation: 'generate', success: true, durationMs: 1500 },
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0, cachedTokens: 0, reasoningTokens: 0, thinkingTokens: 0, webSearchCalls: 0, groundingEnabled: false, imageCount: 0 },
        cost: { providerReportedUsd: null, pricingSource: 'pending' },
        correlation: { requestId: null, traceId: null, taskId: 'task_abc', researchId: null, attempt: null, sessionId: null },
        error: null,
      },
    ],
  };
}

describe('forwardUsageEvents', () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('returns ok and logs info when ingestEvents succeeds', async () => {
    const response: UsageIngestResponse = { accepted: 1, duplicates: 0, rejected: [] };
    const client = createMockUsageServiceClient(ok(response));
    const deps: ForwardUsageEventsDeps = { usageServiceClient: client, logger };
    const request = createValidRequest();

    const result = await forwardUsageEvents(request, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(response);
    }
    expect(logger.info).toHaveBeenCalledWith(
      { accepted: 1, duplicates: 0 },
      'Usage events forwarded to llm-usage-service'
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(client.ingestEvents).toHaveBeenCalledWith(request);
  });

  it('returns err and logs error when ingestEvents fails', async () => {
    const usageError: UsageServiceError = { code: 'NETWORK_ERROR', message: 'Connection refused' };
    const client = createMockUsageServiceClient(err(usageError));
    const deps: ForwardUsageEventsDeps = { usageServiceClient: client, logger };
    const request = createValidRequest();

    const result = await forwardUsageEvents(request, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(usageError);
    }
    expect(logger.error).toHaveBeenCalledWith(
      { error: usageError },
      'Failed to forward usage events to llm-usage-service'
    );
    expect(logger.info).not.toHaveBeenCalled();
  });
});

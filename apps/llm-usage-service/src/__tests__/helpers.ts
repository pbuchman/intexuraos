import { LlmProviders } from '@intexuraos/llm-contract';
import type { UsageEvent, UsageEventInput } from '../domain/models/usageEvent.js';

/**
 * Creates a valid UsageEventInput for testing.
 */
export function createTestEventInput(overrides?: Partial<UsageEventInput>): UsageEventInput {
  return {
    schemaVersion: 1,
    eventId: `evt_${String(Date.now())}`,
    occurredAt: '2026-04-10T12:00:00.000Z',
    owner: { type: 'user', id: 'user_123' },
    source: {
      service: 'orchestrator',
      component: 'research',
      client: 'web',
      environment: 'dev',
      workerLocation: 'home-dev',
    },
    request: {
      provider: LlmProviders.Anthropic,
      model: 'claude-sonnet-4-20250514',
      operation: 'generate',
      success: true,
      durationMs: 1500,
    },
    usage: {
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      thinkingTokens: 0,
      webSearchCalls: 0,
      groundingEnabled: false,
      imageCount: 0,
    },
    cost: {
      billedUsd: 0.003,
      providerReportedUsd: null,
      calculatedUsd: null,
      pricingSource: 'calculated',
    },
    correlation: {
      requestId: 'req_123',
      traceId: null,
      taskId: null,
      researchId: null,
      attempt: null,
      sessionId: null,
    },
    error: null,
    ...overrides,
  };
}

/**
 * Creates a valid UsageEvent (with receivedAt and ingress) for testing.
 */
export function createTestEvent(overrides?: Partial<UsageEvent>): UsageEvent {
  const input = createTestEventInput();
  return {
    ...input,
    receivedAt: '2026-04-10T12:00:01.000Z',
    ingress: 'internal',
    ...overrides,
  };
}

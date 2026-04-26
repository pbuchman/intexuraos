import { describe, expect, it } from 'vitest';
import { LlmProviders, LlmModels } from '@intexuraos/llm-contract';
import { buildUsageEvent } from '../buildUsageEvent.js';
import type { UsageLogParams } from '../usageLogger.js';

interface EventForTests {
  schemaVersion: number;
  owner: { type: string; id: string };
  source: { service: string; component: string; client: string; environment: string };
  cost: {
    providerReportedUsd: number | null;
    pricingSource: string;
  };
  request: {
    provider: string;
    model: string;
    operation: string;
    success: boolean;
    durationMs: number;
    promptType?: string;
  };
  [k: string]: unknown;
}

const baseParams: UsageLogParams = {
  userId: 'user-123',
  provider: LlmProviders.OpenRouter,
  model: 'or:nvidia/nemotron-3-super-120b-a12b:free',
  callType: 'generate',
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0 },
  success: true,
  durationMs: 0,
};

const baseSource = { service: 'linear-agent', component: 'title-gen' };

describe('buildUsageEvent', () => {
  it('emits schemaVersion 2', () => {
    const event = buildUsageEvent(baseParams, baseSource) as EventForTests;
    expect(event.schemaVersion).toBe(2);
  });

  it('defaults owner.type to "system" when ownerType not provided', () => {
    const event = buildUsageEvent(baseParams, baseSource) as EventForTests;
    expect(event.owner).toEqual({ type: 'system', id: 'user-123' });
  });

  it('uses owner.type "user" when ownerType: "user" passed', () => {
    const event = buildUsageEvent(
      { ...baseParams, ownerType: 'user' },
      baseSource
    ) as EventForTests;
    expect(event.owner).toEqual({ type: 'user', id: 'user-123' });
  });

  it('defaults source.client to source.component when clientName not provided', () => {
    const event = buildUsageEvent(baseParams, baseSource) as EventForTests;
    expect(event.source.client).toBe('title-gen');
  });

  it('uses source.client = clientName when provided', () => {
    const event = buildUsageEvent(
      { ...baseParams, clientName: 'openrouter-generate' },
      baseSource
    ) as EventForTests;
    expect(event.source.client).toBe('openrouter-generate');
  });

  it('source.client never contains "/" even when model id contains it', () => {
    const event = buildUsageEvent(baseParams, baseSource) as EventForTests;
    expect(event.source.client).not.toMatch(/\//);
  });

  it('cost.providerReportedUsd is null and pricingSource is "pending" by default', () => {
    const event = buildUsageEvent(baseParams, baseSource) as EventForTests;
    expect(event.cost.providerReportedUsd).toBeNull();
    expect(event.cost.pricingSource).toBe('pending');
  });

  it('cost uses providerReportedUsd when provided; pricingSource = "provider_reported"', () => {
    const event = buildUsageEvent(
      { ...baseParams, providerReportedUsd: 0.0042 },
      baseSource
    ) as EventForTests;
    expect(event.cost.providerReportedUsd).toBe(0.0042);
    expect(event.cost.pricingSource).toBe('provider_reported');
  });

  it('treats providerReportedUsd: null as "no provider cost"', () => {
    const event = buildUsageEvent(
      { ...baseParams, providerReportedUsd: null },
      baseSource
    ) as EventForTests;
    expect(event.cost.providerReportedUsd).toBeNull();
    expect(event.cost.pricingSource).toBe('pending');
  });
});

describe('buildUsageEvent with promptType', () => {
  it('should include promptType in request field when provided', () => {
    const params: UsageLogParams = {
      userId: 'user-123',
      provider: LlmProviders.Google,
      model: LlmModels.Gemini25Flash,
      callType: 'generate' as const,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
      success: true,
      durationMs: 0,
      promptType: 'linear-issue-title',
    };

    const event = buildUsageEvent(params, {
      service: 'linear-agent',
      component: 'llm-client',
    }) as EventForTests;

    expect(event.request.promptType).toBe('linear-issue-title');
  });

  it('should omit promptType when not provided', () => {
    const params: UsageLogParams = {
      userId: 'user-123',
      provider: LlmProviders.Google,
      model: LlmModels.Gemini25Flash,
      callType: 'generate' as const,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
      success: true,
      durationMs: 0,
    };

    const event = buildUsageEvent(params, {
      service: 'linear-agent',
      component: 'llm-client',
    }) as EventForTests;

    expect(event.request.promptType).toBeUndefined();
  });
});

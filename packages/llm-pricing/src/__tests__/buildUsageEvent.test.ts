import { describe, expect, it } from 'vitest';
import { LlmProviders } from '@intexuraos/llm-contract';
import { buildUsageEvent } from '../buildUsageEvent.js';
import type { UsageLogParams } from '../usageLogger.js';

interface EventForTests {
  owner: { type: string; id: string };
  source: { service: string; component: string; client: string; environment: string };
  cost: {
    billedUsd: number;
    providerReportedUsd: number | null;
    calculatedUsd: number;
    pricingSource: string;
  };
  [k: string]: unknown;
}

const baseParams: UsageLogParams = {
  userId: 'user-123',
  provider: LlmProviders.OpenRouter,
  model: 'or:nvidia/nemotron-3-super-120b-a12b:free',
  callType: 'generate',
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
  success: true,
};

const baseSource = { service: 'linear-agent', component: 'title-gen' };

describe('buildUsageEvent', () => {
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

  it('cost.providerReportedUsd is null and pricingSource is "calculated" by default', () => {
    const event = buildUsageEvent(baseParams, baseSource) as EventForTests;
    expect(event.cost.providerReportedUsd).toBeNull();
    expect(event.cost.pricingSource).toBe('calculated');
    expect(event.cost.billedUsd).toBe(0.001);
    expect(event.cost.calculatedUsd).toBe(0.001);
  });

  it('cost uses providerReportedUsd as billedUsd when provided; pricingSource = "provider_reported"', () => {
    const event = buildUsageEvent(
      { ...baseParams, providerReportedUsd: 0.0042 },
      baseSource
    ) as EventForTests;
    expect(event.cost.providerReportedUsd).toBe(0.0042);
    expect(event.cost.billedUsd).toBe(0.0042);
    expect(event.cost.calculatedUsd).toBe(0.001);
    expect(event.cost.pricingSource).toBe('provider_reported');
  });

  it('treats providerReportedUsd: null as "no provider cost"', () => {
    const event = buildUsageEvent(
      { ...baseParams, providerReportedUsd: null },
      baseSource
    ) as EventForTests;
    expect(event.cost.providerReportedUsd).toBeNull();
    expect(event.cost.pricingSource).toBe('calculated');
    expect(event.cost.billedUsd).toBe(0.001);
  });

  it('clamps a negative providerReportedUsd to 0 (schema requires billedUsd >= 0)', () => {
    const event = buildUsageEvent(
      { ...baseParams, providerReportedUsd: -0.001 },
      baseSource
    ) as EventForTests;
    expect(event.cost.billedUsd).toBeGreaterThanOrEqual(0);
  });
});

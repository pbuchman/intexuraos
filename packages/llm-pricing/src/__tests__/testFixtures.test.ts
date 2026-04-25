import { describe, expect, it } from 'vitest';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { FakeUsageSink, createFakeUsageSink } from '../testFixtures.js';
import type { UsageLogParams } from '../usageLogger.js';

const sampleParams: UsageLogParams = {
  userId: 'user-1',
  provider: LlmProviders.Google,
  model: LlmModels.Gemini25Flash,
  callType: 'generate',
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    costUsd: 0,
  },
  success: true,
  durationMs: 0,
};

describe('FakeUsageSink', () => {
  it('captures log calls in records', async () => {
    const sink = new FakeUsageSink();
    await sink.log(sampleParams);
    await sink.log({ ...sampleParams, userId: 'user-2' });
    expect(sink.records).toHaveLength(2);
    expect(sink.records[0]?.userId).toBe('user-1');
    expect(sink.records[1]?.userId).toBe('user-2');
  });

  it('clears captured records', async () => {
    const sink = new FakeUsageSink();
    await sink.log(sampleParams);
    sink.clear();
    expect(sink.records).toHaveLength(0);
  });
});

describe('createFakeUsageSink', () => {
  it('returns a fresh FakeUsageSink', () => {
    const sink = createFakeUsageSink();
    expect(sink).toBeInstanceOf(FakeUsageSink);
    expect(sink.records).toHaveLength(0);
  });
});

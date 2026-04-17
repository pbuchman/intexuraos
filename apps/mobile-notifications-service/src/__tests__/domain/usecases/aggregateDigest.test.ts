import { describe, expect, it, vi } from 'vitest';
import { aggregateDigest } from '../../../domain/usecases/aggregateDigest.js';
import { FakeLlmClient } from '../../helpers/fakeLlmClient.js';
import { COLD_START_EXAMPLE } from '@intexuraos/llm-prompts';

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('aggregateDigest', () => {
  it('returns a parsed AggregationOutput on a valid first-attempt LLM response', async () => {
    const llmClient = new FakeLlmClient([
      { type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) },
    ]);

    const result = await aggregateDigest(
      { llmClient, logger: noopLogger },
      {
        userId: 'google-oauth2|test',
        groupKey: 'grupa-wedkarska-skool',
        date: '2026-04-15',
        previousState: null,
        last3Summaries: [],
        todaysMessages: [],
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dailySummary.date).toBe('2026-04-08');
    expect(llmClient.calls).toHaveLength(1);
    expect(llmClient.calls[0]?.options?.promptType).toBe('whatsapp-digest-aggregate');
  });

  it('repairs the response when the first call returns invalid JSON', async () => {
    const llmClient = new FakeLlmClient([
      { type: 'content', value: '{"dailySummary": "this is not an object"}' },
      { type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) },
    ]);

    const result = await aggregateDigest(
      { llmClient, logger: noopLogger },
      {
        userId: 'u', groupKey: 'g', date: '2026-04-15',
        previousState: null, last3Summaries: [], todaysMessages: [],
      },
    );

    expect(result.ok).toBe(true);
    expect(llmClient.calls).toHaveLength(2);
    expect(llmClient.calls[1]?.options?.promptType).toBe('whatsapp-digest-repair');
  });

  it('returns repair-exhausted when LLM never produces valid JSON', async () => {
    const llmClient = new FakeLlmClient([
      { type: 'content', value: 'not json 1' },
      { type: 'content', value: 'not json 2' },
      { type: 'content', value: 'not json 3' },
      { type: 'content', value: 'not json 4' },
    ]);

    const result = await aggregateDigest(
      { llmClient, logger: noopLogger },
      {
        userId: 'u', groupKey: 'g', date: '2026-04-15',
        previousState: null, last3Summaries: [], todaysMessages: [],
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('repair-exhausted');
    expect(llmClient.calls).toHaveLength(4); // 1 initial + 3 repairs
  });

  it('returns llm-call-failed when the LLM call errors', async () => {
    const llmClient = new FakeLlmClient([
      { type: 'error', value: 'upstream 502' },
    ]);

    const result = await aggregateDigest(
      { llmClient, logger: noopLogger },
      {
        userId: 'u', groupKey: 'g', date: '2026-04-15',
        previousState: null, last3Summaries: [], todaysMessages: [],
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('llm-call-failed');
  });

  it('handles cold-start input (null state, empty summaries) without error', async () => {
    const llmClient = new FakeLlmClient([
      { type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) },
    ]);

    const result = await aggregateDigest(
      { llmClient, logger: noopLogger },
      {
        userId: 'u', groupKey: 'grupa-wedkarska-skool', date: '2026-04-15',
        previousState: null,
        last3Summaries: [],
        todaysMessages: [],
      },
    );

    expect(result.ok).toBe(true);
    // Verify the prompt embedded an empty-state placeholder (not "null")
    const prompt = llmClient.calls[0]?.prompt ?? '';
    expect(prompt).toContain('previousState (lub {} dla cold start)');
  });

  it('handles previousState = empty object equivalently to null', async () => {
    const llmClient = new FakeLlmClient([
      { type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) },
    ]);

    const result = await aggregateDigest(
      { llmClient, logger: noopLogger },
      {
        userId: 'u', groupKey: 'grupa-wedkarska-skool', date: '2026-04-15',
        previousState: {},
        last3Summaries: [],
        todaysMessages: [],
      },
    );

    expect(result.ok).toBe(true);
  });
});

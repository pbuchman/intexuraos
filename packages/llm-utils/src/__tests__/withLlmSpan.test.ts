import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';

import { withLlmSpan } from '../withLlmSpan.js';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => {
  trace.setGlobalTracerProvider(provider);
});

afterAll(async () => {
  await provider.shutdown();
  trace.disable();
});

beforeEach(() => {
  exporter.reset();
});

describe('withLlmSpan', () => {
  it('records all attributes including cached_input_tokens when provided', async () => {
    const { result, durationMs } = await withLlmSpan(
      LlmProviders.Anthropic,
      () =>
        Promise.resolve({
          content: 'hi',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001, cachedInputTokens: 7 },
        }),
      ({ usage }) => ({
        model: 'claude-sonnet-4-5',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        costUsd: usage.costUsd,
      })
    );

    expect(result.content).toBe('hi');
    expect(durationMs).toBeGreaterThanOrEqual(0);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    if (span === undefined) throw new Error('no span');
    expect(span.name).toBe('llm.anthropic.generate');
    expect(span.status.code).toBe(SpanStatusCode.OK);
    expect(span.attributes['llm.provider']).toBe(LlmProviders.Anthropic);
    expect(span.attributes['llm.model']).toBe('claude-sonnet-4-5');
    expect(span.attributes['llm.input_tokens']).toBe(10);
    expect(span.attributes['llm.output_tokens']).toBe(5);
    expect(span.attributes['llm.cached_input_tokens']).toBe(7);
    expect(span.attributes['llm.cost_usd']).toBe(0.001);
    expect(span.attributes['llm.duration_ms']).toBeGreaterThanOrEqual(0);
  });

  it('omits cached_input_tokens attribute when undefined', async () => {
    await withLlmSpan(
      LlmProviders.Google,
      () =>
        Promise.resolve({
          usage: { inputTokens: 1, outputTokens: 2, costUsd: 0 },
        }),
      ({ usage }) => ({
        model: LlmModels.Gemini25Flash,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: usage.costUsd,
      })
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    if (span === undefined) throw new Error('no span');
    expect(span.name).toBe('llm.google.generate');
    expect(Object.hasOwn(span.attributes, 'llm.cached_input_tokens')).toBe(false);
  });

  it('records ERROR status, propagates the message, rethrows, and still records duration_ms', async () => {
    const boom = new Error('boom');
    await expect(
      withLlmSpan(
        LlmProviders.OpenAI,
        () => Promise.reject(boom),
        () => {
          throw new Error('should not be called on error path');
        }
      )
    ).rejects.toBe(boom);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    if (span === undefined) throw new Error('no span');
    expect(span.name).toBe('llm.openai.generate');
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe('boom');
    expect(span.attributes['llm.duration_ms']).toBeGreaterThanOrEqual(0);
    expect(span.attributes['llm.provider']).toBe(LlmProviders.OpenAI);
  });

  it('handles non-Error thrown values via getErrorMessage', async () => {
    await expect(
      withLlmSpan(
        LlmProviders.Perplexity,
        () => Promise.reject('string-error'),
        () => ({ model: 'm', inputTokens: 0, outputTokens: 0, costUsd: 0 })
      )
    ).rejects.toBe('string-error');

    const spans = exporter.getFinishedSpans();
    const span = spans[0];
    if (span === undefined) throw new Error('no span');
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    // getErrorMessage returns the string as-is when it's a non-empty string
    expect(span.status.message).toBe('string-error');
  });

  it('returns a non-negative durationMs', async () => {
    const { durationMs } = await withLlmSpan(
      LlmProviders.OpenRouter,
      () => Promise.resolve({ usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }),
      ({ usage }) => ({
        model: 'or:openai/gpt-4o',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: usage.costUsd,
      })
    );
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });
});

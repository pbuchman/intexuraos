import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { Logger } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import {
  callVerificationLlm,
  generateResumeSummaryWithFallback,
} from '../../../services/completion-verifier/llm-client.js';

const loggerInfo = vi.fn();
const loggerWarn = vi.fn();
const loggerError = vi.fn();
const loggerDebug = vi.fn();

const logger: Logger = {
  info: loggerInfo as Logger['info'],
  warn: loggerWarn as Logger['warn'],
  error: loggerError as Logger['error'],
  debug: loggerDebug as Logger['debug'],
};

const schema = z.object({ field: z.string() });

function fakeClient(
  response: { ok: true; content: string } | { ok: false; code: string }
): LlmGenerateClient {
  return {
    generate: vi.fn().mockImplementation(() => {
      if (response.ok) {
        return Promise.resolve({ ok: true, value: { content: response.content } });
      }
      return Promise.resolve({ ok: false, error: { code: response.code } });
    }),
  } as unknown as LlmGenerateClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('callVerificationLlm', () => {
  it('returns ok when the first client returns valid JSON matching schema', async () => {
    const result = await callVerificationLlm({
      models: [
        {
          client: fakeClient({ ok: true, content: '{"field":"hello"}' }),
          modelName: 'primary',
        },
      ],
      prompt: 'p',
      schema,
      logger,
      taskId: 'task_1',
      attempt: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.modelName).toBe('primary');
      expect(result.value.content).toBe('{"field":"hello"}');
      expect(result.value.parsed).toEqual({ field: 'hello' });
    }
  });

  it('falls through to next client when content is unparseable', async () => {
    const result = await callVerificationLlm({
      models: [
        {
          client: fakeClient({ ok: true, content: 'not json at all' }),
          modelName: 'primary',
        },
        {
          client: fakeClient({ ok: true, content: '{"field":"ok"}' }),
          modelName: 'fallback-1',
        },
      ],
      prompt: 'p',
      schema,
      logger,
      taskId: 'task_1',
      attempt: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.modelName).toBe('fallback-1');
    }
    // Expect warning log about parsing failure
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task_1',
        model: 'primary',
      }),
      'Completion verifier response parsing failed, trying next model'
    );
  });

  it('falls through when primary generate fails; fallback succeeds', async () => {
    const result = await callVerificationLlm({
      models: [
        { client: fakeClient({ ok: false, code: 'rate_limited' }), modelName: 'primary' },
        {
          client: fakeClient({ ok: true, content: '{"field":"ok"}' }),
          modelName: 'fallback-1',
        },
      ],
      prompt: 'p',
      schema,
      logger,
      taskId: 'task_1',
      attempt: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.modelName).toBe('fallback-1');
    }
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task_1',
        model: 'primary',
        errorCode: 'rate_limited',
      }),
      'Completion verifier model call failed, trying next'
    );
  });

  it('returns kind=schema-failed when schema validation fails on every model', async () => {
    const result = await callVerificationLlm({
      models: [
        {
          client: fakeClient({ ok: true, content: '{"wrong_key":"x"}' }),
          modelName: 'primary',
        },
      ],
      prompt: 'p',
      schema,
      logger,
      taskId: 'task_1',
      attempt: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('schema-failed');
      expect(result.error.modelName).toBe('primary');
      expect(result.error.missingFields).toContain('field');
    }
  });

  it('returns kind=all-failed when every client fails at generate', async () => {
    const result = await callVerificationLlm({
      models: [
        { client: fakeClient({ ok: false, code: 'rate_limited' }), modelName: 'primary' },
        { client: fakeClient({ ok: false, code: 'timeout' }), modelName: 'fallback-1' },
      ],
      prompt: 'p',
      schema,
      logger,
      taskId: 'task_1',
      attempt: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('all-failed');
      expect(result.error.content).toBe('');
      // When no model ever produced content, modelName is empty string
      expect(result.error.modelName).toBe('');
    }
  });

  it('returns kind=all-failed when every client returns unparseable content', async () => {
    const result = await callVerificationLlm({
      models: [
        { client: fakeClient({ ok: true, content: 'not json' }), modelName: 'primary' },
        { client: fakeClient({ ok: true, content: 'also not json' }), modelName: 'fallback-1' },
      ],
      prompt: 'p',
      schema,
      logger,
      taskId: 'task_1',
      attempt: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('all-failed');
    }
  });
});

describe('generateResumeSummaryWithFallback', () => {
  it('returns primary success without touching fallbacks', async () => {
    const fallbackGen = vi.fn();
    const result = await generateResumeSummaryWithFallback({
      primaryClient: fakeClient({ ok: true, content: '{"summary":"ok"}' }),
      primaryModelName: 'primary',
      fallbacks: [
        {
          client: { generate: fallbackGen } as unknown as LlmGenerateClient,
          modelName: 'fallback-1',
        },
      ],
      prompt: 'p',
      taskId: 'task_1',
      logger,
    });
    expect(result.ok).toBe(true);
    expect(result.modelName).toBe('primary');
    expect(fallbackGen).not.toHaveBeenCalled();
  });

  it('tries fallbacks in order and returns first success', async () => {
    const fallback1 = fakeClient({ ok: true, content: '{"summary":"from-f1"}' });
    const fallback2Gen = vi.fn();
    const result = await generateResumeSummaryWithFallback({
      primaryClient: fakeClient({ ok: false, code: 'rate_limited' }),
      primaryModelName: 'primary',
      fallbacks: [
        { client: fallback1, modelName: 'fallback-1' },
        {
          client: { generate: fallback2Gen } as unknown as LlmGenerateClient,
          modelName: 'fallback-2',
        },
      ],
      prompt: 'p',
      taskId: 'task_1',
      logger,
    });
    expect(result.ok).toBe(true);
    expect(result.modelName).toBe('fallback-1');
    // fallback-2 must NOT have been called once fallback-1 succeeded
    expect(fallback2Gen).not.toHaveBeenCalled();
  });

  it('falls through to fallback-2 when fallback-1 also fails', async () => {
    const fallback1Gen = vi.fn().mockResolvedValue({ ok: false, error: { code: 'timeout' } });
    const fallback2Gen = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { content: '{"summary":"from-f2"}' } });
    const result = await generateResumeSummaryWithFallback({
      primaryClient: fakeClient({ ok: false, code: 'rate_limited' }),
      primaryModelName: 'primary',
      fallbacks: [
        {
          client: { generate: fallback1Gen } as unknown as LlmGenerateClient,
          modelName: 'fallback-1',
        },
        {
          client: { generate: fallback2Gen } as unknown as LlmGenerateClient,
          modelName: 'fallback-2',
        },
      ],
      prompt: 'p',
      taskId: 'task_1',
      logger,
    });
    expect(result.ok).toBe(true);
    expect(result.modelName).toBe('fallback-2');
    // ORDER: fallback-1 is tried before fallback-2
    expect(fallback1Gen).toHaveBeenCalledTimes(1);
    expect(fallback2Gen).toHaveBeenCalledTimes(1);
    expect(fallback1Gen.mock.invocationCallOrder[0]).toBeLessThan(
      fallback2Gen.mock.invocationCallOrder[0] ?? Infinity
    );
  });

  it('returns primary error (ok=false) and primary modelName when all models fail', async () => {
    const result = await generateResumeSummaryWithFallback({
      primaryClient: fakeClient({ ok: false, code: 'rate_limited' }),
      primaryModelName: 'primary',
      fallbacks: [
        { client: fakeClient({ ok: false, code: 'timeout' }), modelName: 'fallback-1' },
        { client: fakeClient({ ok: false, code: 'timeout' }), modelName: 'fallback-2' },
      ],
      prompt: 'p',
      taskId: 'task_1',
      logger,
    });
    expect(result.ok).toBe(false);
    // Preserves the primary's error, and reports the primary model name
    expect(result.modelName).toBe('primary');
  });
});

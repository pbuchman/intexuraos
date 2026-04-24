import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import {
  extractAndParseJson,
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

describe('extractAndParseJson', () => {
  it('parses a pure JSON object', () => {
    expect(extractAndParseJson('{"summary":"ok"}')).toEqual({ summary: 'ok' });
  });

  it('extracts a JSON object embedded in surrounding text', () => {
    expect(extractAndParseJson('noise {"summary":"ok"} trailing')).toEqual({ summary: 'ok' });
  });

  it('throws when no object is present', () => {
    expect(() => extractAndParseJson('no json here')).toThrow();
  });

  it('throws when input is not valid JSON despite braces', () => {
    expect(() => extractAndParseJson('{this is not json}')).toThrow();
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
    expect(fallback1Gen).toHaveBeenCalledTimes(1);
    expect(fallback2Gen).toHaveBeenCalledTimes(1);
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
    expect(result.modelName).toBe('primary');
  });
});

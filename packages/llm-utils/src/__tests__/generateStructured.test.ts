import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { err, ok, type Result } from '@intexuraos/common-core';
import type { LLMError } from '@intexuraos/llm-contract';

import {
  generateStructured,
  type StructuredClient,
  type StructuredGenerateResult,
} from '../generateStructured.js';

const schema = z.object({ answer: z.string(), score: z.number() });

const zeroUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
};

interface Call {
  prompt: string;
  promptType: string;
}

function makeClient(responses: Result<StructuredGenerateResult, LLMError>[]): {
  client: StructuredClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  let i = 0;
  return {
    calls,
    client: {
      generate: async (
        prompt: string,
        options: { promptType: string }
      ): Promise<Result<StructuredGenerateResult, LLMError>> => {
        calls.push({ prompt, promptType: options.promptType });
        const response = responses[i] ?? responses[responses.length - 1];
        i += 1;
        if (response === undefined) {
          throw new Error('test setup error: no response configured');
        }
        return response;
      },
    },
  };
}

describe('generateStructured', () => {
  it('parses a clean JSON response', async () => {
    const { client } = makeClient([
      ok({ content: '{"answer":"yes","score":1}', usage: zeroUsage }),
    ]);

    const res = await generateStructured({ client, prompt: 'q', schema, promptType: 'test' });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.data).toEqual({ answer: 'yes', score: 1 });
      expect(res.value.repairAttempts).toBe(0);
      expect(res.value.raw).toBe('{"answer":"yes","score":1}');
      expect(res.value.usage).toEqual(zeroUsage);
    }
  });

  it('strips fenced markdown code blocks before parsing', async () => {
    const { client } = makeClient([
      ok({
        content: '```json\n{"answer":"yes","score":1}\n```',
        usage: zeroUsage,
      }),
    ]);

    const res = await generateStructured({ client, prompt: 'q', schema, promptType: 'test' });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.data).toEqual({ answer: 'yes', score: 1 });
    }
  });

  it('strips bare ``` fences (no `json` tag) before parsing', async () => {
    const { client } = makeClient([
      ok({
        content: '```\n{"answer":"yes","score":1}\n```',
        usage: zeroUsage,
      }),
    ]);

    const res = await generateStructured({ client, prompt: 'q', schema, promptType: 'test' });

    expect(res.ok).toBe(true);
  });

  it('invokes repairBuilder once on validation failure and re-runs generate', async () => {
    const { client, calls } = makeClient([
      ok({ content: '{"answer":"yes"}', usage: zeroUsage }),
      ok({ content: '{"answer":"yes","score":1}', usage: zeroUsage }),
    ]);
    const repair = vi.fn(
      (raw: string, e: z.ZodError) => `FIX: ${String(e.issues.length)} issues in ${raw}`
    );

    const res = await generateStructured({
      client,
      prompt: 'q',
      schema,
      promptType: 'test',
      repairBuilder: repair,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.repairAttempts).toBe(1);
    }
    expect(calls).toHaveLength(2);
    expect(calls[1]?.prompt.startsWith('FIX:')).toBe(true);
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it('invokes repairBuilder on JSON parse failure', async () => {
    const { client, calls } = makeClient([
      ok({ content: 'not json at all', usage: zeroUsage }),
      ok({ content: '{"answer":"yes","score":1}', usage: zeroUsage }),
    ]);
    const repair = vi.fn((raw: string) => `repair: ${raw}`);

    const res = await generateStructured({
      client,
      prompt: 'q',
      schema,
      promptType: 'test',
      repairBuilder: repair,
    });

    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it('returns a validation error after exhausting repair attempts', async () => {
    const { client, calls } = makeClient([
      ok({ content: '{"answer":"yes"}', usage: zeroUsage }),
      ok({ content: '{"answer":"still no score"}', usage: zeroUsage }),
      ok({ content: '{"answer":"again"}', usage: zeroUsage }),
    ]);

    const res = await generateStructured({
      client,
      prompt: 'q',
      schema,
      promptType: 'test',
      repairBuilder: (raw) => `fix ${raw}`,
      maxRepairAttempts: 2,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('validation');
      if (res.error.kind === 'validation') {
        expect(res.error.zodError).toBeInstanceOf(z.ZodError);
        expect(res.error.raw).toBe('{"answer":"again"}');
      }
    }
    // 1 initial + 2 repair attempts
    expect(calls).toHaveLength(3);
  });

  it('returns a validation error after exhausting JSON-parse repair attempts', async () => {
    const { client, calls } = makeClient([
      ok({ content: 'not json', usage: zeroUsage }),
      ok({ content: 'still not json', usage: zeroUsage }),
    ]);

    const res = await generateStructured({
      client,
      prompt: 'q',
      schema,
      promptType: 'test',
      repairBuilder: (raw) => `fix ${raw}`,
      maxRepairAttempts: 1,
    });

    expect(res.ok).toBe(false);
    if (!res.ok && res.error.kind === 'validation') {
      expect(res.error.raw).toBe('still not json');
      // synthetic ZodError with custom-coded issue
      expect(res.error.zodError.issues[0]?.code).toBe('custom');
    }
    expect(calls).toHaveLength(2);
  });

  it('with no repairBuilder, performs a single attempt and returns validation error', async () => {
    const { client, calls } = makeClient([ok({ content: '{"answer":"yes"}', usage: zeroUsage })]);

    const res = await generateStructured({
      client,
      prompt: 'q',
      schema,
      promptType: 'test',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('validation');
    }
    expect(calls).toHaveLength(1);
  });

  it('with no repairBuilder, returns validation error on JSON parse failure (single attempt)', async () => {
    const { client, calls } = makeClient([ok({ content: 'not json', usage: zeroUsage })]);

    const res = await generateStructured({
      client,
      prompt: 'q',
      schema,
      promptType: 'test',
    });

    expect(res.ok).toBe(false);
    if (!res.ok && res.error.kind === 'validation') {
      expect(res.error.zodError.issues[0]?.code).toBe('custom');
    }
    expect(calls).toHaveLength(1);
  });

  it('returns an llm error if client.generate returns a non-ok Result', async () => {
    const { client, calls } = makeClient([
      err({ code: 'RATE_LIMITED', message: 'slow down' } as LLMError),
    ]);

    const res = await generateStructured({
      client,
      prompt: 'q',
      schema,
      promptType: 'test',
      repairBuilder: (raw) => `fix ${raw}`,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('llm');
      if (res.error.kind === 'llm') {
        expect(res.error.error.code).toBe('RATE_LIMITED');
      }
    }
    // No retry on llm error
    expect(calls).toHaveLength(1);
  });

  // Covers generateStructured.ts:106 — `match[1] ?? trimmed` fallback. The
  // FENCED regex's capture group is non-optional, but `noUncheckedIndexedAccess`
  // widens `match[1]` to `string | undefined`, so the fallback exists for
  // type-safety. Force it by stubbing exec to return a match with no group.
  it('falls back to trimmed content when fenced regex match has no capture group', async () => {
    const fenced = '```json\n{"answer":"yes","score":1}\n```';
    const execSpy = vi.spyOn(RegExp.prototype, 'exec').mockImplementationOnce(function (
      this: RegExp,
      str: string
    ) {
      // Return a match-like object with [1] === undefined to force the
      // `?? trimmed` arm. JSON.parse on `trimmed` (with backticks) will fail
      // — generateStructured surfaces this as a validation error whose `raw`
      // includes the original fenced content.
      const fakeMatch = [str] as unknown as RegExpExecArray;
      (fakeMatch as unknown as { index: number }).index = 0;
      (fakeMatch as unknown as { input: string }).input = str;
      return fakeMatch;
    });

    const { client } = makeClient([ok({ content: fenced, usage: zeroUsage })]);
    const res = await generateStructured({ client, prompt: 'q', schema, promptType: 'test' });

    expect(execSpy).toHaveBeenCalled();
    // JSON.parse(trimmed) fails because trimmed still contains backticks, so
    // the helper reports a validation error with raw === fenced.
    expect(res.ok).toBe(false);
    if (!res.ok && res.error.kind === 'validation') {
      expect(res.error.raw).toBe(fenced);
    }

    execSpy.mockRestore();
  });

  it('forwards options (excluding promptType) into client.generate', async () => {
    const { client, calls } = makeClient([
      ok({ content: '{"answer":"y","score":2}', usage: zeroUsage }),
    ]);
    const captured: Record<string, unknown>[] = [];
    const wrapped: StructuredClient = {
      generate: async (prompt, options) => {
        captured.push(options as unknown as Record<string, unknown>);
        return client.generate(prompt, options);
      },
    };

    await generateStructured({
      client: wrapped,
      prompt: 'q',
      schema,
      promptType: 'my-prompt-type',
      options: { extraField: 'forward-me' } as unknown as never,
    });

    expect(calls).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      promptType: 'my-prompt-type',
      extraField: 'forward-me',
    });
  });
});

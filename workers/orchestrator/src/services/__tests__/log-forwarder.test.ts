import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { LogForwarder } from '../log-forwarder.js';
import { stripBulkMetadata } from '../log-formatter.js';
import type { Logger } from '@intexuraos/common-core';

/* eslint-disable @typescript-eslint/no-empty-function */
const mockLogger: Logger = {
  info(): void {},
  warn(): void {},
  error(): void {},
  debug(): void {},
};

const baseConfig = {
  logBasePath: '/tmp/logs',
  codeAgentUrl: 'http://localhost:3000',
  orchestratorSecret: 'test-secret',
  internalAuthToken: 'test-token',
};

function okResponse(): Response {
  return new Response('{}', { status: 200 });
}

describe('LogForwarder', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let forwarder: LogForwarder;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    forwarder = new LogForwarder(baseConfig, mockLogger);
  });

  afterEach(() => {
    for (const taskId of forwarder.getActiveTaskIds()) {
      const state = (forwarder as unknown as Record<string, unknown>)['forwarders'] as Map<
        string,
        { timer: NodeJS.Timeout | null; pollTimer: NodeJS.Timeout | null }
      >;
      const s = state.get(taskId);
      if (s?.timer !== null && s?.timer !== undefined) clearInterval(s.timer);
      if (s?.pollTimer !== null && s?.pollTimer !== undefined) clearInterval(s.pollTimer);
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('timestamp-based sequences', () => {
    it('uses Date.now() for chunk sequences', async () => {
      vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-1', 'secret');
      forwarder.appendChunk('task-1', 'line 1\n');
      await forwarder.flush('task-1');

      const call = fetchSpy.mock.calls[0];
      const opts = call?.[1] ?? {};
      const body = JSON.parse((opts as Record<string, unknown>)['body'] as string) as {
        chunks: { sequence: number }[];
      };
      const chunk = body.chunks[0] ?? { sequence: -1 };
      // Sequence should be based on Date.now(), not an incrementing counter
      expect(chunk.sequence).toBeGreaterThan(1_000_000_000_000);
    });

    it('does not collide across flushAndStop cycles', async () => {
      vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-1', 'secret');
      forwarder.appendChunk('task-1', 'line 1\n');
      await forwarder.flushAndStop('task-1');

      const firstCall = fetchSpy.mock.calls[0];
      const firstBody = JSON.parse(
        ((firstCall?.[1] ?? {}) as Record<string, unknown>)['body'] as string
      ) as { chunks: { sequence: number }[] };
      const firstSeq = firstBody.chunks[0]?.sequence ?? -1;

      // Advance time to simulate resume
      vi.setSystemTime(new Date('2025-06-15T12:05:00Z'));
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.appendChunk('task-1', 'line 2\n');
      await forwarder.flush('task-1');

      const secondCall = fetchSpy.mock.calls[1];
      const secondBody = JSON.parse(
        ((secondCall?.[1] ?? {}) as Record<string, unknown>)['body'] as string
      ) as { chunks: { sequence: number }[] };
      const secondSeq = secondBody.chunks[0]?.sequence ?? -1;

      expect(secondSeq).toBeGreaterThan(firstSeq);
    });
  });

  describe('close', () => {
    it('removes forwarding state for a task', async () => {
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-1', 'secret');
      forwarder.appendChunk('task-1', 'line\n');
      await forwarder.flush('task-1');

      forwarder.close('task-1');

      expect(forwarder.getActiveTaskIds()).not.toContain('task-1');
    });
  });

  describe('flush', () => {
    it('flushes partial line', async () => {
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-1', 'secret');
      forwarder.appendChunk('task-1', 'no newline');
      await forwarder.flush('task-1');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does nothing for unknown task', async () => {
      await forwarder.flush('unknown');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('sendWithRetry', () => {
    it('treats 200 response as success', async () => {
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-1', 'secret');
      forwarder.appendChunk('task-1', 'line\n');
      await forwarder.flush('task-1');

      expect(forwarder.getDroppedChunkCount('task-1')).toBe(0);
    });
  });

  describe('sendBatch dropped chunks', () => {
    it('increments droppedChunks on failure', async () => {
      fetchSpy.mockResolvedValue(new Response('', { status: 500 }));
      forwarder.registerTask('task-1', 'secret');
      forwarder.appendChunk('task-1', 'line\n');

      vi.useRealTimers();
      await forwarder.flush('task-1');

      expect(forwarder.getDroppedChunkCount('task-1')).toBeGreaterThan(0);
    });
  });

  describe('fallback secret derivation', () => {
    it('derives webhook secret from orchestratorSecret when task not registered', async () => {
      const expectedSecret = createHmac('sha256', baseConfig.orchestratorSecret)
        .update('task-unregistered')
        .digest('hex');

      fetchSpy.mockImplementation(async (_url: string | URL | Request, init?: RequestInit) => {
        const opts = init as Record<string, unknown>;
        const sig = (opts['headers'] as Record<string, string>)['X-Request-Signature'];
        const ts = (opts['headers'] as Record<string, string>)['X-Request-Timestamp'];
        const body = opts['body'] as string;

        // Verify the signature was computed with the derived secret
        const message = `${ts}.${body}`;
        const expected = createHmac('sha256', expectedSecret).update(message).digest('hex');
        expect(sig).toBe(expected);

        return okResponse();
      });

      // Do NOT call registerTask — simulate post-restart state
      forwarder.appendChunk('task-unregistered', 'log line\n');
      await forwarder.flush('task-unregistered');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('bulk metadata stripping', () => {
    it('strips tool_use_result from appendChunk before reaching fetch', async () => {
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-1', 'secret');

      const bigPayload = JSON.stringify({
        type: 'tool_result',
        tool_use_result: { originalFile: 'x'.repeat(60_000), oldString: 'a', newString: 'b' },
        tool_name: 'Edit',
        content: 'edited file.ts',
      });
      forwarder.appendChunk('task-1', bigPayload + '\n');
      await forwarder.flush('task-1');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const call = fetchSpy.mock.calls[0];
      const opts = call?.[1] ?? {};
      const body = JSON.parse((opts as Record<string, unknown>)['body'] as string) as {
        chunks: { content: string }[];
      };
      const content = body.chunks[0]?.content ?? '';
      expect(content).not.toContain('tool_use_result');
      expect(content).toContain('tool_name');
      expect(content.length).toBeLessThan(5000);
    });
  });
});

describe('stripBulkMetadata', () => {
  it('removes tool_use_result from a valid JSON line', () => {
    const line = JSON.stringify({
      type: 'tool_result',
      tool_use_result: { originalFile: 'full file content', oldString: 'a', newString: 'b' },
      tool_name: 'Edit',
    });
    const result = stripBulkMetadata(line);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('tool_use_result');
    expect(parsed).toHaveProperty('tool_name', 'Edit');
    expect(parsed).toHaveProperty('type', 'tool_result');
  });

  it('preserves lines without tool_use_result', () => {
    const line = JSON.stringify({ type: 'assistant', message: 'hello' });
    const result = stripBulkMetadata(line);
    expect(result).toBe(line);
  });

  it('handles multi-line content with mixed lines', () => {
    const withMeta = JSON.stringify({ tool_use_result: { originalFile: 'big' }, id: '1' });
    const without = JSON.stringify({ type: 'text', id: '2' });
    const input = `${withMeta}\n${without}`;
    const result = stripBulkMetadata(input);
    const lines = result.split('\n');
    const first = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    const second = JSON.parse(lines[1] ?? '') as Record<string, unknown>;
    expect(first).not.toHaveProperty('tool_use_result');
    expect(first).toHaveProperty('id', '1');
    expect(second).toHaveProperty('type', 'text');
  });

  it('passes through partial/invalid JSON unchanged', () => {
    const partial = '{"tool_use_result": {"orig';
    const result = stripBulkMetadata(partial);
    expect(result).toBe(partial);
  });

  it('returns content unchanged when no tool_use_result present', () => {
    const content = '{"type":"assistant"}\n{"type":"text"}';
    const result = stripBulkMetadata(content);
    expect(result).toBe(content);
  });
});

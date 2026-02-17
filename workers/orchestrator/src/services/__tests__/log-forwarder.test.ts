import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { LogForwarder } from '../log-forwarder.js';
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

function ackResponse(sequences: number[]): Response {
  return new Response(JSON.stringify({ acknowledgedSequences: sequences }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

  describe('monotonic sequence across flushAndStop cycles', () => {
    it('never resets sequence after flushAndStop and new appendChunk', async () => {
      fetchSpy.mockResolvedValue(ackResponse([0]));
      forwarder.registerTask('task-1', 'secret');
      forwarder.appendChunk('task-1', 'line 1\n');
      await forwarder.flushAndStop('task-1');

      const firstCall = fetchSpy.mock.calls[0];
      const firstOpts = firstCall?.[1] ?? {};
      const firstCallBody = JSON.parse(
        (firstOpts as Record<string, unknown>)['body'] as string
      ) as { chunks: { sequence: number }[] };
      const firstChunk = firstCallBody.chunks[0] ?? { sequence: -1 };
      expect(firstChunk.sequence).toBe(0);

      fetchSpy.mockResolvedValue(ackResponse([1]));
      forwarder.appendChunk('task-1', 'line 2\n');
      await forwarder.flush('task-1');

      const secondCall = fetchSpy.mock.calls[1];
      const secondOpts = secondCall?.[1] ?? {};
      const secondCallBody = JSON.parse(
        (secondOpts as Record<string, unknown>)['body'] as string
      ) as { chunks: { sequence: number }[] };
      const secondChunk = secondCallBody.chunks[0] ?? { sequence: -1 };
      expect(secondChunk.sequence).toBe(1);
    });
  });

  describe('getDeliveryStats', () => {
    it('returns zeros for unknown task', () => {
      expect(forwarder.getDeliveryStats('unknown')).toEqual({
        produced: 0,
        acked: 0,
        pending: 0,
      });
    });

    it('returns correct stats after sending and acking', async () => {
      fetchSpy.mockResolvedValue(ackResponse([0]));
      forwarder.registerTask('task-1', 'secret');
      forwarder.appendChunk('task-1', 'line 1\nline 2\n');
      await forwarder.flush('task-1');

      const stats = forwarder.getDeliveryStats('task-1');
      expect(stats.produced).toBe(1);
      expect(stats.acked).toBe(0);
      expect(stats.pending).toBe(0);
    });

    it('tracks pending when no ack received', async () => {
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-1', 'secret');
      forwarder.appendChunk('task-1', 'line 1\n');
      await forwarder.flush('task-1');

      const stats = forwarder.getDeliveryStats('task-1');
      expect(stats.produced).toBe(1);
      expect(stats.acked).toBe(0);
      expect(stats.pending).toBe(0);
    });

    it('shows pending for multiple produced with partial ack', async () => {
      fetchSpy.mockResolvedValueOnce(ackResponse([0]));
      forwarder.registerTask('task-1', 'secret');
      forwarder.appendChunk('task-1', 'line 1\n');
      await forwarder.flush('task-1');

      fetchSpy.mockResolvedValueOnce(okResponse());
      forwarder.appendChunk('task-1', 'line 2\n');
      await forwarder.flush('task-1');

      const stats = forwarder.getDeliveryStats('task-1');
      expect(stats.produced).toBe(2);
      expect(stats.acked).toBe(0);
      expect(stats.pending).toBe(1);
    });
  });

  describe('awaitDrain', () => {
    it('resolves immediately when no sequences produced', async () => {
      vi.useRealTimers();
      forwarder = new LogForwarder(baseConfig, mockLogger);
      forwarder.registerTask('task-1', 'secret');
      await forwarder.awaitDrain('task-1', 1000);
    });

    it('resolves immediately for unknown task', async () => {
      vi.useRealTimers();
      forwarder = new LogForwarder(baseConfig, mockLogger);
      await forwarder.awaitDrain('unknown', 1000);
    });

    it('throws on timeout when not fully acked', async () => {
      vi.useRealTimers();
      fetchSpy = vi.spyOn(globalThis, 'fetch');
      forwarder = new LogForwarder(baseConfig, mockLogger);
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-1', 'secret');
      forwarder.appendChunk('task-1', 'first\n');
      await forwarder.flush('task-1');

      forwarder.appendChunk('task-1', 'second\n');
      await forwarder.flush('task-1');

      await expect(forwarder.awaitDrain('task-1', 100)).rejects.toThrow(/Log drain timeout/);
    });
  });

  describe('close', () => {
    it('removes all tracking for a task', async () => {
      fetchSpy.mockResolvedValue(ackResponse([0]));
      forwarder.registerTask('task-1', 'secret');
      forwarder.appendChunk('task-1', 'line\n');
      await forwarder.flush('task-1');

      forwarder.close('task-1');

      expect(forwarder.getDeliveryStats('task-1')).toEqual({
        produced: 0,
        acked: 0,
        pending: 0,
      });
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

  describe('sendWithRetry ACK parsing', () => {
    it('handles non-JSON response body gracefully', async () => {
      fetchSpy.mockResolvedValue(new Response('not json', { status: 200 }));
      forwarder.registerTask('task-1', 'secret');
      forwarder.appendChunk('task-1', 'line\n');
      await forwarder.flush('task-1');

      const stats = forwarder.getDeliveryStats('task-1');
      expect(stats.produced).toBe(1);
      expect(stats.acked).toBe(0);
    });

    it('handles missing acknowledgedSequences field', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
      forwarder.registerTask('task-1', 'secret');
      forwarder.appendChunk('task-1', 'line\n');
      await forwarder.flush('task-1');

      const stats = forwarder.getDeliveryStats('task-1');
      expect(stats.acked).toBe(0);
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

        return ackResponse([0]);
      });

      // Do NOT call registerTask — simulate post-restart state
      forwarder.appendChunk('task-unregistered', 'log line\n');
      await forwarder.flush('task-unregistered');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});

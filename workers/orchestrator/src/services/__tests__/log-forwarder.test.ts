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

  describe('flushAndStop early return for unregistered task', () => {
    it('returns early without error when task was never registered', async () => {
      await forwarder.flushAndStop('never-registered');
      // No fetch calls, no errors — just a silent early return
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('flushAndStop clears timer', () => {
    it('clears the interval timer set by appendChunk', async () => {
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-timer', 'secret');
      forwarder.appendChunk('task-timer', 'line\n');

      // appendChunk creates a timer via setInterval — flushAndStop should clear it
      await forwarder.flushAndStop('task-timer');

      // Task should be removed
      expect(forwarder.getActiveTaskIds()).not.toContain('task-timer');
    });
  });

  describe('stopForwarding timer and pollTimer clearing', () => {
    it('clears timer and pollTimer when state has them set', async () => {
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-stop-timers', 'secret');

      // Use appendChunk to create state with a timer (Docker mode)
      forwarder.appendChunk('task-stop-timers', 'line\n');

      // Manually add a pollTimer to simulate startForwarding having set it
      const forwarders = (forwarder as unknown as Record<string, unknown>)['forwarders'] as Map<
        string,
        { timer: NodeJS.Timeout | null; pollTimer: NodeJS.Timeout | null }
      >;
      const state = forwarders.get('task-stop-timers');
      if (state !== undefined) {
        state.pollTimer = setInterval(() => {}, 100);
      }

      await forwarder.stopForwarding('task-stop-timers');
      expect(forwarder.getActiveTaskIds()).not.toContain('task-stop-timers');
    });
  });

  describe('stopForwarding drains partial line', () => {
    it('flushes partial line content accumulated via appendChunk before stopping', async () => {
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-drain', 'secret');

      // Append content without newline — stored as partialLine
      forwarder.appendChunk('task-drain', 'partial content no newline');

      // Access forwarders map to manually set up for stopForwarding path
      const forwarders = (forwarder as unknown as Record<string, unknown>)['forwarders'] as Map<
        string,
        { timer: NodeJS.Timeout | null; pollTimer: NodeJS.Timeout | null }
      >;
      const state = forwarders.get('task-drain');
      // Clear timers before stopForwarding so we control the path
      if (state?.timer !== null && state?.timer !== undefined) {
        clearInterval(state.timer);
        state.timer = null;
      }

      await forwarder.stopForwarding('task-drain');

      // Should have flushed the partial line content
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const call = fetchSpy.mock.calls[0];
      const opts = call?.[1] ?? {};
      const body = JSON.parse((opts as Record<string, unknown>)['body'] as string) as {
        chunks: { content: string }[];
      };
      expect(body.chunks[0]?.content).toContain('partial content no newline');
    });
  });

  describe('appendChunk Docker mode', () => {
    it('creates state from scratch when no prior startForwarding', async () => {
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-docker', 'secret');

      forwarder.appendChunk('task-docker', 'docker log line\n');

      expect(forwarder.getActiveTaskIds()).toContain('task-docker');
      await forwarder.flush('task-docker');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('reassembles partial lines across chunk boundaries', async () => {
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-reassemble', 'secret');

      forwarder.appendChunk('task-reassemble', 'first part');
      forwarder.appendChunk('task-reassemble', ' second part\n');

      await forwarder.flush('task-reassemble');

      const call = fetchSpy.mock.calls[0];
      const opts = call?.[1] ?? {};
      const body = JSON.parse((opts as Record<string, unknown>)['body'] as string) as {
        chunks: { content: string }[];
      };
      expect(body.chunks[0]?.content).toContain('first part second part');
    });

    it('buffers content without newline as partial line', () => {
      forwarder.registerTask('task-noflush', 'secret');
      forwarder.appendChunk('task-noflush', 'no newline here');

      // Access internal state to verify partialLine is set
      const forwarders = (forwarder as unknown as Record<string, unknown>)['forwarders'] as Map<
        string,
        { partialLine: string; buffer: string }
      >;
      const state = forwarders.get('task-noflush');
      expect(state?.partialLine).toBe('no newline here');
      expect(state?.buffer).toBe('');
    });

    it('flushes when buffer exceeds MAX_CHUNK_SIZE', async () => {
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-bigchunk', 'secret');

      // Send content larger than 64KB with newlines
      const bigContent = ('X'.repeat(1024) + '\n').repeat(70);
      forwarder.appendChunk('task-bigchunk', bigContent);

      // The appendChunk should have triggered a void flushBuffer call
      // Advance microtasks so the async flush runs
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe('readNewContent catch block', () => {
    it('logs error when readFileSync fails during polling', async () => {
      const errorSpy = vi.fn();
      const loggerWithError: Logger = {
        info(): void {},
        warn(): void {},
        error: errorSpy,
        debug(): void {},
      };

      const fwd = new LogForwarder(baseConfig, loggerWithError);
      fetchSpy.mockResolvedValue(okResponse());

      // Create a real file, then make it unreadable by starting forwarding
      // with a path that will later fail.
      // Instead, we use a directory path — readFileSync on a directory throws EISDIR.
      const dirPath = '/tmp';
      fwd.startForwarding('task-read-err', dirPath);

      // Advance past one poll interval (100ms) — readNewContent will call
      // existsSync (true for /tmp) then readFileSync('/tmp') which throws EISDIR
      await vi.advanceTimersByTimeAsync(150);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-read-err' }),
        expect.stringMatching(/Failed to read/)
      );

      // Clean up timers
      const forwarders = (fwd as unknown as Record<string, unknown>)['forwarders'] as Map<
        string,
        { timer: NodeJS.Timeout | null; pollTimer: NodeJS.Timeout | null }
      >;
      const state = forwarders.get('task-read-err');
      if (state?.timer !== null && state?.timer !== undefined) clearInterval(state.timer);
      if (state?.pollTimer !== null && state?.pollTimer !== undefined)
        clearInterval(state.pollTimer);
    });
  });

  describe('flushBuffer max total size', () => {
    it('drops chunks when totalBytes exceeds MAX_TOTAL_LOG_SIZE', async () => {
      const warnSpy = vi.fn();
      const loggerWithWarn: Logger = {
        info(): void {},
        warn: warnSpy,
        error(): void {},
        debug(): void {},
      };

      const fwd = new LogForwarder(baseConfig, loggerWithWarn);
      fetchSpy.mockResolvedValue(okResponse());
      fwd.registerTask('task-maxsize', 'secret');
      fwd.appendChunk('task-maxsize', 'init\n');
      await fwd.flush('task-maxsize');

      // Manually set totalBytes to exceed 4MB
      const forwarders = (fwd as unknown as Record<string, unknown>)['forwarders'] as Map<
        string,
        { totalBytes: number; timer: NodeJS.Timeout | null }
      >;
      const state = forwarders.get('task-maxsize');
      if (state !== undefined) {
        state.totalBytes = 4 * 1024 * 1024 + 1;
      }

      // Append more content — should be dropped
      fwd.appendChunk('task-maxsize', 'should be dropped\n');
      // Use flush (non-force) which checks the limit
      await fwd.flush('task-maxsize');

      // flush calls drainPartialLine + flushBuffer(taskId, true) with force=true
      // But we need non-force path. Let's trigger via timer instead.
      // Actually, flush() calls flushBuffer(taskId, true) which bypasses the check.
      // We need to trigger flushBuffer without force. Let's use the timer.

      // Reset and try differently — use appendChunk to put content in buffer,
      // then advance timer to trigger non-force flush
      fwd.appendChunk('task-maxsize', 'more content\n');
      await vi.advanceTimersByTimeAsync(3100); // CHUNK_INTERVAL_MS = 3000

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-maxsize' }),
        'Max total log size reached, stopping uploads'
      );
      expect(fwd.getDroppedChunkCount('task-maxsize')).toBeGreaterThan(0);

      // Clean up timer
      if (state?.timer !== null && state?.timer !== undefined) clearInterval(state.timer);
    });
  });

  describe('sendBatch', () => {
    it('sends chunks and updates totalBytes on success', async () => {
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-batch-ok', 'secret');

      forwarder.appendChunk('task-batch-ok', 'batch content\n');
      await forwarder.flush('task-batch-ok');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(forwarder.getDroppedChunkCount('task-batch-ok')).toBe(0);
    });

    it('increments droppedChunks and logs error on failure', async () => {
      const errorSpy = vi.fn();
      const loggerWithError: Logger = {
        info(): void {},
        warn(): void {},
        error: errorSpy,
        debug(): void {},
      };

      const fwd = new LogForwarder(baseConfig, loggerWithError);
      fetchSpy.mockResolvedValue(new Response('', { status: 400 }));
      fwd.registerTask('task-batch-fail', 'secret');

      fwd.appendChunk('task-batch-fail', 'will fail\n');

      // Need real timers for retry delays
      vi.useRealTimers();
      await fwd.flush('task-batch-fail');

      expect(fwd.getDroppedChunkCount('task-batch-fail')).toBeGreaterThan(0);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-batch-fail',
          url: expect.stringContaining('/internal/logs'),
        }),
        expect.stringContaining('Failed to upload log chunks after retries')
      );

      // Re-enable fake timers for afterEach cleanup
      vi.useFakeTimers();
    });
  });

  describe('sendWithRetry error type narrowing', () => {
    it('handles non-Error throwables in catch block', async () => {
      const warnSpy = vi.fn();
      const loggerWithWarn: Logger = {
        info(): void {},
        warn: warnSpy,
        error(): void {},
        debug(): void {},
      };

      const fwd = new LogForwarder(baseConfig, loggerWithWarn);
      // Throw a non-Error object
      fetchSpy.mockRejectedValue('string error');
      fwd.registerTask('task-non-error', 'secret');
      fwd.appendChunk('task-non-error', 'content\n');

      vi.useRealTimers();
      await fwd.flush('task-non-error');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-non-error',
          error: 'string error',
        }),
        'Log upload failed, retrying'
      );

      vi.useFakeTimers();
    });

    it('handles Error objects in catch block and logs warn', async () => {
      const warnSpy = vi.fn();
      const loggerWithWarn: Logger = {
        info(): void {},
        warn: warnSpy,
        error(): void {},
        debug(): void {},
      };

      const fwd = new LogForwarder(baseConfig, loggerWithWarn);
      fetchSpy.mockRejectedValue(new Error('network failure'));
      fwd.registerTask('task-err-obj', 'secret');
      fwd.appendChunk('task-err-obj', 'content\n');

      vi.useRealTimers();
      await fwd.flush('task-err-obj');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-err-obj',
          name: 'Error',
          message: 'network failure',
        }),
        'Log upload failed, retrying'
      );

      vi.useFakeTimers();
    });
  });

  describe('prefixTimestamps already-prefixed line', () => {
    it('leaves lines with existing timestamp prefix unchanged', async () => {
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-ts-prefix', 'secret');

      // Line already has timestamp prefix format HH:MM:ss.mmm
      forwarder.appendChunk('task-ts-prefix', '12:34:56.789 Already prefixed line\n');
      await forwarder.flush('task-ts-prefix');

      const call = fetchSpy.mock.calls[0];
      const opts = call?.[1] ?? {};
      const body = JSON.parse((opts as Record<string, unknown>)['body'] as string) as {
        chunks: { content: string }[];
      };
      const content = body.chunks[0]?.content ?? '';
      // The line should appear only once with its original timestamp, not double-prefixed
      expect(content).toContain('12:34:56.789 Already prefixed line');
      // Should NOT have a second timestamp prepended
      const lines = content.split('\n').filter((l: string) => l.includes('Already prefixed line'));
      expect(lines.length).toBe(1);
      const line = lines[0] ?? '';
      // Line should start with the original timestamp, not a new one followed by the original
      expect(line).toBe('12:34:56.789 Already prefixed line');
    });
  });

  describe('enforceChunkSize', () => {
    it('returns chunk unchanged when within MAX_CHUNK_SIZE', async () => {
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-small-chunk', 'secret');

      const smallContent = 'small line\n';
      forwarder.appendChunk('task-small-chunk', smallContent);
      await forwarder.flush('task-small-chunk');

      const call = fetchSpy.mock.calls[0];
      const opts = call?.[1] ?? {};
      const body = JSON.parse((opts as Record<string, unknown>)['body'] as string) as {
        chunks: { content: string }[];
      };
      // Content should not be truncated
      expect(body.chunks[0]?.content).not.toContain('[... TRUNCATED ...]');
    });

    it('truncates chunk exceeding MAX_CHUNK_SIZE with head+marker+tail', async () => {
      fetchSpy.mockResolvedValue(okResponse());
      forwarder.registerTask('task-trunc', 'secret');

      // Create a single line that exceeds 64KB (no newlines so it stays as one chunk)
      const hugeContent = 'Z'.repeat(80 * 1024) + '\n';
      forwarder.appendChunk('task-trunc', hugeContent);
      await forwarder.flush('task-trunc');

      const call = fetchSpy.mock.calls[0];
      const opts = call?.[1] ?? {};
      const body = JSON.parse((opts as Record<string, unknown>)['body'] as string) as {
        chunks: { content: string }[];
      };
      const content = body.chunks[0]?.content ?? '';
      expect(content).toContain('[... TRUNCATED ...]');
      expect(content.length).toBeLessThanOrEqual(64 * 1024);
      // Tail should contain Z's (the last 1024 bytes of the original content)
      expect(content).toMatch(/Z{100}/);
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

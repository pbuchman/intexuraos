import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { LogForwarder } from '../log-forwarder.js';

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const config = {
  logBasePath: '/tmp/logs',
  codeAgentUrl: 'http://localhost:3000',
  orchestratorSecret: 'test-secret',
  internalAuthToken: 'test-token',
};

function deferredResponse(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('LogForwarder drain observability', () => {
  let forwarder: LogForwarder;
  const temporaryDirectories: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T10:00:00.000Z'));
    forwarder = new LogForwarder(config, logger);
  });

  afterEach(() => {
    vi.clearAllTimers();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts with a process-unique immutable 128-bit epoch and zero gauges', () => {
    const first = forwarder.getDrainSnapshot();
    const second = new LogForwarder(config, logger).getDrainSnapshot();

    expect(first).toMatchObject({
      processStartedAt: '2026-08-28T10:00:00.000Z',
      activeForwarders: 0,
      bufferedBytes: 0,
      partialLineBytes: 0,
      queuedChunks: 0,
      inFlightBatches: 0,
      inFlightChunks: 0,
      activeFlushOperations: 0,
      openUploadRequests: 0,
      detachedUploadRetryPromises: 0,
      droppedChunksTotal: 0,
      forwarderActivityTotal: 0,
      lastActivityAt: null,
    });
    expect(first.counterEpochId).toMatch(/^[0-9a-f]{32}$/u);
    expect(second.counterEpochId).toMatch(/^[0-9a-f]{32}$/u);
    expect(first.counterEpochId).not.toBe(second.counterEpochId);
    expect(forwarder.getDrainSnapshot().counterEpochId).toBe(first.counterEpochId);
  });

  it('reports partial and buffered content without exposing task data', () => {
    forwarder.appendChunk('task-private', 'complete line\npartial');

    const snapshot = forwarder.getDrainSnapshot();
    expect(snapshot.activeForwarders).toBe(1);
    expect(snapshot.bufferedBytes).toBeGreaterThan(0);
    expect(snapshot.partialLineBytes).toBeGreaterThan(0);
    expect(snapshot.forwarderActivityTotal).toBeGreaterThan(0);
    expect(snapshot.lastActivityAt).toBe('2026-08-28T10:00:00.000Z');
    expect(JSON.stringify(snapshot)).not.toContain('task-private');
    expect(JSON.stringify(snapshot)).not.toContain('complete line');
  });

  it('keeps chunks and a batch in flight after pendingChunks are cleared', async () => {
    const response = deferredResponse();
    vi.spyOn(globalThis, 'fetch').mockReturnValue(response.promise);
    forwarder.registerTask('task-1', 'secret');
    forwarder.appendChunk('task-1', 'line\n');

    const flushing = forwarder.flush('task-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(forwarder.getDrainSnapshot()).toMatchObject({
      queuedChunks: 0,
      inFlightBatches: 1,
      inFlightChunks: 1,
      activeFlushOperations: 1,
      openUploadRequests: 1,
      detachedUploadRetryPromises: 0,
    });

    response.resolve(new Response('{}', { status: 200 }));
    await flushing;
    expect(forwarder.getDrainSnapshot()).toMatchObject({
      inFlightBatches: 0,
      inFlightChunks: 0,
      activeFlushOperations: 0,
      droppedChunksTotal: 0,
    });
  });

  it('keeps fire-and-forget upload and open-request gauges observable', async () => {
    const response = deferredResponse();
    vi.spyOn(globalThis, 'fetch').mockReturnValue(response.promise);
    forwarder.registerTask('task-detached', 'secret');

    forwarder.appendRawChunk('task-detached', 'x'.repeat(64 * 1024));
    await Promise.resolve();
    await Promise.resolve();

    expect(forwarder.getDrainSnapshot()).toMatchObject({
      activeFlushOperations: 1,
      inFlightBatches: 1,
      inFlightChunks: 1,
      openUploadRequests: 1,
      detachedUploadRetryPromises: 1,
    });

    response.resolve(new Response('{}', { status: 200 }));
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(forwarder.getDrainSnapshot()).toMatchObject({
      activeFlushOperations: 0,
      inFlightBatches: 0,
      inFlightChunks: 0,
      openUploadRequests: 0,
      detachedUploadRetryPromises: 0,
    });
  });

  it('keeps an upload open until the response body is cancelled', async () => {
    let releaseCancellation!: () => void;
    let cancellationStarted = false;
    const body = new ReadableStream<Uint8Array>({
      cancel: (): Promise<void> => {
        cancellationStarted = true;
        return new Promise<void>((resolve) => {
          releaseCancellation = resolve;
        });
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
    forwarder.registerTask('task-slow-response', 'secret');
    forwarder.appendChunk('task-slow-response', 'line\n');

    let flushSettled = false;
    const flushing = forwarder.flush('task-slow-response').then(() => {
      flushSettled = true;
    });
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();

    expect(cancellationStarted).toBe(true);
    expect(flushSettled).toBe(false);
    expect(forwarder.getDrainSnapshot()).toMatchObject({
      inFlightBatches: 1,
      inFlightChunks: 1,
      activeFlushOperations: 1,
      openUploadRequests: 1,
    });

    releaseCancellation();
    await flushing;
    expect(forwarder.getDrainSnapshot()).toMatchObject({
      inFlightBatches: 0,
      inFlightChunks: 0,
      activeFlushOperations: 0,
      openUploadRequests: 0,
    });
  });

  it('tracks concurrent flushes independently', async () => {
    const firstResponse = deferredResponse();
    const secondResponse = deferredResponse();
    vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);
    for (const taskId of ['task-1', 'task-2']) {
      forwarder.registerTask(taskId, 'secret');
      forwarder.appendChunk(taskId, 'line\n');
    }

    const flushes = [forwarder.flush('task-1'), forwarder.flush('task-2')];
    await Promise.resolve();
    await Promise.resolve();
    expect(forwarder.getDrainSnapshot()).toMatchObject({
      inFlightBatches: 2,
      inFlightChunks: 2,
      activeFlushOperations: 2,
    });

    firstResponse.resolve(new Response('{}', { status: 200 }));
    secondResponse.resolve(new Response('{}', { status: 200 }));
    await Promise.all(flushes);
    expect(forwarder.getDrainSnapshot().activeFlushOperations).toBe(0);
  });

  it('reserves every later batch before clearing the queue', async () => {
    const firstBatch = deferredResponse();
    vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(firstBatch.promise)
      .mockResolvedValue(new Response('{}', { status: 200 }));
    forwarder.registerTask('task-many', 'secret');
    for (let index = 0; index < 7; index += 1) {
      forwarder.appendRawChunk('task-many', `raw-${String(index)}`);
    }

    const flushing = forwarder.flush('task-many');
    await Promise.resolve();
    await Promise.resolve();
    expect(forwarder.getDrainSnapshot()).toMatchObject({
      queuedChunks: 0,
      inFlightBatches: 2,
      inFlightChunks: 7,
    });

    firstBatch.resolve(new Response('{}', { status: 200 }));
    await flushing;
    expect(forwarder.getDrainSnapshot()).toMatchObject({
      inFlightBatches: 0,
      inFlightChunks: 0,
    });
  });

  it('tracks overlapping flushes for the same task', async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    forwarder.registerTask('task-overlap', 'secret');
    forwarder.appendChunk('task-overlap', 'first\n');
    const firstFlush = forwarder.flush('task-overlap');
    await Promise.resolve();
    forwarder.appendChunk('task-overlap', 'second\n');
    const secondFlush = forwarder.flush('task-overlap');
    await Promise.resolve();
    await Promise.resolve();

    expect(forwarder.getDrainSnapshot()).toMatchObject({
      inFlightBatches: 2,
      inFlightChunks: 2,
      activeFlushOperations: 2,
    });
    first.resolve(new Response('{}', { status: 200 }));
    second.resolve(new Response('{}', { status: 200 }));
    await Promise.all([firstFlush, secondFlush]);
  });

  it('rejects an unsafe close while preserving upload gauges and forwarder state', async () => {
    const response = deferredResponse();
    vi.spyOn(globalThis, 'fetch').mockReturnValue(response.promise);
    forwarder.registerTask('task-close-in-flight', 'secret');
    forwarder.appendChunk('task-close-in-flight', 'line\n');
    const flushing = forwarder.flush('task-close-in-flight');
    await Promise.resolve();

    expect(() => forwarder.close('task-close-in-flight')).toThrow(
      'Cannot close log forwarder while work is pending'
    );
    expect(forwarder.getDrainSnapshot()).toMatchObject({
      activeForwarders: 1,
      inFlightBatches: 1,
      inFlightChunks: 1,
      activeFlushOperations: 1,
    });
    response.resolve(new Response('{}', { status: 200 }));
    await flushing;
    forwarder.close('task-close-in-flight');
    expect(forwarder.getDrainSnapshot().activeForwarders).toBe(0);
  });

  it('treats close for an unknown task as an idempotent no-op', () => {
    const before = forwarder.getDrainSnapshot();

    forwarder.close('task-never-registered');

    expect(forwarder.getDrainSnapshot()).toEqual(before);
  });

  it('closes a forwarder exactly once when two flush-and-stop calls race', async () => {
    forwarder.appendChunk('task-concurrent-stop', '');
    const activityBefore = forwarder.getDrainSnapshot().forwarderActivityTotal;

    await Promise.all([
      forwarder.flushAndStop('task-concurrent-stop'),
      forwarder.flushAndStop('task-concurrent-stop'),
    ]);

    expect(forwarder.getDrainSnapshot()).toMatchObject({
      activeForwarders: 0,
      activeFlushOperations: 0,
      forwarderActivityTotal: activityBefore + 5,
    });
  });

  it('waits for an earlier upload before flushAndStop closes the task', async () => {
    const response = deferredResponse();
    vi.spyOn(globalThis, 'fetch').mockReturnValue(response.promise);
    forwarder.registerTask('task-stop-in-flight', 'secret');
    forwarder.appendChunk('task-stop-in-flight', 'line\n');
    const flushing = forwarder.flush('task-stop-in-flight');
    await Promise.resolve();

    const stopping = forwarder.flushAndStop('task-stop-in-flight');
    await Promise.resolve();
    expect(forwarder.getDrainSnapshot()).toMatchObject({
      activeForwarders: 1,
      inFlightBatches: 1,
      inFlightChunks: 1,
      activeFlushOperations: 1,
    });

    response.resolve(new Response('{}', { status: 200 }));
    await Promise.all([flushing, stopping]);
    expect(forwarder.getDrainSnapshot()).toMatchObject({
      activeForwarders: 0,
      inFlightBatches: 0,
      inFlightChunks: 0,
      activeFlushOperations: 0,
    });
  });

  it('flushAndStop drains content appended during upload and cancels both timers', async () => {
    const firstResponse = deferredResponse();
    const secondResponse = deferredResponse();
    vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);
    const directory = mkdtempSync(join(tmpdir(), 'log-forwarder-drain-'));
    temporaryDirectories.push(directory);
    const logFilePath = join(directory, 'task.log');
    writeFileSync(logFilePath, '');

    forwarder.registerTask('task-stop-race', 'secret');
    forwarder.startForwarding('task-stop-race', logFilePath);
    forwarder.appendChunk('task-stop-race', 'first line\n');
    const stopping = forwarder.flushAndStop('task-stop-race');
    await Promise.resolve();
    await Promise.resolve();

    forwarder.appendChunk('task-stop-race', 'second line\n');
    firstResponse.resolve(new Response('{}', { status: 200 }));
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(forwarder.getDrainSnapshot().activeForwarders).toBe(1);

    secondResponse.resolve(new Response('{}', { status: 200 }));
    await stopping;
    expect(forwarder.getDrainSnapshot()).toMatchObject({
      activeForwarders: 0,
      bufferedBytes: 0,
      partialLineBytes: 0,
      queuedChunks: 0,
      inFlightBatches: 0,
      inFlightChunks: 0,
      activeFlushOperations: 0,
    });

    const requestBodies = vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([, init]) => String(init?.body));
    expect(requestBodies.some((body) => body.includes('first line'))).toBe(true);
    expect(requestBodies.some((body) => body.includes('second line'))).toBe(true);

    const activityAfterStop = forwarder.getDrainSnapshot().forwarderActivityTotal;
    writeFileSync(logFilePath, 'late line\n');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(forwarder.getDrainSnapshot().forwarderActivityTotal).toBe(activityAfterStop);
  });

  it('records no-op flush start and result as activity', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    forwarder.registerTask('task-noop', 'secret');
    forwarder.appendChunk('task-noop', 'line\n');
    await forwarder.flush('task-noop');
    const before = forwarder.getDrainSnapshot().forwarderActivityTotal;
    await forwarder.flush('task-noop');
    expect(forwarder.getDrainSnapshot().forwarderActivityTotal).toBe(before + 2);
  });

  it('measures UTF-8 buffers in bytes and exposes an exact privacy-safe schema', () => {
    forwarder.appendChunk('task-private-utf8', 'ą');
    const snapshot = forwarder.getDrainSnapshot();
    expect(snapshot.partialLineBytes).toBe(Buffer.byteLength('ą', 'utf8'));
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        'counterEpochId',
        'processStartedAt',
        'activeForwarders',
        'bufferedBytes',
        'partialLineBytes',
        'queuedChunks',
        'inFlightBatches',
        'inFlightChunks',
        'activeFlushOperations',
        'openUploadRequests',
        'detachedUploadRetryPromises',
        'droppedChunksTotal',
        'forwarderActivityTotal',
        'lastActivityAt',
      ].sort()
    );
  });

  it('keeps retry activity and in-flight gauges observable', async () => {
    vi.useRealTimers();
    const finalResponse = deferredResponse();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockReturnValueOnce(finalResponse.promise);
    forwarder.registerTask('task-retry', 'secret');
    forwarder.appendChunk('task-retry', 'line\n');

    const flushing = forwarder.flush('task-retry');
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const retrying = forwarder.getDrainSnapshot();
    expect(retrying.inFlightBatches).toBe(1);
    expect(retrying.inFlightChunks).toBe(1);
    expect(retrying.forwarderActivityTotal).toBeGreaterThanOrEqual(4);

    finalResponse.resolve(new Response('{}', { status: 200 }));
    await flushing;
  });

  it('accounts a transport exception through final failure and releases every gauge', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('transport unavailable'));
    forwarder.registerTask('task-retry-throws', 'secret');
    forwarder.appendChunk('task-retry-throws', 'line\n');

    const flushing = forwarder.flush('task-retry-throws');
    await Promise.resolve();
    expect(forwarder.getDrainSnapshot()).toMatchObject({
      inFlightBatches: 1,
      inFlightChunks: 1,
      activeFlushOperations: 1,
    });

    await vi.advanceTimersByTimeAsync(3_001);
    await flushing;
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(forwarder.getDrainSnapshot()).toMatchObject({
      inFlightBatches: 0,
      inFlightChunks: 0,
      activeFlushOperations: 0,
      droppedChunksTotal: 1,
    });
  });

  it('retains process-lifetime dropped and activity counters after close', async () => {
    vi.useRealTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 400 }));
    forwarder.registerTask('task-failed', 'secret');
    forwarder.appendChunk('task-failed', 'line\n');
    await forwarder.flush('task-failed');
    const beforeClose = forwarder.getDrainSnapshot();

    forwarder.close('task-failed');
    const afterClose = forwarder.getDrainSnapshot();
    expect(afterClose.activeForwarders).toBe(0);
    expect(afterClose.droppedChunksTotal).toBe(1);
    expect(afterClose.droppedChunksTotal).toBe(beforeClose.droppedChunksTotal);
    expect(afterClose.forwarderActivityTotal).toBeGreaterThan(beforeClose.forwarderActivityTotal);
  });
});

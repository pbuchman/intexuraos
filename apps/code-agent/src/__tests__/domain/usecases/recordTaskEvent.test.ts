/**
 * Unit tests for recordTaskEvent use cases — storeLogChunks + recordTurnMetrics,
 * previously inline in `POST /internal/logs` and `POST /internal/turn-metrics`.
 *
 * These tests exercise the use cases directly; HTTP-level regression is still
 * covered by __tests__/routes/webhooks.test.ts and the other webhook route
 * test suites.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';

import {
  recordTurnMetrics,
  storeLogChunks,
} from '../../../domain/usecases/recordTaskEvent.js';
import { resetServices, setServices, type ServiceContainer } from '../../../services.js';
import { createTaskFormatterEntry, type TaskFormatterEntry } from '../../../domain/services/webhookHelpers.js';
import { err, ok } from '@intexuraos/common-core';
import { createMockLogger } from '../../helpers/mockLogger.js';
import type { TurnMetrics } from '../../../domain/models/turnMetrics.js';

describe('storeLogChunks', () => {
  afterEach(() => {
    resetServices();
    vi.clearAllMocks();
  });

  it('stores chunks, forwards log lines, and returns acknowledgedSequences', async () => {
    const storeBatchChunks = vi.fn().mockResolvedValue(ok(undefined));
    const storeBatchLines = vi.fn().mockResolvedValue(ok(undefined));
    const findById = vi.fn().mockResolvedValue(ok({
      workerType: 'claude-opus',
      status: 'running',
      actionId: 'act-1',
    }));

    setServices({
      logChunkRepo: { storeBatch: storeBatchChunks } as never,
      logLineRepo: { storeBatch: storeBatchLines } as never,
      codeTaskRepo: { findById, update: vi.fn().mockResolvedValue(ok(undefined)) } as never,
      statusMirrorService: { mirrorStatus: vi.fn().mockResolvedValue(undefined) } as never,
    } as unknown as ServiceContainer);

    const states = new Map<string, TaskFormatterEntry>();
    const result = await storeLogChunks(createMockLogger(), {
      body: {
        taskId: 't1',
        chunks: [
          { sequence: 1, content: '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}\n', timestamp: new Date().toISOString() },
        ],
      },
      requestLog: createMockLogger(),
      traceId: 'trace-a',
      taskFormatterStates: states,
    });

    expect(result.kind).toBe('received');
    if (result.kind === 'received') {
      expect(result.acknowledgedSequences).toEqual([1]);
      expect(result.count).toBe(1);
    }
    expect(storeBatchChunks).toHaveBeenCalledTimes(1);
  });

  it('transitions dispatched tasks to running on first log delivery', async () => {
    const update = vi.fn().mockResolvedValue(ok(undefined));
    const mirrorStatus = vi.fn().mockResolvedValue(undefined);

    setServices({
      logChunkRepo: { storeBatch: vi.fn().mockResolvedValue(ok(undefined)) } as never,
      logLineRepo: { storeBatch: vi.fn().mockResolvedValue(ok(undefined)) } as never,
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(ok({
          workerType: 'claude-opus',
          status: 'dispatched',
          actionId: 'act-X',
        })),
        update,
      } as never,
      statusMirrorService: { mirrorStatus } as never,
    } as unknown as ServiceContainer);

    await storeLogChunks(createMockLogger(), {
      body: {
        taskId: 't-disp',
        chunks: [
          { sequence: 1, content: 'plain', timestamp: new Date().toISOString() },
        ],
      },
      requestLog: createMockLogger(),
      traceId: 'trace-b',
      taskFormatterStates: new Map(),
    });

    expect(update).toHaveBeenCalledWith('t-disp', { status: 'running' });
    expect(mirrorStatus).toHaveBeenCalledWith(expect.objectContaining({
      actionId: 'act-X',
      taskStatus: 'running',
      traceId: 'trace-b',
    }));
  });

  it('warns and falls back to default formatter when task lookup fails on first delivery', async () => {
    const storeBatchChunks = vi.fn().mockResolvedValue(ok(undefined));
    const storeBatchLines = vi.fn().mockResolvedValue(ok(undefined));
    const update = vi.fn();
    const mirrorStatus = vi.fn();
    const warn = vi.fn();

    setServices({
      logChunkRepo: { storeBatch: storeBatchChunks } as never,
      logLineRepo: { storeBatch: storeBatchLines } as never,
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(err({ code: 'NOT_FOUND', message: 'missing' })),
        update,
      } as never,
      statusMirrorService: { mirrorStatus } as never,
    } as unknown as ServiceContainer);

    const requestLog = { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() } as never;
    const result = await storeLogChunks(createMockLogger(), {
      body: {
        taskId: 't-missing',
        chunks: [{ sequence: 1, content: 'plain', timestamp: new Date().toISOString() }],
      },
      requestLog,
      traceId: 'trace-missing',
      taskFormatterStates: new Map(),
    });

    expect(result.kind).toBe('received');
    // No transition kicked off because the task could not be resolved
    expect(update).not.toHaveBeenCalled();
    expect(mirrorStatus).not.toHaveBeenCalled();
    // Warning is logged so the issue is observable in production logs
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't-missing' }),
      'Could not resolve task for log-chunk delivery; proceeding with default formatter',
    );
  });

  it('returns fail with INTERNAL_ERROR when chunk storage fails', async () => {
    setServices({
      logChunkRepo: {
        storeBatch: vi.fn().mockResolvedValue(err({ code: 'FS_ERROR', message: 'disk full' })),
      } as never,
      logLineRepo: { storeBatch: vi.fn() } as never,
      codeTaskRepo: { findById: vi.fn().mockResolvedValue(ok({ workerType: 'claude-opus', status: 'running' })) } as never,
      statusMirrorService: { mirrorStatus: vi.fn() } as never,
    } as unknown as ServiceContainer);

    const states = new Map<string, TaskFormatterEntry>();
    states.set('t1', createTaskFormatterEntry('claude-opus'));

    const result = await storeLogChunks(createMockLogger(), {
      body: { taskId: 't1', chunks: [{ sequence: 1, content: 'x', timestamp: new Date().toISOString() }] },
      requestLog: createMockLogger(),
      traceId: 't',
      taskFormatterStates: states,
    });

    expect(result).toEqual({ kind: 'fail', code: 'INTERNAL_ERROR', message: 'disk full' });
  });
});

describe('recordTurnMetrics', () => {
  afterEach(() => {
    resetServices();
    vi.clearAllMocks();
  });

  const baseMetrics: TurnMetrics = {
    taskId: 't-m',
    attempt: 1,
    timestamp: new Date().toISOString(),
    cpuTimeSeconds: 1,
    cpuCores: 1,
    peakMemoryMB: 10,
    wallTimeSeconds: 2,
    apiWaitSeconds: 0.5,
    toolExecSeconds: 0.5,
    backgroundWaitSeconds: 0,
    overheadSeconds: 0,
    totalInputTokens: 100,
    totalOutputTokens: 50,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    apiCallCount: 1,
    cpuUtilizationPercent: 50,
    idlePercent: 50,
  };

  it('stores metrics and appends formatted log lines on success', async () => {
    const storeMetrics = vi.fn().mockResolvedValue(ok(undefined));
    const storeLines = vi.fn().mockResolvedValue(ok(undefined));

    setServices({
      turnMetricsRepo: { store: storeMetrics } as never,
      logLineRepo: { storeBatch: storeLines } as never,
    } as unknown as ServiceContainer);

    const result = await recordTurnMetrics(createMockLogger(), {
      body: baseMetrics,
      requestLog: createMockLogger(),
    });

    expect(result).toEqual({ kind: 'received' });
    expect(storeMetrics).toHaveBeenCalledWith('t-m', 1, baseMetrics);
    expect(storeLines).toHaveBeenCalledTimes(1);
  });

  it('returns fail when metrics storage fails', async () => {
    setServices({
      turnMetricsRepo: {
        store: vi.fn().mockResolvedValue(err({ code: 'FS', message: 'cannot write' })),
      } as never,
      logLineRepo: { storeBatch: vi.fn() } as never,
    } as unknown as ServiceContainer);

    const result = await recordTurnMetrics(createMockLogger(), {
      body: baseMetrics,
      requestLog: createMockLogger(),
    });

    expect(result).toEqual({ kind: 'fail', code: 'INTERNAL_ERROR', message: 'cannot write' });
  });

  it('does not fail when log line storage fails (non-fatal)', async () => {
    setServices({
      turnMetricsRepo: { store: vi.fn().mockResolvedValue(ok(undefined)) } as never,
      logLineRepo: { storeBatch: vi.fn().mockResolvedValue(err({ code: 'LL', message: 'slow' })) } as never,
    } as unknown as ServiceContainer);

    const result = await recordTurnMetrics(createMockLogger(), {
      body: baseMetrics,
      requestLog: createMockLogger(),
    });

    expect(result).toEqual({ kind: 'received' });
  });

  it('uses the metrics.timestamp when creating log line timestamps', async () => {
    const storeBatch = vi.fn().mockResolvedValue(ok(undefined));
    setServices({
      turnMetricsRepo: { store: vi.fn().mockResolvedValue(ok(undefined)) } as never,
      logLineRepo: { storeBatch } as never,
    } as unknown as ServiceContainer);

    const specificTs = '2025-01-02T03:04:05Z';
    await recordTurnMetrics(createMockLogger(), {
      body: { ...baseMetrics, timestamp: specificTs },
      requestLog: createMockLogger(),
    });

    const [, lines] = storeBatch.mock.calls[0] as [string, { timestamp: Timestamp }[]];
    expect(lines[0]?.timestamp.toDate().toISOString()).toBe('2025-01-02T03:04:05.000Z');
  });
});

/**
 * Tests for `metrics.ts` — the orchestrator's local shim for
 * `@intexuraos/common-metrics` (until S8 lands).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CODE_TASK_METRICS,
  createMetricsClient,
  mapTerminalStatusToMetricStatus,
  noopMetricsClient,
} from '../metrics.js';

interface FakeLogger {
  info: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function makeLogger(): FakeLogger {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('CODE_TASK_METRICS registry', () => {
  it('declares stable metric names matching the parent plan §7', () => {
    expect(CODE_TASK_METRICS.COMPLETED.name).toBe('code_tasks_completed');
    expect(CODE_TASK_METRICS.FAILED.name).toBe('code_tasks_failed');
    expect(CODE_TASK_METRICS.DURATION.name).toBe('code_tasks_duration');
  });

  it('uses counter type for COMPLETED and FAILED, distribution for DURATION', () => {
    expect(CODE_TASK_METRICS.COMPLETED.type).toBe('counter');
    expect(CODE_TASK_METRICS.FAILED.type).toBe('counter');
    expect(CODE_TASK_METRICS.DURATION.type).toBe('distribution');
  });

  it('uses 1 unit for counters and ms for the duration distribution', () => {
    expect(CODE_TASK_METRICS.COMPLETED.unit).toBe('1');
    expect(CODE_TASK_METRICS.FAILED.unit).toBe('1');
    expect(CODE_TASK_METRICS.DURATION.unit).toBe('ms');
  });
});

describe('mapTerminalStatusToMetricStatus', () => {
  it('returns "success" only for "completed"', () => {
    expect(mapTerminalStatusToMetricStatus('completed')).toBe('success');
  });

  it('returns "failed" for non-success terminal statuses', () => {
    expect(mapTerminalStatusToMetricStatus('failed')).toBe('failed');
    expect(mapTerminalStatusToMetricStatus('interrupted')).toBe('failed');
    expect(mapTerminalStatusToMetricStatus('cancelled')).toBe('failed');
  });
});

describe('createMetricsClient', () => {
  it('emits a structured info line on increment with default by=1', () => {
    const logger = makeLogger();
    const client = createMetricsClient({
      projectId: 'proj-1',
      serviceName: 'orchestrator',
      logger: logger as unknown as Parameters<typeof createMetricsClient>[0]['logger'],
    });

    client.increment(CODE_TASK_METRICS.COMPLETED, { status: 'success' });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [payload, msg] = logger.info.mock.calls[0] as [Record<string, unknown>, string];
    expect(payload).toMatchObject({
      metric: 'code_tasks_completed',
      metricType: 'counter',
      metricUnit: '1',
      op: 'increment',
      value: 1,
      labels: { status: 'success' },
      projectId: 'proj-1',
      service: 'orchestrator',
    });
    expect(msg).toBe('metric code_tasks_completed increment=1');
  });

  it('honors the explicit `by` argument on increment', () => {
    const logger = makeLogger();
    const client = createMetricsClient({
      projectId: 'proj-1',
      serviceName: 'orchestrator',
      logger: logger as unknown as Parameters<typeof createMetricsClient>[0]['logger'],
    });

    client.increment(CODE_TASK_METRICS.FAILED, { reason: 'timeout' }, 3);

    const [payload] = logger.info.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({ op: 'increment', value: 3, labels: { reason: 'timeout' } });
  });

  it('emits a record call as op=record with the provided value', () => {
    const logger = makeLogger();
    const client = createMetricsClient({
      projectId: 'proj-1',
      serviceName: 'orchestrator',
      logger: logger as unknown as Parameters<typeof createMetricsClient>[0]['logger'],
    });

    client.record(CODE_TASK_METRICS.DURATION, { status: 'success' }, 1234);

    const [payload, msg] = logger.info.mock.calls[0] as [Record<string, unknown>, string];
    expect(payload).toMatchObject({ op: 'record', value: 1234, labels: { status: 'success' } });
    expect(msg).toBe('metric code_tasks_duration record=1234');
  });

  it('flush() resolves to undefined for the log-based shim', async () => {
    const logger = makeLogger();
    const client = createMetricsClient({
      projectId: 'proj-1',
      serviceName: 'orchestrator',
      logger: logger as unknown as Parameters<typeof createMetricsClient>[0]['logger'],
    });

    await expect(client.flush()).resolves.toBeUndefined();
  });

  it('swallows errors thrown by the underlying logger.info and logs at debug', () => {
    const logger = makeLogger();
    logger.info.mockImplementationOnce(() => {
      throw new Error('logger boom');
    });

    const client = createMetricsClient({
      projectId: 'proj-1',
      serviceName: 'orchestrator',
      logger: logger as unknown as Parameters<typeof createMetricsClient>[0]['logger'],
    });

    expect(() =>
      client.increment(CODE_TASK_METRICS.COMPLETED, { status: 'success' })
    ).not.toThrow();
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it('survives even when both info and debug throw', () => {
    const logger = makeLogger();
    logger.info.mockImplementation(() => {
      throw new Error('info boom');
    });
    logger.debug.mockImplementation(() => {
      throw new Error('debug boom');
    });

    const client = createMetricsClient({
      projectId: 'proj-1',
      serviceName: 'orchestrator',
      logger: logger as unknown as Parameters<typeof createMetricsClient>[0]['logger'],
    });

    expect(() => client.increment(CODE_TASK_METRICS.COMPLETED, { status: 'failed' })).not.toThrow();
  });
});

describe('noopMetricsClient', () => {
  it('exposes the MetricsClient surface and never throws', async () => {
    const client = noopMetricsClient();
    expect(() =>
      client.increment(CODE_TASK_METRICS.COMPLETED, { status: 'success' })
    ).not.toThrow();
    expect(() => client.record(CODE_TASK_METRICS.DURATION, { status: 'failed' }, 42)).not.toThrow();
    await expect(client.flush()).resolves.toBeUndefined();
  });
});

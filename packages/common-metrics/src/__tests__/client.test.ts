/**
 * Unit tests for `createMetricsClient`.
 *
 * Uses a fake `MetricServiceClientLike` to drive 100% branch coverage
 * without contacting Cloud Monitoring.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { createMetricsClient, defaultMetricServiceClientFactory } from '../client.js';
import { CODE_TASK_METRICS } from '../types.js';
import type { CustomMetric, MetricServiceClientLike } from '../types.js';

interface CapturedRequest {
  name: string;
  timeSeries: unknown[];
}

class FakeMetricServiceClient implements MetricServiceClientLike {
  public calls: CapturedRequest[] = [];
  public failNext = false;
  public failError: Error | null = null;

  async createTimeSeries(request: { name: string; timeSeries: unknown[] }): Promise<unknown> {
    if (this.failNext) {
      this.failNext = false;
      throw this.failError ?? new Error('fake failure');
    }
    this.calls.push({ name: request.name, timeSeries: request.timeSeries });
    return { ok: true };
  }
}

function makeLogger(): Logger {
  const fn = vi.fn();
  // Minimal Logger surface used by the client implementation.
  return {
    error: fn,
    info: fn,
    warn: fn,
    debug: fn,
    trace: fn,
    fatal: fn,
  } as unknown as Logger;
}

const mockedTimeSeriesCalls: { name: string; timeSeries: unknown[] }[] = [];

vi.mock('@google-cloud/monitoring', () => {
  class MetricServiceClient {
    public marker = 'fake-from-mock';
    async createTimeSeries(req: { name: string; timeSeries: unknown[] }): Promise<unknown> {
      mockedTimeSeriesCalls.push({ name: req.name, timeSeries: req.timeSeries });
      return { ok: true };
    }
  }
  return { MetricServiceClient };
});

describe('createMetricsClient', () => {
  let fakeClient: FakeMetricServiceClient;
  let logger: Logger;

  beforeEach(() => {
    fakeClient = new FakeMetricServiceClient();
    logger = makeLogger();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flush is a no-op when buffer is empty', async () => {
    const metrics = createMetricsClient({
      projectId: 'p1',
      serviceName: 'svc',
      logger,
      metricServiceClient: fakeClient,
    });

    await metrics.flush();

    expect(fakeClient.calls).toHaveLength(0);
  });

  it('increment writes a CUMULATIVE counter time series with INT64 value', async () => {
    const metrics = createMetricsClient({
      projectId: 'p1',
      serviceName: 'svc',
      logger,
      metricServiceClient: fakeClient,
    });

    metrics.increment(CODE_TASK_METRICS.COMPLETED, { worker_type: 'cloud_run' });
    metrics.increment(CODE_TASK_METRICS.FAILED, { worker_type: 'home_dev' }, 3);

    await metrics.flush();

    expect(fakeClient.calls).toHaveLength(1);
    const call = fakeClient.calls[0];
    if (call === undefined) {
      throw new Error('expected one createTimeSeries call');
    }
    expect(call.name).toBe('projects/p1');
    expect(call.timeSeries).toHaveLength(2);

    const ts0 = call.timeSeries[0] as Record<string, unknown>;
    expect(ts0['metric']).toMatchObject({
      type: 'custom.googleapis.com/intexuraos/code_tasks_completed',
      labels: { worker_type: 'cloud_run', service_name: 'svc' },
    });
    expect(ts0['resource']).toEqual({
      type: 'global',
      labels: { project_id: 'p1' },
    });
    expect(ts0['metricKind']).toBe('CUMULATIVE');
    const points0 = ts0['points'] as Record<string, unknown>[];
    const point0 = points0[0];
    if (point0 === undefined) {
      throw new Error('expected point');
    }
    const interval0 = point0['interval'] as Record<string, unknown>;
    expect(interval0['startTime']).toEqual({ seconds: Math.floor(Date.now() / 1000) });
    expect(interval0['endTime']).toEqual({ seconds: Math.floor(Date.now() / 1000) });
    expect(point0['value']).toEqual({ int64Value: 1 });

    const ts1 = call.timeSeries[1] as Record<string, unknown>;
    const points1 = ts1['points'] as Record<string, unknown>[];
    const p1 = points1[0];
    if (p1 === undefined) {
      throw new Error('expected point');
    }
    expect(p1['value']).toEqual({ int64Value: 3 });
  });

  it('record on a distribution metric writes a GAUGE-shaped point with DOUBLE value', async () => {
    const metrics = createMetricsClient({
      projectId: 'p1',
      serviceName: 'svc',
      logger,
      metricServiceClient: fakeClient,
    });

    metrics.record(CODE_TASK_METRICS.DURATION, { worker_type: 'cloud_run' }, 1234.5);

    await metrics.flush();

    const call = fakeClient.calls[0];
    if (call === undefined) {
      throw new Error('expected one createTimeSeries call');
    }
    const ts0 = call.timeSeries[0] as Record<string, unknown>;
    expect(ts0['metricKind']).toBe('GAUGE');
    const points0 = ts0['points'] as Record<string, unknown>[];
    const point0 = points0[0];
    if (point0 === undefined) {
      throw new Error('expected point');
    }
    const interval0 = point0['interval'] as Record<string, unknown>;
    expect(interval0).not.toHaveProperty('startTime');
    expect(interval0['endTime']).toEqual({ seconds: Math.floor(Date.now() / 1000) });
    expect(point0['value']).toEqual({ doubleValue: 1234.5 });
  });

  it('record on a gauge metric writes a GAUGE point with INT64 value', async () => {
    const ACTIVE: CustomMetric<{ region: string }> = {
      name: 'active_workers',
      type: 'gauge',
      unit: '1',
      description: 'Active workers',
    };
    const metrics = createMetricsClient({
      projectId: 'p1',
      serviceName: 'svc',
      logger,
      metricServiceClient: fakeClient,
    });

    metrics.record(ACTIVE, { region: 'eu' }, 42);

    await metrics.flush();

    const call = fakeClient.calls[0];
    if (call === undefined) {
      throw new Error('expected one createTimeSeries call');
    }
    const ts0 = call.timeSeries[0] as Record<string, unknown>;
    expect(ts0['metricKind']).toBe('GAUGE');
    const points0 = ts0['points'] as Record<string, unknown>[];
    const point0 = points0[0];
    if (point0 === undefined) {
      throw new Error('expected point');
    }
    expect(point0['value']).toEqual({ int64Value: 42 });
  });

  it('supports multiple labels on a single metric', async () => {
    const metrics = createMetricsClient({
      projectId: 'p1',
      serviceName: 'svc',
      logger,
      metricServiceClient: fakeClient,
    });

    metrics.increment(CODE_TASK_METRICS.COMPLETED, {
      worker_type: 'cloud_run',
      status: 'ok',
      tenant: 't-7',
    });

    await metrics.flush();

    const call = fakeClient.calls[0];
    if (call === undefined) {
      throw new Error('expected one createTimeSeries call');
    }
    const ts0 = call.timeSeries[0] as Record<string, unknown>;
    expect(ts0['metric']).toMatchObject({
      labels: {
        worker_type: 'cloud_run',
        status: 'ok',
        tenant: 't-7',
        service_name: 'svc',
      },
    });
  });

  it('attaches service_name label on every emitted time series', async () => {
    const metrics = createMetricsClient({
      projectId: 'p1',
      serviceName: 'orchestrator',
      logger,
      metricServiceClient: fakeClient,
    });

    metrics.increment(CODE_TASK_METRICS.COMPLETED, { worker_type: 'cloud_run' });
    metrics.record(CODE_TASK_METRICS.DURATION, { worker_type: 'cloud_run' }, 100);

    await metrics.flush();

    const call = fakeClient.calls[0];
    if (call === undefined) {
      throw new Error('expected one createTimeSeries call');
    }
    for (const ts of call.timeSeries) {
      const m = (ts as Record<string, unknown>)['metric'] as Record<string, unknown>;
      const lbls = m['labels'] as Record<string, string>;
      expect(lbls['service_name']).toBe('orchestrator');
    }
  });

  it('counter increments accumulate into a single cumulative point per (metric,labels) tuple', async () => {
    const metrics = createMetricsClient({
      projectId: 'p1',
      serviceName: 'svc',
      logger,
      metricServiceClient: fakeClient,
    });

    metrics.increment(CODE_TASK_METRICS.COMPLETED, { worker_type: 'cloud_run' });
    metrics.increment(CODE_TASK_METRICS.COMPLETED, { worker_type: 'cloud_run' });

    await metrics.flush();

    const call = fakeClient.calls[0];
    if (call === undefined) {
      throw new Error('expected one createTimeSeries call');
    }
    // Two increment() calls on the same (metric,labels) tuple → one point
    // carrying the running total (2), not the delta (1).
    expect(call.timeSeries).toHaveLength(1);
    const ts0 = call.timeSeries[0] as Record<string, unknown>;
    const points0 = ts0['points'] as Record<string, unknown>[];
    const point0 = points0[0];
    if (point0 === undefined) {
      throw new Error('expected point');
    }
    expect(point0['value']).toEqual({ int64Value: 2 });
  });

  it('counter running total survives flush success and the next flush emits the cumulative sum', async () => {
    const metrics = createMetricsClient({
      projectId: 'p1',
      serviceName: 'svc',
      logger,
      metricServiceClient: fakeClient,
    });

    metrics.increment(CODE_TASK_METRICS.COMPLETED, { worker_type: 'cloud_run' }, 2);
    await metrics.flush();
    metrics.increment(CODE_TASK_METRICS.COMPLETED, { worker_type: 'cloud_run' }, 3);
    await metrics.flush();

    expect(fakeClient.calls).toHaveLength(2);
    const c0 = fakeClient.calls[0];
    const c1 = fakeClient.calls[1];
    if (c0 === undefined || c1 === undefined) {
      throw new Error('expected two flushes');
    }
    const v0 = (
      ((c0.timeSeries[0] as Record<string, unknown>)['points'] as Record<string, unknown>[])[0] as
        | Record<string, unknown>
        | undefined
    )?.['value'];
    const v1 = (
      ((c1.timeSeries[0] as Record<string, unknown>)['points'] as Record<string, unknown>[])[0] as
        | Record<string, unknown>
        | undefined
    )?.['value'];
    expect(v0).toEqual({ int64Value: 2 });
    // 2 + 3 = 5 (cumulative sum, not the delta).
    expect(v1).toEqual({ int64Value: 5 });
  });

  it('counter running total survives flush failure (does NOT roll back)', async () => {
    fakeClient.failNext = true;
    fakeClient.failError = new Error('boom-counter');

    const metrics = createMetricsClient({
      projectId: 'p1',
      serviceName: 'svc',
      logger,
      metricServiceClient: fakeClient,
    });

    metrics.increment(CODE_TASK_METRICS.COMPLETED, { worker_type: 'cloud_run' }, 4);
    await expect(metrics.flush()).rejects.toThrow(/boom-counter/);

    // Next flush succeeds; cumulative total is still 4 (not rolled back).
    await metrics.flush();
    expect(fakeClient.calls).toHaveLength(1);
    const c = fakeClient.calls[0];
    if (c === undefined) {
      throw new Error('expected call');
    }
    const ts0 = c.timeSeries[0] as Record<string, unknown>;
    const points0 = ts0['points'] as Record<string, unknown>[];
    const point0 = points0[0];
    if (point0 === undefined) {
      throw new Error('expected point');
    }
    expect(point0['value']).toEqual({ int64Value: 4 });
  });

  it('increment on a non-counter metric buffers an independent point per call', async () => {
    const ACTIVE: CustomMetric<{ region: string }> = {
      name: 'active_workers',
      type: 'gauge',
      unit: '1',
      description: 'Active workers',
    };
    const metrics = createMetricsClient({
      projectId: 'p1',
      serviceName: 'svc',
      logger,
      metricServiceClient: fakeClient,
    });

    metrics.increment(ACTIVE, { region: 'eu' });
    metrics.increment(ACTIVE, { region: 'eu' }, 5);

    await metrics.flush();

    const call = fakeClient.calls[0];
    if (call === undefined) {
      throw new Error('expected one createTimeSeries call');
    }
    // Non-counter: each call buffers its own point (no accumulation).
    expect(call.timeSeries).toHaveLength(2);
  });

  it('flush clears non-counter buffer on success', async () => {
    const metrics = createMetricsClient({
      projectId: 'p1',
      serviceName: 'svc',
      logger,
      metricServiceClient: fakeClient,
    });

    metrics.record(CODE_TASK_METRICS.DURATION, { worker_type: 'cloud_run' }, 100);
    await metrics.flush();
    await metrics.flush();

    // Distribution buffer cleared after first flush; second flush is a no-op.
    expect(fakeClient.calls).toHaveLength(1);
  });

  it('flush rejects and preserves buffer on createTimeSeries failure', async () => {
    fakeClient.failNext = true;
    fakeClient.failError = new Error('boom');

    const metrics = createMetricsClient({
      projectId: 'p1',
      serviceName: 'svc',
      logger,
      metricServiceClient: fakeClient,
    });

    metrics.increment(CODE_TASK_METRICS.COMPLETED, { worker_type: 'cloud_run' });

    await expect(metrics.flush()).rejects.toThrow(/boom/);
    expect(logger.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'metrics flush failed');

    // Buffer is preserved → next flush sends the same entry.
    await metrics.flush();
    expect(fakeClient.calls).toHaveLength(1);
  });

  it('lazily constructs the default MetricServiceClient on first flush when no override is provided', async () => {
    mockedTimeSeriesCalls.length = 0;
    const metrics = createMetricsClient({
      projectId: 'p2',
      serviceName: 'svc',
      logger,
    });

    metrics.increment(CODE_TASK_METRICS.COMPLETED, { worker_type: 'cloud_run' });
    await metrics.flush();

    expect(mockedTimeSeriesCalls).toHaveLength(1);
    const call = mockedTimeSeriesCalls[0];
    if (call === undefined) {
      throw new Error('expected mocked call');
    }
    expect(call.name).toBe('projects/p2');
  });

  it('defaultMetricServiceClientFactory returns a MetricServiceClient instance', () => {
    const inst = defaultMetricServiceClientFactory();
    expect(inst).toBeDefined();
    expect((inst as unknown as { marker: string }).marker).toBe('fake-from-mock');
  });
});

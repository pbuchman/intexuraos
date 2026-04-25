/**
 * Buffered Cloud Monitoring metrics client.
 *
 * Buffers metric samples in memory and flushes them in a single
 * `createTimeSeries` request to Google Cloud Monitoring.
 *
 * The underlying `MetricServiceClient` is injectable so tests can
 * substitute a fake without contacting the network.
 *
 * Counter semantics: Cloud Monitoring CUMULATIVE counters require
 * monotonically-increasing values at a fixed `startTime`. We therefore
 * maintain a running total per `(metric.name, labelsKey)` tuple inside
 * the client and emit the CURRENT cumulative value (not the delta) on
 * flush. The running total is updated synchronously in `increment()` and
 * survives flush failures: the next flush re-emits the same or higher
 * cumulative value, which is what Cloud Monitoring expects.
 */

import { MetricServiceClient } from '@google-cloud/monitoring';
import type {
  CustomMetric,
  MetricLabel,
  MetricServiceClientLike,
  MetricsClient,
  MetricsClientConfig,
} from './types.js';

interface BufferedEntry {
  metric: CustomMetric;
  labels: MetricLabel;
  value: number;
  timestamp: number;
}

interface CounterState {
  metric: CustomMetric;
  labels: MetricLabel;
  total: number;
  timestamp: number;
}

const METRIC_KIND_MAP = {
  counter: 'CUMULATIVE',
  gauge: 'GAUGE',
  distribution: 'GAUGE',
} as const;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function labelsKey(labels: MetricLabel): string {
  const sortedEntries = Object.keys(labels)
    .sort()
    .map((k) => [k, labels[k]] as const);
  return JSON.stringify(sortedEntries);
}

/**
 * Default factory used when the caller does not inject a fake.
 *
 * Exported so tests can spy on / override the construction path without
 * touching the GCP SDK. The function is invoked lazily on first flush.
 */
export function defaultMetricServiceClientFactory(): MetricServiceClientLike {
  return new MetricServiceClient() as unknown as MetricServiceClientLike;
}

/**
 * Construct a buffered MetricsClient bound to the given GCP project.
 *
 * The real `MetricServiceClient` is only instantiated lazily on first
 * `flush()` when no override is supplied, so importing this module never
 * triggers any GCP SDK side effects.
 */
export function createMetricsClient(config: MetricsClientConfig): MetricsClient {
  const { projectId, serviceName, logger } = config;
  // Buffer of NON-counter entries (gauge, distribution). Each `record()`
  // call buffers an independent point.
  const buffer: BufferedEntry[] = [];
  // Running cumulative totals for counter metrics, keyed by
  // `${metric.name}::${labelsKey(labels)}`.
  const counterTotals = new Map<string, CounterState>();
  const startTimeSeconds = nowSeconds();

  let resolvedClient: MetricServiceClientLike | undefined = config.metricServiceClient;

  function getClient(): MetricServiceClientLike {
    if (resolvedClient !== undefined) {
      return resolvedClient;
    }
    resolvedClient = defaultMetricServiceClientFactory();
    return resolvedClient;
  }

  function buildTimeSeries(entry: BufferedEntry): unknown {
    const valueType = entry.metric.type === 'distribution' ? 'DOUBLE' : 'INT64';
    const endTimeSeconds = Math.floor(entry.timestamp / 1000);
    const interval =
      entry.metric.type === 'counter'
        ? {
            startTime: { seconds: startTimeSeconds },
            endTime: { seconds: endTimeSeconds },
          }
        : {
            endTime: { seconds: endTimeSeconds },
          };

    const point = {
      interval,
      value: valueType === 'INT64' ? { int64Value: entry.value } : { doubleValue: entry.value },
    };

    return {
      metric: {
        type: `custom.googleapis.com/intexuraos/${entry.metric.name}`,
        labels: { ...entry.labels, service_name: serviceName },
      },
      resource: {
        type: 'global',
        labels: { project_id: projectId },
      },
      metricKind: METRIC_KIND_MAP[entry.metric.type],
      points: [point],
    };
  }

  return {
    increment<L extends MetricLabel>(metric: CustomMetric<L>, labels: L, by = 1): void {
      if (metric.type === 'counter') {
        const key = `${metric.name}::${labelsKey(labels)}`;
        const existing = counterTotals.get(key);
        const total = (existing?.total ?? 0) + by;
        counterTotals.set(key, {
          metric: metric as CustomMetric,
          labels: { ...labels },
          total,
          timestamp: Date.now(),
        });
        return;
      }
      // Non-counter: each call is an independent buffered point.
      buffer.push({
        metric: metric as CustomMetric,
        labels: { ...labels },
        value: by,
        timestamp: Date.now(),
      });
    },

    record<L extends MetricLabel>(metric: CustomMetric<L>, labels: L, value: number): void {
      buffer.push({
        metric: metric as CustomMetric,
        labels: { ...labels },
        value,
        timestamp: Date.now(),
      });
    },

    async flush(): Promise<void> {
      const counterEntries: BufferedEntry[] = [];
      for (const state of counterTotals.values()) {
        counterEntries.push({
          metric: state.metric,
          labels: state.labels,
          value: state.total,
          timestamp: state.timestamp,
        });
      }

      if (buffer.length === 0 && counterEntries.length === 0) {
        return;
      }

      const client = getClient();
      const timeSeries = [...buffer, ...counterEntries].map(buildTimeSeries);
      const request = {
        name: `projects/${projectId}`,
        timeSeries,
      };

      try {
        await client.createTimeSeries(request);
        // Counter totals are NOT cleared — they are running totals and the
        // next flush will re-emit at the same or higher cumulative value.
        // Non-counter buffer is cleared on success.
        buffer.length = 0;
      } catch (err) {
        logger.error({ err }, 'metrics flush failed');
        // Preserve non-counter buffered entries (do not clear) so the next
        // flush retries them. Counter totals are likewise preserved (they
        // are running totals and never rolled back).
        throw err;
      }
    },
  };
}

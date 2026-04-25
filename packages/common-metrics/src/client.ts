/**
 * Buffered Cloud Monitoring metrics client.
 *
 * Buffers metric samples in memory and flushes them in a single
 * `createTimeSeries` request to Google Cloud Monitoring.
 *
 * The underlying `MetricServiceClient` is injectable so tests can
 * substitute a fake without contacting the network.
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

const METRIC_KIND_MAP = {
  counter: 'CUMULATIVE',
  gauge: 'GAUGE',
  distribution: 'GAUGE',
} as const;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
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
  const { projectId, logger } = config;
  const buffer: BufferedEntry[] = [];
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
        labels: entry.labels,
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
      if (buffer.length === 0) {
        return;
      }

      const client = getClient();
      const timeSeries = buffer.map(buildTimeSeries);
      const request = {
        name: `projects/${projectId}`,
        timeSeries,
      };

      try {
        await client.createTimeSeries(request);
        buffer.length = 0;
      } catch (err) {
        logger.error({ err }, 'metrics flush failed');
        throw err;
      }
    },
  };
}

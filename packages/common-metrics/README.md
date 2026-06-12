# @intexuraos/common-metrics

Buffered Cloud Monitoring custom-metrics client for IntexuraOS services.

Wraps `@google-cloud/monitoring`'s `MetricServiceClient` with a small, typed surface (`increment`, `record`, `flush`) and handles the cumulative-counter bookkeeping that Cloud Monitoring requires (fixed `startTime`, monotonically-increasing values, label-keyed running totals).

## Exports

- `createMetricsClient(config)` — factory returning a `MetricsClient` bound to a GCP project + service name.
- `MetricsClient` — client surface (`increment`, `record`, `flush`).
- `MetricsClientConfig` — `{ projectId, serviceName, logger, metricServiceClient? }`. Inject `metricServiceClient` in tests.
- `CustomMetric<L>` — descriptor shape `{ name, type, unit, description }` with a phantom `__labels` marker for type inference.
- `MetricKind` — `'counter' | 'gauge' | 'distribution'`.
- `MetricLabel` — `Record<string, string>`.
- `MetricServiceClientLike` — minimal structural type used for test fakes.
- `CODE_TASK_METRICS` — frozen registry of code-task descriptors (`COMPLETED`, `FAILED`, `DURATION`).

## Dependencies

- `@google-cloud/monitoring` — `MetricServiceClient` for `createTimeSeries` calls.
- `pino` — `Logger` type used by `MetricsClientConfig`.

## Usage

```ts
import { createMetricsClient, CODE_TASK_METRICS } from '@intexuraos/common-metrics';

const metrics = createMetricsClient({
  projectId: process.env['INTEXURAOS_GCP_PROJECT_ID']!,
  serviceName: 'orchestrator',
  logger,
});

metrics.increment(CODE_TASK_METRICS.COMPLETED, { status: 'success' });
metrics.record(CODE_TASK_METRICS.DURATION, { status: 'success' }, 1820);

await metrics.flush();
```

See [`docs/packages/common-metrics/README.md`](../../docs/packages/common-metrics/README.md) for the full reference (semantics, namespace, counter bookkeeping, failure isolation).

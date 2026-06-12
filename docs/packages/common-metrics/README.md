# @intexuraos/common-metrics

Buffered Cloud Monitoring custom-metrics client for IntexuraOS services. Wraps `@google-cloud/monitoring`'s `MetricServiceClient` with a small, typed surface (`increment`, `record`, `flush`) and handles the cumulative-counter bookkeeping that Cloud Monitoring requires.

**Type:** ESM
**Node:** >=22.0.0

## Why this package exists

Cloud Monitoring's `createTimeSeries` API is awkward for application code:

- `CUMULATIVE` counters require a stable `startTime` and a monotonically-increasing value at every flush — callers can't just emit deltas.
- Each metric point needs a fully-formed `metric.type` string (`custom.googleapis.com/intexuraos/...`) and a `resource` descriptor.
- Tests must not contact the network, so the underlying client has to be injectable.

This package centralises that ceremony so every IntexuraOS service that needs custom metrics gets the same buffered-flush semantics, the same `custom.googleapis.com/intexuraos/<name>` namespace, and the same `service_name` label injected on every series.

It also publishes the shared `CODE_TASK_METRICS` descriptor registry so the orchestrator and any downstream consumer agree on metric names without copying string literals.

## Dependencies

| Package                       | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `@google-cloud/monitoring`    | `MetricServiceClient` for `createTimeSeries` calls       |
| `pino`                        | `Logger` type used by `MetricsClientConfig`              |

The real `MetricServiceClient` is constructed lazily on the first `flush()` — importing this module has no GCP SDK side effects.

## Exports

- `createMetricsClient(config)` — factory returning a `MetricsClient` bound to a GCP project + service name.
- `MetricsClient` — client surface: `increment(metric, labels, by?)`, `record(metric, labels, value)`, `flush()`.
- `MetricsClientConfig` — `{ projectId, serviceName, logger, metricServiceClient? }`. Inject `metricServiceClient` in tests.
- `CustomMetric<L>` — descriptor shape: `{ name, type, unit, description, __labels? }`. The phantom `__labels` field anchors the label type so `client.increment(METRIC, labels)` type-checks the labels argument; never read at runtime.
- `MetricKind` — `'counter' | 'gauge' | 'distribution'`.
- `MetricLabel` — `Record<string, string>`.
- `MetricServiceClientLike` — minimal structural type for the GCP client (`createTimeSeries`); used for test fakes.
- `CODE_TASK_METRICS` — frozen registry of code-task descriptors:
  - `COMPLETED` — `code_tasks_completed` (counter, unit `1`)
  - `FAILED` — `code_tasks_failed` (counter, unit `1`)
  - `DURATION` — `code_task_duration` (distribution, unit `ms`)

## Semantics

### Metric namespace

Every emitted series is published under `custom.googleapis.com/intexuraos/<metric.name>` with `resource = { type: 'global', labels: { project_id } }` and a `service_name` label injected from `config.serviceName`.

### Counter bookkeeping

Cloud Monitoring `CUMULATIVE` counters require a fixed `startTime` and a monotonically-increasing value. The client therefore keeps a running total per `(metric.name, sortedLabels)` tuple in memory, updated synchronously inside `increment()`, and emits the **current cumulative value** (not the delta) on every flush. The running total is never cleared — including across flush failures — so the next flush re-emits the same or higher value, which is what Cloud Monitoring expects.

### Gauge / distribution bookkeeping

Each `record(...)` call (and each non-counter `increment(...)` call) buffers an independent point with `endTime` only. On a successful flush the non-counter buffer is cleared; on a failed flush the buffer is preserved so the next flush retries those points. Counter totals are preserved on both paths.

### Value type

`distribution` metrics are emitted as `DOUBLE`; `counter` and `gauge` are emitted as `INT64`.

### Failure isolation

`flush()` rethrows on `createTimeSeries` failure after logging `metrics flush failed` at `error` level. Buffered state survives the failure as described above. Callers are expected to call `flush()` from a non-critical path (e.g. a periodic timer or an end-of-request hook) so a metrics outage does not crash the service.

## Usage

```ts
import {
  createMetricsClient,
  CODE_TASK_METRICS,
} from '@intexuraos/common-metrics';

const metrics = createMetricsClient({
  projectId: process.env['INTEXURAOS_GCP_PROJECT_ID']!,
  serviceName: 'orchestrator',
  logger,
});

// Counter — running total maintained internally.
metrics.increment(CODE_TASK_METRICS.COMPLETED, { status: 'success' });

// Distribution — each call buffers an independent sample.
metrics.record(CODE_TASK_METRICS.DURATION, { status: 'success' }, 1820);

// Flush periodically (e.g. every 30s) or at process shutdown.
await metrics.flush();
```

For tests, inject a fake `MetricServiceClientLike` to capture `createTimeSeries` requests without contacting GCP:

```ts
const calls: unknown[] = [];
const metrics = createMetricsClient({
  projectId: 'test',
  serviceName: 'test-service',
  logger,
  metricServiceClient: {
    async createTimeSeries(req) {
      calls.push(req);
    },
  },
});
```

## Used By

- `workers/orchestrator` — emits `CODE_TASK_METRICS` on every code-task terminal transition. The orchestrator currently still ships a local log-based shim (`workers/orchestrator/src/metrics.ts`) that mirrors this package's contract; the swap to the real client is tracked in `technical-debt.md`.

## Source Files

| File                              | Purpose                                                    |
| --------------------------------- | ---------------------------------------------------------- |
| `src/index.ts`                    | Public barrel                                              |
| `src/client.ts`                   | `createMetricsClient` factory + counter bookkeeping        |
| `src/types.ts`                    | `MetricsClient`, `CustomMetric`, `CODE_TASK_METRICS`       |
| `src/__tests__/client.test.ts`    | Buffer / counter / flush behaviour tests                   |
| `src/__tests__/index.test.ts`     | Public-surface smoke test                                  |

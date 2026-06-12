# Agent Reference — @intexuraos/common-metrics

Machine-readable interface summary for autonomous agents working with this package.

## Identity

- **Package name:** `@intexuraos/common-metrics`
- **Kind:** `package` (workspace-internal, `private: true`, source-exports)
- **Module type:** ESM
- **Node:** `>=22.0.0`
- **Entry:** `./src/index.ts`
- **Workspace path:** `packages/common-metrics`
- **Long-form docs:** `docs/packages/common-metrics/README.md`

## Public Exports

| Symbol                            | Kind  | Signature / Shape                                                                                                                  |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `createMetricsClient`             | fn    | `(config: MetricsClientConfig) => MetricsClient`                                                                                   |
| `MetricsClient`                   | type  | `{ increment(m, l, by?): void; record(m, l, v): void; flush(): Promise<void> }`                                                    |
| `MetricsClientConfig`             | type  | `{ projectId: string; serviceName: string; logger: pino.Logger; metricServiceClient?: MetricServiceClientLike }`                   |
| `CustomMetric<L>`                 | type  | `{ readonly name: string; readonly type: MetricKind; readonly unit: string; readonly description: string; readonly __labels?: L }` |
| `MetricKind`                      | type  | `'counter' \                                                                                                                       | 'gauge' \ | 'distribution'` |
| `MetricLabel`                     | type  | `Record<string, string>`                                                                                                           |
| `MetricServiceClientLike`         | type  | `{ createTimeSeries(req: { name: string; timeSeries: unknown[] }): Promise<unknown> }`                                             |
| `CODE_TASK_METRICS`               | const | `{ COMPLETED, FAILED, DURATION }` — see below                                                                                      |

### `CODE_TASK_METRICS` registry

| Key         | `name`                  | `type`         | `unit` |
| ----------- | ----------------------- | -------------- | ------ |
| `COMPLETED` | `code_tasks_completed`  | `counter`      | `1`    |
| `FAILED`    | `code_tasks_failed`     | `counter`      | `1`    |
| `DURATION`  | `code_task_duration`    | `distribution` | `ms`   |

## Cloud Monitoring Mapping

| Source                          | Cloud Monitoring                                                          |
| ------------------------------- | ------------------------------------------------------------------------- |
| `metric.name`                   | `metric.type = custom.googleapis.com/intexuraos/<name>`                   |
| `metric.type = 'counter'`       | `metricKind = CUMULATIVE`, `valueType = INT64`                            |
| `metric.type = 'gauge'`         | `metricKind = GAUGE`, `valueType = INT64`                                 |
| `metric.type = 'distribution'`  | `metricKind = GAUGE`, `valueType = DOUBLE` (single-point, not bucketed)   |
| `serviceName` (config)          | `metric.labels.service_name`                                              |
| `projectId` (config)            | `resource.labels.project_id`, `resource.type = global`                    |
| Counter `startTime`             | `nowSeconds()` at client construction (stable for the client's lifetime)  |

## Invariants

1. **Lazy GCP construction.** `new MetricServiceClient()` is not called until the first `flush()` that has data and no injected `metricServiceClient`. Importing the module is side-effect-free.
2. **Counter monotonicity.** Per `(metric.name, sortedLabels)` the emitted value is the running total since client construction, never a delta.
3. **Buffer preservation on failure.** `flush()` rethrows on `createTimeSeries` error; non-counter buffer is NOT cleared on failure; counter totals are NEVER cleared.
4. **Labels copied, not aliased.** `increment` / `record` copy `labels` via spread before storing — caller mutations after the call do not affect emitted series.
5. **No-op when empty.** `flush()` returns immediately if both the buffer and the counter map are empty (no GCP call).
6. **Stable label ordering.** Counter keys sort label keys before `JSON.stringify` so `{ a:1, b:2 }` and `{ b:2, a:1 }` collapse to the same running total.

## Dependencies

| Package                       | Why                                            |
| ----------------------------- | ---------------------------------------------- |
| `@google-cloud/monitoring`    | `MetricServiceClient.createTimeSeries`         |
| `pino`                        | `Logger` type only (peer-style import)         |

No workspace dependencies — this is a leaf package.

## Consumers

- `workers/orchestrator` — imports `CODE_TASK_METRICS` types via local shim; not yet importing `createMetricsClient`. See `technical-debt.md` item #1.

## Test Surface

- `src/__tests__/client.test.ts` — covers buffer/flush, counter monotonicity, failure preservation, label-key stability.
- `src/__tests__/index.test.ts` — barrel smoke test.

Test pattern: inject a fake `MetricServiceClientLike` via `MetricsClientConfig.metricServiceClient`. Do not network-mock; the real `MetricServiceClient` should never be constructed in tests.

## Common Tasks

| Task                                                   | Approach                                                                                                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a new metric to a service                          | Define a `CustomMetric<LabelShape>` next to its emission site; only add to `CODE_TASK_METRICS` if it's part of the shared code-task family.                     |
| Add a new metric kind (e.g. real `Distribution`)       | Extend `MetricKind`, update `METRIC_KIND_MAP` and `buildTimeSeries` value-type branch, add a regression test covering the new shape.                            |
| Wire a service to emit metrics                         | `pnpm add @intexuraos/common-metrics --workspace`; call `createMetricsClient` once at startup; flush on a timer (`setInterval(() => flush(), 30_000).unref()`). |
| Replace the orchestrator shim                          | See `technical-debt.md` item #1 — drop in a re-export, swap `createMetricsClient`, delete shim.                                                                 |

## Cardinality Caution

Cloud Monitoring custom metrics enforce a low cardinality budget on label values. Do not pass free-form strings (user IDs, error codes, URLs) as label values. Closed enums only. Enforcement is the caller's responsibility — this package does not validate cardinality.

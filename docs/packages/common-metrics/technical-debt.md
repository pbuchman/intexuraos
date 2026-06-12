# Technical Debt — @intexuraos/common-metrics

Known issues, deferred work, and risks for the `@intexuraos/common-metrics` package.

## Open Items

### 1. Orchestrator still ships a local shim instead of importing this package

**Location:** `workers/orchestrator/src/metrics.ts`
**Status:** Open

The orchestrator declares its own `createMetricsClient`, `MetricsClient`, `CustomMetric`, `MetricLabel`, and `CODE_TASK_METRICS` locally — duplicated structurally from this package. The shim publishes via `logger.info({ metric: ... })` rather than calling `MetricServiceClient.createTimeSeries`, so today no series actually land in Cloud Monitoring; the orchestrator only emits log-based metrics.

Both files reference INT-1565 / S5–S8 in their headers, and the orchestrator file explicitly states "the parent plan's reconciliation commit replaces it with the real MetricsClient by swapping `createMetricsClient` for the package import." That swap has not happened.

**Risk:** Two divergent definitions of the same contract. If a field is added here (e.g. a new `MetricKind`), the orchestrator silently keeps the old shape until someone notices. Also, the `__labels` phantom field is named `__label` (singular) on the orchestrator side — already drift.

**Resolution:** Replace `workers/orchestrator/src/metrics.ts` exports with re-exports from `@intexuraos/common-metrics`, and switch `createMetricsClient` to the real client. Delete the shim. Update `noopMetricsClient` either to a re-export or keep it locally if no other service needs it.

### 2. No retry / dead-letter for failed flushes

**Location:** `src/client.ts` `flush()`
**Status:** Open

`flush()` rethrows on `createTimeSeries` failure and preserves buffered state, but there is no exponential-backoff retry or batch-size cap. A long GCP outage will grow the non-counter buffer unbounded (counter totals are O(distinct label combinations) and bounded by the metric's cardinality budget, so they are not a concern).

**Risk:** Memory growth in a sustained outage. Low priority — services flush on a short cadence and Cloud Monitoring outages are rare, but worth a buffer-size cap before adding high-volume distribution metrics.

**Resolution:** Add a `maxBufferSize` config option that drops oldest samples (with a single `warn` log per drop window) once exceeded. Consider exposing a `bufferStats()` accessor for service health endpoints.

### 3. No `metricKind: GAUGE` distinction at the SDK level for distributions

**Location:** `src/client.ts` `METRIC_KIND_MAP`
**Status:** Accepted

`distribution` is mapped to Cloud Monitoring's `GAUGE` metric kind because the client emits a single `DOUBLE` point per `record()` call rather than a `Distribution` aggregate. This is intentional — building a true `Distribution` (bucket counts) would require either client-side bucketing or per-flush server-side aggregation, neither of which is in scope.

**Risk:** Histograms / percentiles are not directly available in Cloud Monitoring; consumers must use MQL `percentile()` over the raw GAUGE series, which is more expensive at query time.

**Resolution:** None planned. Revisit if a service needs server-side percentile alerts.

### 4. `MetricServiceClient` is constructed with no explicit credentials path

**Location:** `src/client.ts` `defaultMetricServiceClientFactory`
**Status:** Accepted

`new MetricServiceClient()` relies on Application Default Credentials. This works in Cloud Run / Cloud Functions and on local machines that have run `gcloud auth application-default login`, but breaks silently in environments where ADC is not configured (the constructor succeeds; the first `createTimeSeries` call fails with an auth error).

**Risk:** Confusing failure mode on first deploy of a new service.

**Resolution:** None — matches the convention used by `infra-firestore` and `infra-pubsub`. The lazy construction on first `flush()` keeps the import side-effect-free.

## Resolved Items

_None yet._

# Technical Debt: @intexuraos/infra-otel

## Current State

v1.0.0 — recently added. The package has a clear single responsibility: bootstrap OTel when the endpoint is configured, no-op otherwise. Core configuration and instrumentation paths are unit tested. The SDK startup path (`register.ts`) is excluded from coverage due to requiring a live collector.

---

## Known Issues

### 1. register.ts has no integration test

The `register.ts` module is fully wrapped in `/* v8 ignore start -- module-init */` because starting the actual OTel SDK requires a live OTLP collector endpoint. There is no integration test that exercises the full SDK startup path.

**Impact:** Low. The individual pieces (`buildOtelConfig`, `getInstrumentations`) are unit tested. The SDK startup logic is minimal and standard.

**Recommendation:** Add a smoke test with a local OTLP receiver (e.g., OpenTelemetry Collector in Docker) in a dedicated integration test suite.

---

### 2. Log forwarding split across packages

This package handles traces and metrics. Pino log forwarding (logs → Dash0 via OTLP) is configured in `@intexuraos/infra-sentry`'s `otelTransport.ts` singleton using `pino-opentelemetry-transport`. The two configurations must stay consistent (same endpoint, auth token, service name mapping).

**Impact:** Low. Currently consistent, but a future refactor of either package could introduce divergence.

**Recommendation:** Consider consolidating log transport configuration into this package to keep all OTel configuration in one place.

---

### 3. Metric export interval hardcoded

`PeriodicExportingMetricReader` uses `exportIntervalMillis: 30_000` (30 seconds). This is not configurable via environment variable.

**Impact:** Low. 30 seconds is a reasonable default. Tuning requires a code change.

---

### 4. Trace sampling not documented

The SDK uses the default `ParentBasedAlwaysOnSampler` (100% sampling). The standard `OTEL_TRACES_SAMPLER` and `OTEL_TRACES_SAMPLER_ARG` environment variables can override this, but they are not documented in this package.

**Impact:** Medium at high traffic. High-volume services may want to configure probabilistic sampling.

**Recommendation:** Document supported `OTEL_TRACES_SAMPLER` values in README.

---

## Future Plans

- Document `OTEL_TRACES_SAMPLER` for tunable sampling rate
- Consolidate OTel log transport configuration from infra-sentry into this package
- Add integration test with local OTLP receiver for full SDK bootstrap verification
- Consider exposing `exportIntervalMillis` as a configurable option
